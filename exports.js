async function exportarPDF() {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Nenhum relatório aberto.','warn'); return; }

  // 1. SALVAR DADOS (Mantendo todos os seus campos originais)
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

    // 2. GERAR HTML DAS FOTOS (Com a marcação para o vínculo)
    const fotosHtml = (r.fotos||[]).flatMap((grupo, gi) => {
      const fotosDo = (grupo.fotos||[]).filter(f=>f.base64);
      if (fotosDo.length === 0) return [];
      const blocos = [];
      
      // Título do grupo marcado com data-tipo="header-foto"
      if (grupo.titulo || grupo.descricao) {
        blocos.push(`<div class="pdf-section-block" data-tipo="header-foto" style="margin-bottom:2px">
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

    // 3. MONTAR O HTML (Exatamente como o seu original)
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
        <tr><td>Início da Inspeção</td><td>${r.data?fmtData(r.data):'—'}</td></tr>
        <tr><td>Fim da Inspeção</td><td>${r.data_fim?fmtData(r.data_fim):'—'}</td></tr>
        <tr><td>Cliente</td><td>${r.cliente||'—'}</td></tr>
        <tr><td>Obra / Projeto</td><td>${r.obra||'—'}</td></tr>
        <tr><td>Centro de Custo</td><td>${r.cc||'—'}</td></tr>
        <tr><td>Localidade</td><td>${r.localidade||'—'}</td></tr>
        <tr><td>Responsável</td><td>${r.responsavel||'—'}</td></tr>
        <tr><td>Cargo</td><td>${r.cargo||'—'}</td></tr>
      </table>
      </div>
      <div class="pdf-section-block"><h2>02 — OBJETIVO</h2></div>
      ${blocosPdfHtml(r.objetivo)}
      <h2 style="font-size:14px;color:#1a2940;margin:16px 0 6px;border-bottom:2px solid #e8a020;padding-bottom:4px">03 — REGISTRO FOTOGRÁFICO</h2>
      ${fotosHtml||'<p>Nenhuma foto registrada.</p>'}
      <div class="pdf-section-block" data-secao="observacoes"><h2>04 — OBSERVAÇÕES</h2></div>
      ${blocosPdfHtml(r.observacoes, "observacoes")}
      <div class="pdf-section-block" data-secao="conclusao"><h2>05 — CONCLUSÃO</h2>
      <table>
        <tr><td>Situação Geral</td><td>${r.situacao||'—'}</td></tr>
      </table>
      </div>
      <div class="pdf-section-block"><strong>Parecer:</strong></div>
      ${blocosPdfHtml(r.parecer, "conclusao")}
      <div class="pdf-assin">
        <strong>${r.assin_nome||r.responsavel||'—'}</strong><br>
        ${r.cargo||''} ${r.assin_registro?'· '+r.assin_registro:''}<br>
        <span style="color:#888;font-size:11px">Emitido em: ${r.assin_data?fmtData(r.assin_data):fmtData(r.data)}</span>
      </div>`;

    await new Promise(res=>setTimeout(res,300));
    
    // 4. CONFIGURAÇÃO E PRÉ-CÁLCULO
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const A4w = 190, A4h = 277, margin = 10;
    const blocks = Array.from(area.querySelectorAll('.pdf-section-block'));

    const rendered = [];
    for (const block of blocks) {
      if (block.getAttribute('data-tipo') === 'foto') {
        rendered.push({ 
          tipo: 'foto', 
          base64: block.getAttribute('data-base64'), 
          w: parseInt(block.getAttribute('data-w')||800), 
          h: parseInt(block.getAttribute('data-h')||600) 
        });
      } else {
        const bc = await html2canvas(block, { scale: 1.8, useCORS: true, backgroundColor: '#ffffff' });
        rendered.push({ 
          tipo: 'canvas', 
          canvas: bc, 
          h: (bc.height * A4w) / bc.width,
          isHeaderFoto: block.getAttribute('data-tipo') === 'header-foto'
        });
      }
    }

    // 5. DESENHO NO PDF COM LÓGICA DE VÍNCULO
    let curY = margin;
    for (let ri = 0; ri < rendered.length; ri++) {
      const item = rendered[ri];
      if (item.tipo === 'canvas' && item.h < 2) continue;

      let hComp = item.h;

      // Se for título de foto, soma a altura da próxima foto para decidir a quebra
      if (item.isHeaderFoto && rendered[ri + 1]?.tipo === 'foto') {
        const f = rendered[ri + 1];
        const sc = Math.min((A4w * 0.35) / f.w, (A4h * 0.35) / f.h);
        hComp += (f.h * sc) + 15; // Buffer de 15mm
      }

      if (curY + hComp > A4h && curY > margin + 5) {
        pdf.addPage();
        curY = margin;
      }

      if (item.tipo === 'foto') {
        const sc = Math.min((A4w * 0.35) / item.w, (A4h * 0.35) / item.h);
        pdf.addImage(item.base64, 'JPEG', margin, curY, item.w * sc, item.h * sc);
        curY += (item.h * sc) + 4;
      } else {
        pdf.addImage(item.canvas.toDataURL('image/jpeg', 0.88), 'JPEG', margin, curY, A4w, item.h);
        curY += item.h + 2;
      }
    }

    pdf.save(`Relatorio_${r.numero}.pdf`);
    area.innerHTML = '';
    ov.classList.remove('open');
    showAlert('PDF gerado!', 'ok');

  } catch(err) {
    console.error(err);
    ov.classList.remove('open');
    showAlert('Erro ao gerar PDF: ' + err.message, 'err');
  }
}