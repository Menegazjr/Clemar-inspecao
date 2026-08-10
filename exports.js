async function exportarPDF() {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Nenhum relatório aberto.','warn'); return; }

  // Salva campos antes
  r.data           = document.getElementById('fieldData').value || null;
  r.obra           = document.getElementById('fieldObra').value;
  r.localidade     = document.getElementById('fieldLocalidade').value;
  r.responsavel    = document.getElementById('fieldResponsavel').value;
  r.cargo          = document.getElementById('fieldCargo').value;
  r.objetivo       = getEditorHtml(_quillObjetivo);
  r.observacoes    = getEditorHtml(_quillObservacoes);
  r.situacao       = document.getElementById('fieldSituacao').value;
  r.parecer        = getEditorHtml(_quillParecer);
  r.assin_nome     = document.getElementById('fieldAssinNome').value;
  r.assin_data     = document.getElementById('fieldAssinData').value;
  
  (r.fotos||[]).forEach(f => { salvarCamposFoto(f.id); });

  const ov = document.getElementById('exportOverlay');
  const msg = document.getElementById('exportMsg');
  ov.classList.add('open'); msg.textContent = 'Preparando PDF...';

  try {
    const area = document.getElementById('pdfArea');

    // 1. MONTAGEM DO HTML PARA O PDF
    const fotosHtml = (r.fotos||[]).flatMap((grupo, gi) => {
      const fotosDo = (grupo.fotos||[]).filter(f=>f.base64);
      if (fotosDo.length === 0) return [];
      const blocos = [];
      
      // Título e descrição do grupo - Marcado para o "look-ahead"
      if (grupo.titulo || grupo.descricao) {
        blocos.push(`<div class="pdf-section-block photo-group-header" data-tipo="header-foto" style="margin-bottom:2px">
          ${grupo.titulo ? `<p style="font-weight:bold;margin:0 0 2px">${grupo.titulo}</p>` : ''}
          ${grupo.descricao ? `<p style="margin:0;color:#555">${grupo.descricao}</p>` : ''}
        </div>`);
      }
      
      fotosDo.forEach((f, fi) => {
        blocos.push(`<div class="pdf-section-block pdf-foto-block" data-tipo="foto" data-base64="${f.base64}" data-w="${f.largura||0}" data-h="${f.altura||0}">
          <div style="height:4px"></div>
        </div>`);
      });
      return blocos;
    }).join('');

    area.innerHTML = `
      <div class="pdf-section-block"><div class="pdf-header">
        <img src="logo-clemar-cores.png" style="height:48px;width:auto;display:block;margin:0 auto 12px" alt="Clemar Engenharia">
        <h1>RELATÓRIO DE VISITA DE OBRA</h1>
        <div class="pdf-sub">Clemar Engenharia</div>
        <div class="pdf-num">Visita Nº ${String(r.numero).padStart(3,'0')} · ${r.data?fmtData(r.data):'—'}</div>
      </div></div>
      <div class="pdf-section-block"><h2>01 — IDENTIFICAÇÃO</h2>
      <table>
        <tr><td>Nº do Relatório</td><td>${String(r.numero).padStart(3,'0')}</td></tr>
        <tr><td>Obra / Projeto</td><td>${r.obra||'—'}</td></tr>
        <tr><td>Responsável</td><td>${r.responsavel||'—'}</td></tr>
      </table>
      </div>
      <div class="pdf-section-block"><h2>02 — OBJETIVO</h2></div>
      ${blocosPdfHtml(r.objetivo)}
      <h2 style="font-size:14px;color:#1a2940;margin:16px 0 6px;border-bottom:2px solid #e8a020;padding-bottom:4px">03 — REGISTRO FOTOGRÁFICO</h2>
      ${fotosHtml||'<p>Nenhuma foto registrada.</p>'}
      <div class="pdf-section-block" data-secao="observacoes"><h2>04 — OBSERVAÇÕES</h2></div>
      ${blocosPdfHtml(r.observacoes, "observacoes")}
      <div class="pdf-section-block" data-secao="conclusao"><h2>05 — CONCLUSÃO</h2></div>
      ${blocosPdfHtml(r.parecer, "conclusao")}
    `;

    await new Promise(res=>setTimeout(res,300));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const A4w = 190, A4h = 277, margin = 10;

    const blocks = Array.from(area.querySelectorAll('.pdf-section-block'));
    let curY = margin;

    // 2. PRÉ-CÁLCULO DE ALTURAS
    const rendered = [];
    for (const block of blocks) {
      if (block.getAttribute('data-tipo') === 'foto') {
        rendered.push({ 
            tipo: 'foto', 
            base64: block.getAttribute('data-base64'), 
            w: parseInt(block.getAttribute('data-w')||0), 
            h: parseInt(block.getAttribute('data-h')||0) 
        });
      } else {
        const bc = await html2canvas(block, { scale: 1.8, useCORS: true });
        rendered.push({ 
            tipo: 'canvas', 
            canvas: bc, 
            h: (bc.height * A4w) / bc.width,
            isHeaderFoto: block.classList.contains('photo-group-header')
        });
      }
    }

    // 3. LOOP DE DESENHO NO PDF COM LÓGICA DE AGRUPAMENTO
    for (let ri = 0; ri < rendered.length; ri++) {
      const item = rendered[ri];
      let heightToCompare = item.h;

      // Se for título de foto, olha se a primeira foto cabe junto
      if (item.isHeaderFoto && rendered[ri+1]?.tipo === 'foto') {
          const nextPhoto = rendered[ri+1];
          const imgW = nextPhoto.w || 800;
          const imgH = nextPhoto.h || 600;
          const scale = Math.min((A4w * 0.35) / imgW, (A4h * 0.35) / imgH);
          heightToCompare += (imgH * scale) + 5; // Altura do título + foto + margem
      }

      if (curY + heightToCompare > A4h && curY > margin + 5) {
        pdf.addPage();
        curY = margin;
      }

      if (item.tipo === 'foto') {
        const scale = Math.min((A4w * 0.35) / item.w, (A4h * 0.35) / item.h);
        const rW = item.w * scale; const rH = item.h * scale;
        pdf.addImage(item.base64, 'JPEG', margin, curY, rW, rH);
        curY += rH + 4;
      } else {
        pdf.addImage(item.canvas.toDataURL('image/jpeg', 0.88), 'JPEG', margin, curY, A4w, item.h);
        curY += item.h + 2;
      }
    }

    pdf.save(`Relatorio_${r.numero}.pdf`);
    ov.classList.remove('open');
    showAlert('PDF gerado!', 'ok');
  } catch(err) {
    console.error(err);
    ov.classList.remove('open');
    showAlert('Erro ao gerar PDF', 'err');
  }
}
