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
        blocos.push(`<div class="pdf-section-block" data-tipo="foto-titulo" style="margin-bottom:2px">
          ${grupo.titulo ? `<p style="font-weight:bold;margin:0 0 2px">${grupo.titulo}</p>` : ''}
          ${grupo.descricao ? `<p style="margin:0;color:#555">${grupo.descricao}</p>` : ''}
        </div>`);
      }
      // Cada foto é um bloco separado com data-base64 para renderizar direto
      fotosDo.forEach((f, fi) => {
        blocos.push(`<div class="pdf-section-block pdf-foto-block" data-tipo="foto" data-base64="${f.base64}" data-w="${f.largura||0}" data-h="${f.altura||0}">
          <div style="height:4px"></div>
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
    const _logoB64 = //Link logo retirado
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
    const isMobile = window.innerWidth <= 600;
    for (const block of blocks) {
      if (block.getAttribute('data-tipo') === 'foto') {
        // Foto: não usar html2canvas, guardar base64 para addImage direto
        rendered.push({ tipo: 'foto', base64: block.getAttribute('data-base64'), w: parseInt(block.getAttribute('data-w')||0), h: parseInt(block.getAttribute('data-h')||0) });
      } else {
        const bc = await html2canvas(block, {
          scale: isMobile ? 1.4 : 1.8,
          useCORS: true, allowTaint: true,
          backgroundColor: '#ffffff', logging: false
        });
        rendered.push({ tipo: 'canvas', canvas: bc, h: (bc.height * A4w) / bc.width, isTituloFoto: block.getAttribute('data-tipo') === 'foto-titulo' });
      }
      if (isMobile) await new Promise(r => setTimeout(r, 0));
    }

    for (let ri = 0; ri < rendered.length; ri++) {
      const item = rendered[ri];

// Foto: addImage direto sem html2canvas
if (item.tipo === 'foto') {
  if (!item.base64) continue;

  const imgW = item.w || 800;
  const imgH = item.h || 600;

  // limites máximos
  const maxW = A4w * 0.35;   // 35% da largura da folha
  const maxH = A4h * 0.35;   // 35% da altura da folha

  // fator de escala para caber nos limites
  const scale = Math.min(maxW / imgW, maxH / imgH);

  const renderW = imgW * scale;
  const renderH = imgH * scale;

  // quebra de página se não couber
  if (curY + renderH > A4h && curY > margin + 5) {
    pdf.addPage();
    curY = margin;
  }

  // alinhado à esquerda
  pdf.addImage(item.base64, 'JPEG', margin, curY, renderW, renderH);
  curY += renderH + 4;
  continue;
}



      const { canvas: bc, h: blockH } = item;
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

      // Se o bloco é o título/descrição de um grupo de fotos, considerar também a altura
      // da primeira foto do grupo, para não separar o título da foto entre páginas
      let blockHParaQuebra = blockH;
      if (item.isTituloFoto && rendered[ri + 1] && rendered[ri + 1].tipo === 'foto') {
        const proxFoto = rendered[ri + 1];
        const imgW = proxFoto.w || 800, imgH = proxFoto.h || 600;
        const maxW = A4w * 0.35, maxH = A4h * 0.35;
        const scaleFoto = Math.min(maxW / imgW, maxH / imgH);
        blockHParaQuebra = blockH + (imgH * scaleFoto) + 4; // +4mm de respiro entre título e foto
      }

      // Se não cabe na página atual, nova página — mas só se já tem conteúdo
      if (curY + blockHParaQuebra > A4h && curY > margin + 5) {
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
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  const relatorio = relatorios.find(r => r.id === id);
  const podeAlterar = currentUser?.role === 'admin' || relatorio?.user_id === currentUser?.id;
  document.getElementById('btnMoverRelatorio').style.display = podeAlterar ? '' : 'none';
  document.getElementById('btnExcluirRelatorio').style.display = podeAlterar ? '' : 'none';
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
const _G_DB_LIMITE = 500 * 1024 * 1024;
const _G_ST_LIMITE = 1024 * 1024 * 1024;
let _gUsuarios = [], _gFiltro = 'todos', _gBusca = '';

async function abrirAdmin() {
  document.getElementById('adminPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
  _gFiltro = 'todos';
  _gBusca = '';
  const busca = document.getElementById('gBusca');
  if (busca) busca.value = '';
  await Promise.all([carregarUsuariosAdmin(), carregarEspaco()]);
}

function fecharAdmin() {
  document.getElementById('adminPanel').classList.remove('open');
  document.body.style.overflow = '';
}

async function carregarUsuariosAdmin() {
  const lista = document.getElementById('gUsuarios');
  if (!lista) return;
  lista.innerHTML = '<div class="admin-empty">Carregando usuários…</div>';
  document.getElementById('gCards').innerHTML = '<div class="admin-empty">Atualizando indicadores…</div>';
  document.getElementById('gChips').innerHTML = '';
  const { data, error } = await supa.from('usuarios')
    .select('id,email,nome,role,aprovado,criado_em,ultimo_login')
    .order('criado_em', { ascending: false });
  if (error) {
    lista.innerHTML = `<div class="admin-empty" style="color:var(--signal)">Erro ao carregar usuários: ${escHtml(error.message)}<br><small>Verifique as políticas RLS no Supabase.</small></div>`;
    return;
  }
  _gUsuarios = data || [];
  renderGestao();
}

async function carregarEspaco() {
  const box = document.getElementById('gEspaco');
  if (!box) return;
  box.innerHTML = '<div class="admin-empty" style="grid-column:1/-1">Calculando espaço…</div>';
  const [db, storage] = await Promise.all([
    supa.rpc('db_size'),
    supa.rpc('storage_size'),
  ]);
  box.innerHTML =
    barraEspaco('Banco de dados', 'relatórios, usuários e obras', db, _G_DB_LIMITE, 'db_size')
    + barraEspaco('Fotos armazenadas', 'bucket relatorio-fotos', storage, _G_ST_LIMITE, 'storage_size');
}

function barraEspaco(titulo, subtitulo, resultado, limite, funcao) {
  const bytes = resultado.error || resultado.data == null ? null : Number(resultado.data);
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    const erro = resultado.error?.message || `A função ${funcao} não retornou um valor válido.`;
    return `<div class="g-esp"><div class="g-esp-top"><div><b>${titulo}</b><small>${subtitulo}</small></div><span class="g-nd">indisponível</span></div><small>${escHtml(erro)}. Confira se a função está instalada no Supabase.</small></div>`;
  }
  const percentual = Math.min(100, bytes / limite * 100);
  const cor = percentual > 80 ? 'var(--signal)' : percentual > 50 ? 'var(--accent)' : 'var(--ok)';
  return `<div class="g-esp"><div class="g-esp-top"><div><b>${titulo}</b><small>${subtitulo}</small></div><span><strong>${fmtBytes(bytes)}</strong> <em>de ${fmtBytes(limite)}</em></span></div>
    <div class="g-barra"><i style="width:${Math.max(percentual, 1.5)}%;background:${cor}"></i></div><small>${percentual.toFixed(1)}% do limite de referência do plano gratuito</small></div>`;
}

const _gStatus = usuario => usuario.role === 'admin' ? 'admin' : usuario.aprovado ? 'aprovado' : 'pendente';
const _gAvatarCores = ['#0a8fe0', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#c0392b', '#34495e'];
const _gCorAvatar = texto => _gAvatarCores[[...String(texto || '')].reduce((soma, caractere) => soma + caractere.charCodeAt(0), 0) % _gAvatarCores.length];
const _gTempoAcesso = iso => {
  if (!iso) return 'Nunca acessou';
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 'Acesso sem data válida';
  const dias = Math.floor((Date.now() - timestamp) / 864e5);
  return dias <= 0 ? 'Acessou hoje' : dias === 1 ? 'Acessou ontem' : `Acessou há ${dias} dias`;
};

function gBuscar(valor) {
  _gBusca = valor;
  renderGestao();
}

function gFiltrar(filtro) {
  _gFiltro = filtro;
  renderGestao();
}

function renderGestao() {
  const cards = document.getElementById('gCards');
  const chips = document.getElementById('gChips');
  const lista = document.getElementById('gUsuarios');
  if (!cards || !chips || !lista) return;
  const conta = predicado => _gUsuarios.filter(predicado).length;
  const pendentes = conta(usuario => _gStatus(usuario) === 'pendente');
  const admins = conta(usuario => _gStatus(usuario) === 'admin');
  const aprovados = conta(usuario => _gStatus(usuario) === 'aprovado');
  const semanaAtras = Date.now() - 7 * 864e5;
  const ativos = conta(usuario => usuario.ultimo_login && new Date(usuario.ultimo_login).getTime() > semanaAtras);
  const card = (titulo, valor, classe = '') => `<div class="g-card ${classe}"><b>${valor}</b><span>${titulo}</span></div>`;
  cards.innerHTML = card('Usuários', _gUsuarios.length)
    + card('Aguardando aprovação', pendentes, pendentes ? 'g-alerta' : '')
    + card('Administradores', admins)
    + card('Ativos nos últimos 7 dias', ativos);

  const chip = (filtro, titulo, quantidade) => `<button class="g-chip${_gFiltro === filtro ? ' on' : ''}" onclick="gFiltrar('${filtro}')">${titulo}<small>${quantidade}</small></button>`;
  chips.innerHTML = chip('todos', 'Todos', _gUsuarios.length)
    + chip('pendente', 'Pendentes', pendentes)
    + chip('aprovado', 'Aprovados', aprovados)
    + chip('admin', 'Admins', admins);

  const norm = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const busca = norm(_gBusca).trim();
  const prioridade = { pendente: 0, admin: 1, aprovado: 2 };
  const usuarios = _gUsuarios
    .filter(usuario => (_gFiltro === 'todos' || _gStatus(usuario) === _gFiltro)
      && (!busca || norm(`${usuario.nome || ''} ${usuario.email || ''}`).includes(busca)))
    .sort((a, b) => prioridade[_gStatus(a)] - prioridade[_gStatus(b)]
      || (b.ultimo_login || '').localeCompare(a.ultimo_login || ''));
  lista.innerHTML = usuarios.length
    ? usuarios.map(renderUsuarioAdmin).join('')
    : '<div class="admin-empty">Nenhum usuário encontrado.</div>';
}

function renderUsuarioAdmin(usuario) {
  const status = _gStatus(usuario);
  const ehAtual = currentUser && usuario.id === currentUser.id;
  const id = escHtml(usuario.id);
  const email = usuario.email || '';
  const nome = usuario.nome || email.split('@')[0] || 'Sem nome';
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map(parte => parte[0]).join('').toUpperCase() || '?';
  const badge = status === 'admin' ? '<span class="g-badge adm">Admin</span>'
    : status === 'aprovado' ? '<span class="g-badge ok">Aprovado</span>'
    : '<span class="g-badge pend">Pendente</span>';
  let acoes = '';
  if (!ehAtual) {
    if (status === 'pendente') acoes += `<button class="g-btn ok" onclick="aprovarUsuario('${id}')">✓ Aprovar</button>`;
    if (status === 'aprovado') acoes += `<button class="g-btn" onclick="alterarRole('${id}','admin')">Tornar admin</button><button class="g-btn" onclick="revogarUsuario('${id}')">Revogar acesso</button>`;
    if (status === 'admin') acoes += `<button class="g-btn" onclick="alterarRole('${id}','user')">Remover admin</button>`;
    acoes += `<button class="g-btn perigo" onclick="excluirUsuario('${id}', this.dataset.email)" data-email="${escHtml(email)}">Excluir</button>`;
  }
  const criado = usuario.criado_em ? `Criado em ${new Date(usuario.criado_em).toLocaleDateString('pt-BR')}` : '';
  const meta = [escHtml(email), criado, _gTempoAcesso(usuario.ultimo_login)].filter(Boolean).join(' · ');
  return `<div class="g-user${status === 'pendente' ? ' pendente' : ''}">
    <div class="g-avatar" style="background:${_gCorAvatar(email)}">${escHtml(iniciais)}</div>
    <div class="g-nome">${escHtml(nome)} ${badge}${ehAtual ? '<span class="g-badge voce">Você</span>' : ''}</div>
    <div class="g-acoes">${acoes || (ehAtual ? '<span class="g-voce-label">Sua conta</span>' : '')}</div>
    <div class="g-meta">${meta}</div>
  </div>`;
}

async function excluirUsuario(id, email) {
  if (!confirm(`Excluir o perfil de ${email}? A conta de autenticação continuará no Supabase; um novo acesso dependerá de aprovação.`)) return;
  const { error } = await supa.from('usuarios').delete().eq('id', id);
  if (error) { showAlert('Erro ao excluir: ' + error.message, 'err'); return; }
  showAlert('Perfil removido. A conta de autenticação não foi apagada.', 'warn');
  await carregarUsuariosAdmin();
}


async function alterarRole(id, novoRole) {
  const acao = novoRole === 'admin' ? 'tornar administrador' : 'remover privilégios de admin de';
  if (!confirm(`Deseja ${acao} este usuário?`)) return;
  const { error } = await supa.rpc('admin_atualizar_usuario', {
    p_usuario_id: id,
    p_role: novoRole,
  });
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert(novoRole === 'admin' ? 'Usuário promovido a admin!' : 'Privilégios de admin removidos.', 'ok');
  await carregarUsuariosAdmin();
}

async function aprovarUsuario(id) {
  const { error } = await supa.rpc('admin_atualizar_usuario', {
    p_usuario_id: id,
    p_aprovado: true,
  });
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert('Usuário aprovado!', 'ok');
  await carregarUsuariosAdmin();
}

async function revogarUsuario(id) {
  const { error } = await supa.rpc('admin_atualizar_usuario', {
    p_usuario_id: id,
    p_aprovado: false,
  });
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert('Acesso revogado.', 'warn');
  await carregarUsuariosAdmin();
}


// ═══════════════════════════════════════════════
//  EXPORTAR WORD
