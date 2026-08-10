// ═══════════════════════════════════════════════
function blocosPdfHtml(html, secao) {
  const sa = secao ? ` data-secao="${secao}"` : '';
  if (!html) return `<div class="pdf-section-block"${sa}><p style="color:#999;margin:0">—</p></div>`;

  const div = document.createElement('div');
  div.innerHTML = html;

  // Coletar parágrafos não vazios e separadores
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

  // Agrupar em blocos de ~6 parágrafos — balanceia velocidade e quebra de página
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
      // Ignorar parágrafos completamente vazios (só <br> ou espaços)
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
    // Cada foto vira um bloco separado para evitar corte entre páginas
    const fotosHtml = (r.fotos||[]).flatMap((grupo, gi) => {
      const fotosDo = (grupo.fotos||[]).filter(f=>f.base64);
      if (fotosDo.length === 0) return [];
      const blocos = [];
      // Título e descrição do grupo
      if (grupo.titulo || grupo.descricao) {
        blocos.push(`<div class="pdf-section-block" style="margin-bottom:2px">
          ${grupo.titulo ? `<p style="font-weight:bold;margin:0 0 2px">${grupo.titulo}</p>` : ''}
          ${grupo.descricao ? `<p style="margin:0;color:#555">${grupo.descricao}</p>` : ''}
        </div>`);
      }
      // Cada foto é um bloco separado
      fotosDo.forEach((f, fi) => {
        blocos.push(`<div class="pdf-section-block pdf-foto-block">
          <img src="${f.base64}" style="width:100%;max-width:500px;border-radius:4px;display:block">
        </div>`);
      });
      return blocos;
    }).join('');
    const _fotosHtmlLegacy = (r.fotos||[]).map((f,i) => `
      <div class="pdf-section-block pdf-foto-block">
        <div class="pdf-foto-label">Foto ${String(i+1).padStart(2,'0')}</div>
        ${f.base64?`<img src="${f.base64}" alt="Foto ${i+1}">`:'<p style="color:#aaa;font-size:11px">[Sem foto]</p>'}
        <div class="pdf-foto-loc">📍 ${f.local||'—'}</div>
        <div class="pdf-foto-desc">${f.descricao||'—'}</div>
      </div>`).join('');
    // Logo para o PDF (mesma base64 do cabeçalho)
    const _logoB64 = 'data:image/png;base64,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';
    area.innerHTML = `
      <div class="pdf-section-block"><div class="pdf-header">
        <img src="logo-clemar-cores.png" style="height:48px;width:auto;display:block;margin:0 auto 12px" alt="Clemar Engenharia" crossorigin="anonymous">
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
    msg.textContent = 'Renderizando...';
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const A4w = 190, A4h = 277, margin = 10;

    // Renderiza cada bloco — agrupa parágrafos pequenos na mesma página
    const blocks = Array.from(area.querySelectorAll('.pdf-section-block'));

    // Marcar índices das seções ANTES de renderizar
    let idxObs = -1, idxConc = -1;
    blocks.forEach((b, i) => {
      // Detectar por data-secao OU por conteúdo do h2 (fallback)
      const secao = b.getAttribute('data-secao') || '';
      const h2txt = (b.querySelector && b.querySelector('h2')?.textContent) || '';
      const isObs  = secao === 'observacoes' || h2txt.includes('OBSERV');
      const isConc = secao === 'conclusao'   || h2txt.includes('CONCLU') || h2txt.includes('PARECER') || b.querySelector && b.querySelector('strong')?.textContent?.includes('Parecer');
      if (isObs  && idxObs  === -1) idxObs  = i;
      if (isConc && idxConc === -1) idxConc = i;
    });

    let curY = margin;

    // Pré-calcular alturas de todos os blocos
    const rendered = [];
    for (const block of blocks) {
      const bc = await html2canvas(block, {
        scale: 1.8, useCORS: true, allowTaint: true,
        backgroundColor: '#ffffff', logging: false
      });
      rendered.push({ canvas: bc, h: (bc.height * A4w) / bc.width });
    }

    for (let ri = 0; ri < rendered.length; ri++) {
      const { canvas: bc, h: blockH } = rendered[ri];
      if (blockH < 2) continue; // ignorar blocos vazios/invisíveis

      // Espaço extra antes das seções + regra 50%
      if (ri === idxObs || ri === idxConc) {
        if (curY > A4h * 0.50) {
          pdf.addPage();
          curY = margin;
        } else {
          curY += 8; // 8mm de respiro entre seções
        }
      }

      // Se não cabe na página atual, nova página — mas só se já tem conteúdo
      if (curY + blockH > A4h && curY > margin + 5) {
        pdf.addPage();
        curY = margin;
      }

      // Se o bloco é maior que a página inteira, divide
      if (blockH > A4h) {
        const pages = Math.ceil(blockH / A4h);
        const sliceH = Math.floor(bc.height / pages);
        for (let p = 0; p < pages; p++) {
          if (p > 0) { pdf.addPage(); curY = margin; }
          const tmp = document.createElement('canvas');
          tmp.width  = bc.width;
          tmp.height = Math.min(sliceH, bc.height - p * sliceH);
          tmp.getContext('2d').drawImage(bc, 0, -p * sliceH);
          const sd = tmp.toDataURL('image/jpeg', 0.88);
          const sh = (tmp.height * A4w) / bc.width;
          pdf.addImage(sd, 'JPEG', margin, curY, A4w, sh);
          curY += sh + 2;
        }
      } else {
        const imgData = bc.toDataURL('image/jpeg', 0.88);
        pdf.addImage(imgData, 'JPEG', margin, curY, A4w, blockH);
        curY += blockH + 2;
      }
    } // fim loop rendered
    const nome = `Relatorio_Visita_${String(r.numero).padStart(3,'0')}_${(r.data||'').replace(/-/g,'')}.pdf`;

    // Download manual via Blob — mais confiável no Android
    const blob = pdf.output('blob');
    const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /android/i.test(navigator.userAgent);

    if (isIOS) {
      // iOS abre em nova aba (Safari mostra opção de salvar)
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (isAndroid) {
        setTimeout(() => showAlert('PDF salvo em Downloads.', 'ok'), 600);
      }
    }

    area.innerHTML = '';
    ov.classList.remove('open');
    showAlert('PDF gerado!','ok');
  } catch(err) {
    console.error(err); ov.classList.remove('open');
    showAlert('Erro ao gerar PDF: '+err.message,'err');
  }
}

// ═══════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════


// ── TAMANHO DO RELATÓRIO ──
function calcTamanho(r) {
  const bytes = new Blob([JSON.stringify(r)]).size;
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024*1024)  return (bytes/1024).toFixed(0) + ' KB';
  return (bytes/(1024*1024)).toFixed(2) + ' MB';
}

function calcTamanhoBytes(r) {
  return new Blob([JSON.stringify(r)]).size;
}

function fmtBytes(bytes) {
  if (bytes < 1024)      return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + ' KB';
  return (bytes/(1024*1024)).toFixed(2) + ' MB';
}
function fmtUsuario(email) {
  if (!email) return '';
  return email.split('@')[0];
}
function fmtDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function fmtData(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fecharModal(id) { document.getElementById(id).classList.remove('open'); }

let _alertTimer = null;
function showAlert(msg, type) {
  const el = document.getElementById('alertBox');
  el.textContent = msg;
  el.className = `alert alert-${type} show`;
  clearTimeout(_alertTimer);
  _alertTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ═══════════════════════════════════════════════
//  FOTO INPUTS
// ═══════════════════════════════════════════════


// ── MENU CARD ──
let _menuCardId  = null;
let _menuCardNum = null;

function abrirMenuCard(id, num) {
  _menuCardId  = id;
  _menuCardNum = num;
  document.getElementById('cardMenuTitle').textContent = 'Relatório #' + String(num).padStart(3,'0');
  document.getElementById('cardMenuOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function fecharMenuCard() {
  document.getElementById('cardMenuOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function menuDuplicar() {
  fecharMenuCard();
  duplicarRelatorio(_menuCardId);
}
function menuExcluir() {
  fecharMenuCard();
  const r = relatorios.find(x => x.id === _menuCardId);
  const isAdmin = currentUser?.role === 'admin';
  if (!isAdmin && r?.user_id !== currentUser?.id) {
    showAlert('Você não pode excluir relatórios de outros usuários.', 'err');
    return;
  }
  const num = _menuCardNum;
  _excluirTargetId = _menuCardId;
  document.getElementById('modalExcluirMsg').textContent =
    'Tem certeza que deseja excluir o Relatório #' + String(num).padStart(3,'0') + '? Esta ação não pode ser desfeita.';
  document.getElementById('modalExcluir').classList.add('open');
}


// ── PAINEL ADMIN ──
async function abrirAdmin() {
  document.getElementById('adminPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
  await carregarUsuariosAdmin();
}

function fecharAdmin() {
  document.getElementById('adminPanel').classList.remove('open');
  document.body.style.overflow = '';
}

async function carregarUsuariosAdmin() {
  const body = document.getElementById('adminBody');
  body.innerHTML = '<div class="admin-empty">Carregando...</div>';
  const { data, error } = await supa.from('usuarios').select('*').order('criado_em', { ascending: false });
  if (error) {
    body.innerHTML = `<div class="admin-empty" style="color:var(--signal)">Erro: ${error.message}<br><small>Verifique as políticas RLS no Supabase.</small></div>`;
    return;
  }
  const outros = data || [];
  if (outros.length === 0) { body.innerHTML = '<div class="admin-empty">Nenhum usuário cadastrado ainda.</div>'; return; }
  const admins   = outros.filter(u => u.role === 'admin');
  const pendentes = outros.filter(u => u.role !== 'admin' && !u.aprovado);
  const aprovados = outros.filter(u => u.role !== 'admin' &&  u.aprovado);
  const renderRow = u => {
    const eAdmin  = u.role === 'admin';
    const ehEuMesmo = u.id === currentUser.id;
    return `
    <div class="admin-user-row" id="urow_${u.id}">
      <div class="admin-user-info">
        <div class="admin-user-email">${u.nome || u.email.split('@')[0]}
          ${eAdmin ? '<span style="font-size:10px;background:#1a2940;color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px;font-family:var(--font-mono);vertical-align:middle">ADMIN</span>' : ''}
        </div>
        <div class="admin-user-meta">${u.email}</div>
        <div class="admin-user-meta" style="margin-top:2px">${u.criado_em ? 'Criado: ' + new Date(u.criado_em).toLocaleDateString('pt-BR') : ''}${u.ultimo_login ? ' · 🕐 ' + fmtDataHora(u.ultimo_login) : ''}</div>
      </div>
      ${u.aprovado || eAdmin ? '<span class="admin-badge-ok">✅ Aprovado</span>' : '<span class="admin-badge-pend">⏳ Pendente</span>'}
      <div class="admin-user-actions">
        ${!ehEuMesmo ? `
          ${eAdmin
            ? `<button class="admin-icon-btn" style="background:#fff3e0;color:#e65100" onclick="alterarRole('${u.id}','user')" title="Remover admin">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
               </button>`
            : `<button class="admin-icon-btn" style="background:#e8f0fe;color:#1a73e8" onclick="alterarRole('${u.id}','admin')" title="Tornar admin">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
               </button>`}
          ${!u.aprovado && !eAdmin
            ? `<button class="admin-icon-btn" style="background:#e8f5e9;color:#27ae60" onclick="aprovarUsuario('${u.id}')" title="Aprovar">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>
               </button>`
            : !eAdmin
              ? `<button class="admin-icon-btn" style="background:#fff3e0;color:#e65100" onclick="revogarUsuario('${u.id}')" title="Revogar acesso">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                 </button>`
              : ''}
          <button class="admin-icon-btn" style="background:#fdecea;color:#c0392b" onclick="excluirUsuario('${u.id}','${u.email}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        ` : '<span style="font-size:11px;color:var(--ink-light);font-family:var(--font-cond)">você</span>'}
      </div>
    </div>`;
  };
  const sep = (txt) => `<div style="font-family:var(--font-cond);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-light);margin:14px 0 8px">${txt}</div>`;
  let html = '';
  if (admins.length > 0) {
    html += sep(`🔐 Administradores (${admins.length})`);
    html += admins.map(renderRow).join('');
  }
  if (pendentes.length > 0) {
    html += sep(`⏳ Aguardando aprovação (${pendentes.length})`);
    html += pendentes.map(renderRow).join('');
  }
  if (aprovados.length > 0) {
    html += sep(`✅ Aprovados (${aprovados.length})`);
    html += aprovados.map(renderRow).join('');
  }
  if (!html) html = '<div class="admin-empty">Nenhum outro usuário cadastrado ainda.</div>';
  body.innerHTML = html;
}

async function excluirUsuario(id, email) {
  if (!confirm(`Excluir o usuário ${email}? Isso remove o acesso permanentemente.`)) return;
  const { error } = await supa.from('usuarios').delete().eq('id', id);
  if (error) { showAlert('Erro ao excluir: ' + error.message, 'err'); return; }
  showAlert('Usuário excluído.', 'warn');
  await carregarUsuariosAdmin();
}


async function alterarRole(id, novoRole) {
  const acao = novoRole === 'admin' ? 'tornar administrador' : 'remover privilégios de admin de';
  if (!confirm(`Deseja ${acao} este usuário?`)) return;
  const { error } = await supa.from('usuarios').update({ role: novoRole }).eq('id', id);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert(novoRole === 'admin' ? 'Usuário promovido a admin!' : 'Privilégios de admin removidos.', 'ok');
  await carregarUsuariosAdmin();
}

async function aprovarUsuario(id) {
  const { error } = await supa.from('usuarios').update({ aprovado: true }).eq('id', id);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert('Usuário aprovado!', 'ok');
  await carregarUsuariosAdmin();
}

async function revogarUsuario(id) {
  const { error } = await supa.from('usuarios').update({ aprovado: false }).eq('id', id);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert('Acesso revogado.', 'warn');
  await carregarUsuariosAdmin();
}


// ═══════════════════════════════════════════════
//  EXPORTAR WORD
