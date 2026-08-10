// ═══════════════════════════════════════════════
function blocosPdfHtml(html, secao) {
  const sa = secao ? ` data-secao="${secao}"` : '';
  if (!html) return `<div class="pdf-section-block"${sa}><p style="color:#999;margin:0">—</p></div>`;

  const div = document.createElement('div');
  div.innerHTML = html;

  const items = [];
  div.childNodes.forEach(n => {
    const tag = n.tagName?.toLowerCase();
    const txt = (n.textContent || '').trim();
    const inner = (n.innerHTML || '').trim();
    const vazio = tag === 'p' && (!txt || inner === '<br>' || inner === '<br/>');
    if (vazio) {
      items.push({ tipo: 'espaco' });
    } else if (tag === 'p' && txt) {
      items.push({ tipo: 'p', html: n.innerHTML });
    } else if (tag === 'ul' || tag === 'ol') {
      Array.from(n.querySelectorAll('li'))
        .filter(li => (li.textContent||'').trim())
        .forEach(li => items.push({ tipo: 'p', html: `<span style="padding-left:14px">• ${li.innerHTML}</span>` }));
    } else if (txt) {
      items.push({ tipo: 'p', html: n.textContent });
    }
  });

  if (!items.filter(i => i.tipo === 'p').length) {
    return `<div class="pdf-section-block"${sa}><p style="color:#999;margin:0">—</p></div>`;
  }

  const GRUPO = 6;
  const grupos = [];
  let atual = [];

  items.forEach(item => {
    if (item.tipo === 'espaco') {
      if (atual.length) { grupos.push(atual); atual = []; }
    } else {
      atual.push(item);
      if (atual.length >= GRUPO) { grupos.push(atual); atual = []; }
    }
  });
  if (atual.length) grupos.push(atual);

  return grupos.map((grupo, gi) => {
    const attr = (gi === 0 && secao) ? ` data-secao="${secao}"` : '';
    const html = grupo.map(i => `<p style="margin:0 0 3px;line-height:1.5">${i.html}</p>`).join('');
    return `<div class="pdf-section-block"${attr}>${html}</div>`;
  }).join('<div class="pdf-section-block" style="height:3px;padding:0"></div>');
}

function htmlParaPdfParas(html) {
  if (!html) return '<p style="margin:0 0 5px">—</p>';
  if (!html.includes('<')) {
    const linhas = html.split('\n').filter(l => l.trim());
    return linhas.length ? linhas.map(l => `<p style="margin:0 0 5px">${l}</p>`).join('') : '<p style="margin:0 0 5px">—</p>';
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  const result = [];

  div.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) result.push(`<p style="margin:0 0 5px">${node.textContent}</p>`);
      return;
    }
    const tag = node.tagName?.toLowerCase();
    if (tag === 'p') {
      const txt = (node.textContent || '').trim();
      const inner = (node.innerHTML || '').trim();
      if (!txt && (inner === '' || inner === '<br>' || inner === '<br/>')) return;
      result.push(`<p style="margin:0 0 5px">${node.innerHTML}</p>`);
    } else if (tag === 'ul' || tag === 'ol') {
      node.querySelectorAll('li').forEach(li => {
        if (!(li.textContent || '').trim()) return;
        const bullet = tag === 'ul' ? '• ' : '– ';
        result.push(`<p style="margin:0 0 4px;padding-left:16px">${bullet}${li.innerHTML}</p>`);
      });
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      if ((node.textContent || '').trim())
        result.push(`<p style="margin:0 0 5px;font-weight:bold">${node.textContent}</p>`);
    }
  });
  return result.length ? result.join('') : '<p style="margin:0 0 5px">—</p>';
}

async function exportarPDF() {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Nenhum relatório aberto.','warn'); return; }

  // 1. SALVAR DADOS DOS CAMPOS
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

    // 2. GERAR HTML DAS FOTOS COM MARCAÇÃO DE CABEÇALHO
    const fotosHtml = (r.fotos||[]).flatMap((grupo, gi) => {
      const fotosDo = (grupo.fotos||[]).filter(f=>f.base64);
      if (fotosDo.length === 0) return [];
      const blocos = [];
      
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

    // 3. MONTAR O CORPO DO RELATÓRIO
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
    
    // 4. CONFIGURAÇÃO DO PDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const A4w = 190, A4h = 277, margin = 10;
    const blocks = Array.from(area.querySelectorAll('.pdf-section-block'));
    let curY = margin;

    // 5. PRÉ-CÁLCULO DE ALTURAS DOS BLOCOS
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

    // 6. GERAÇÃO DAS PÁGINAS COM LÓGICA DE AGRUPAMENTO
    for (let ri = 0; ri < rendered.length; ri++) {
      const item = rendered[ri];
      if (item.tipo === 'canvas' && item.h < 2) continue;

      let heightToCompare = item.h;

      // Se este bloco for o cabeçalho das fotos, verifica se a PRIMEIRA FOTO cabe junto
      if (item.isHeaderFoto && rendered[ri + 1]?.tipo === 'foto') {
        const f = rendered[ri + 1];
        const scale = Math.min((A4w * 0.35) / f.w, (A4h * 0.35) / f.h);
        const photoH = (f.h * scale);
        // Soma Altura Texto + Foto + Margem de Segurança (15mm)
        heightToCompare += photoH + 15;
      }

      // Se não couber o bloco (ou o grupo vinculado), pula a página
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

    const nome = `Relatorio_Visita_${String(r.numero).padStart(3,'0')}.pdf`;
    pdf.save(nome);
    area.innerHTML = '';
    ov.classList.remove('open');
    showAlert('PDF gerado!', 'ok');

  } catch(err) {
    console.error(err);
    ov.classList.remove('open');
    showAlert('Erro ao gerar PDF: ' + err.message, 'err');
  }
}

// ═══════════════════════════════════════════════
//  UTILS E FUNÇÕES ADMINISTRATIVAS (Restante do arquivo)
// ═══════════════════════════════════════════════

function calcTamanho(r) {
  const bytes = new Blob([JSON.stringify(r)]).size;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + ' KB';
  return (bytes/(1024*1024)).toFixed(2) + ' MB';
}

function fmtData(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}

function showAlert(msg, type) {
  const el = document.getElementById('alertBox');
  el.textContent = msg;
  el.className = `alert alert-${type} show`;
  setTimeout(() => el.classList.remove('show'), 3200);
}

// ... (Aqui continuam as outras funções como carregarUsuariosAdmin, abrirAdmin, etc.)
// Recomendo manter as funções de Admin que já estavam no seu arquivo original abaixo deste ponto.