function exibirLista() {
  document.getElementById('viewLista').style.display = 'flex';
  document.getElementById('viewForm').style.display  = 'none';
  document.getElementById('navLista').style.display  = 'block';
  document.getElementById('navForm').style.display   = 'none';
  document.getElementById('btnSair').style.display   = '';
  document.getElementById('mobileBarForm').classList.remove('visivel');
  window.scrollTo({ top: 0, behavior: 'instant' });
  renderizarPastasBar();
  carregarLista();
}

function exibirForm() {
  if (_selMode) sairSelecao();
  // Iniciar editores Quill na primeira vez
  setTimeout(iniciarEditores, 50);
  document.getElementById('viewLista').style.display = 'none';
  document.getElementById('viewForm').style.display  = 'flex';
  document.getElementById('navLista').style.display  = 'none';
  document.getElementById('navForm').style.display   = 'flex';
  document.getElementById('btnSair').style.display   = 'none';
  document.getElementById('mobileBarForm').classList.add('visivel');
}

async function voltarLista() {
  const idSaindo = currentId;
  const eraRecemCriado = _relatorioRecemCriado && _relatorioRecemCriado === idSaindo;
  pararHeartbeat();
  ocultarBannerPresenca();
  if (idSaindo) removerPresenca(idSaindo);
  _relatorioRecemCriado = null;
  currentId = null;
  currentRelatorio = null;

  // Se o relatório foi criado agora e não foi editado, excluir silenciosamente
  if (eraRecemCriado) {
    const { error } = await supa.from('relatorios').delete().eq('id', idSaindo);
    if (!error) {
      relatorios = relatorios.filter(r => r.id !== idSaindo);
      showAlert('Relatório vazio descartado.', 'warn');
    }
  }

  exibirLista();
  renderizarLista();
  renderizarHistorico();
}

// ═══════════════════════════════════════════════
//  CRUD — BANCO DE DADOS
// ═══════════════════════════════════════════════
async function carregarLista() {
  if (!currentUser) return;
  // Garante que pastas estão carregadas antes de renderizar
  if (pastas.length === 0) await carregarPastas();
  const sub = document.getElementById('listSubtitle');
  sub.textContent = 'Carregando...';
  const COLS = 'id, numero, data, obra, cliente, localidade, situacao, atualizado_em, atualizado_por, criado_por, pasta_id, user_id';
  const consulta = c => supa.from('relatorios').select(c).is('excluido_em', null).order('numero', { ascending: false });
  let { data, error } = await consulta(COLS + ', obra_id');
  if (error && /obra_id/.test(error.message)) ({ data, error } = await consulta(COLS));   // SQL do vínculo ainda não rodou
  carregarObrasMapa();
  if (error) { showAlert('Erro ao carregar lista: ' + error.message, 'err'); return; }
  relatorios = data || [];
  const totalComTamanho = relatorios.filter(r => r._tamanho);
  const totalBytes = relatorios.reduce((acc, r) => {
    if (!r._tamanho) return acc;
    const b = new Blob([JSON.stringify(r)]).size;
    return acc + b;
  }, 0);
  const tamanhoStr = totalComTamanho.length > 0 ? ` · ~${fmtBytes(totalBytes)} em cache` : '';
  sub.textContent = relatorios.length === 0
    ? 'Nenhum relatório ainda'
    : `${relatorios.length} relatório${relatorios.length !== 1 ? 's' : ''}${tamanhoStr}`;
  sub.dataset.base = sub.textContent;

  // Atualiza badge de uso — lê tamanho real do banco via SQL RPC
  atualizarBadgeUso();
  renderizarLista();
  renderizarHistorico();
  aplicaHashObra();
}

// ═══════════════════════════════════════════════
//  BUSCA, FILTROS E ORDENAÇÃO DA LISTA
// ═══════════════════════════════════════════════
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normTxt = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let _busca = '', _sit = new Set(), _soMeus = false, _ordem = 'numero_desc';
let _agrupar = false, _selMode = false, _sel = new Set(), _obraId = null, _obraNome = '', _hashObraAplicado = false;
let obrasMapa = [];

// O número da visita é gerado pelo banco (sem repetir). Plano B: se o SQL ainda não rodou, calcula aqui.
async function inserirComNumero(obj) {
  let r = await supa.from('relatorios').insert([obj]).select().single();
  if (r.error && r.error.code === '23502') {
    const num = (relatorios.length ? Math.max(...relatorios.map(x => x.numero)) : 0) + 1;
    r = await supa.from('relatorios').insert([{ ...obj, numero: num }]).select().single();
  }
  return r;
}

// Obras cadastradas no mapa (para vincular o relatório)
async function carregarObrasMapa() {
  const { data } = await supa.from('obras_mapa').select('id,nome,cliente,cidade,uf,pais').order('nome');
  obrasMapa = data || [];
}
function popularSelectObras(sel) {
  const el = document.getElementById('fieldObraMapa'); if (!el) return;
  el.innerHTML = '<option value="">— sem vínculo com o mapa —</option>' + obrasMapa.map(o => `<option value="${o.id}">${escH(o.nome)} — ${escH(o.cidade)}${o.uf ? '/' + escH(o.uf) : ''}</option>`).join('');
  el.value = sel || '';
}
function aoEscolherObraMapa(id) {
  const o = obrasMapa.find(x => x.id === id); if (!o) return;
  document.getElementById('fieldObra').value = o.nome;
  const cli = document.getElementById('fieldCliente'); if (!cli.value.trim() && o.cliente) cli.value = o.cliente;
  const loc = document.getElementById('fieldLocalidade'); if (!loc.value.trim()) loc.value = o.cidade + (o.uf ? '/' + o.uf : (o.pais ? ' – ' + o.pais : ''));
}
// Link vindo do mapa: index.html#obra=<id> mostra só as visitas daquela obra
function aplicaHashObra() {
  if (_hashObraAplicado) return; _hashObraAplicado = true;
  const m = location.hash.match(/obra=([0-9a-f-]{36})/i);
  if (!m) return;
  const nome = location.hash.match(/nome=([^&]+)/);
  _obraId = m[1]; _obraNome = nome ? decodeURIComponent(nome[1]) : '';
  atualizaFiltros(); renderizarLista();
}

// Agrupar por obra e seleção múltipla
function alternarAgrupar() { _agrupar = !_agrupar; atualizaFiltros(); renderizarLista(); }
function alternarSelecao() { if (_selMode) { sairSelecao(); return; } _selMode = true; atualizaFiltros(); atualizaBarraSel(); renderizarLista(); }
function sairSelecao() { _selMode = false; _sel.clear(); atualizaFiltros(); atualizaBarraSel(); renderizarLista(); }
function alternarSel(id) { _sel.has(id) ? _sel.delete(id) : _sel.add(id); atualizaBarraSel(); renderizarLista(); }
function atualizaBarraSel() {
  const b = document.getElementById('barraSel'); if (!b) return;
  b.style.display = _selMode ? 'flex' : 'none';
  document.getElementById('selCont').textContent = `${_sel.size} selecionado${_sel.size !== 1 ? 's' : ''}`;
  document.getElementById('btnMoverSel').disabled = _sel.size === 0;
}
function moverSelecionados() { if (_sel.size) { _moverIds = [..._sel]; abrirSeletorPasta(); } }
const ORDENS = {
  numero_desc: (a, b) => b.numero - a.numero,
  numero_asc:  (a, b) => a.numero - b.numero,
  editado:     (a, b) => (b.atualizado_em || '').localeCompare(a.atualizado_em || '') || b.numero - a.numero,
  data:        (a, b) => (b.data || '').localeCompare(a.data || '') || b.numero - a.numero,
  obra:        (a, b) => (a.obra || '~').localeCompare(b.obra || '~', 'pt-BR') || b.numero - a.numero,
};
// ids de uma pasta e de todas as subpastas dentro dela
function idsDescendentes(id) {
  const r = [id];
  pastas.filter(p => p.pasta_pai_id === id).forEach(f => r.push(...idsDescendentes(f.id)));
  return r;
}
function aoBuscar(v)   { _busca = v; atualizaFiltros(); renderizarLista(); }
function alternarSit(v){ _sit.has(v) ? _sit.delete(v) : _sit.add(v); atualizaFiltros(); renderizarLista(); }
function alternarMeus(){ _soMeus = !_soMeus; atualizaFiltros(); renderizarLista(); }
function aoOrdenar(v)  { _ordem = v; renderizarLista(); }
function limparFiltros() {
  _busca = ''; _sit = new Set(); _soMeus = false; _obraId = null; _obraNome = '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const i = document.getElementById('listaBusca'); if (i) i.value = '';
  atualizaFiltros(); renderizarLista();
}
function atualizaFiltros() {
  document.querySelectorAll('#listaFiltros .fchip[data-sit]').forEach(b => b.classList.toggle('on', _sit.has(b.dataset.sit)));
  const on = (id, v) => { const e = document.getElementById(id); if (e) e.classList.toggle('on', v); };
  on('fMeus', _soMeus); on('fAgrupar', _agrupar); on('fSel', _selMode);
  const ativo = !!(_busca.trim() || _sit.size || _soMeus || _obraId);
  const l = document.getElementById('btnLimparFiltros'); if (l) l.style.display = ativo ? '' : 'none';
  const d = document.getElementById('listaDica');
  if (d) {
    const o = _obraId ? obrasMapa.find(x => x.id === _obraId) : null;
    const partes = [];
    if (_obraId) partes.push(`Só visitas da obra <strong>${escH(o ? o.nome : (_obraNome || 'selecionada'))}</strong> <button class="flimpar" style="margin-left:6px" onclick="limparFiltros()">✕ Ver todos os relatórios</button>`);
    if (_busca.trim()) partes.push('buscando em todas as pastas');
    d.innerHTML = partes.join(' · ');
    d.style.display = partes.length ? '' : 'none';
  }
}
// Relatórios que passam pela busca, filtros e pasta atual, já ordenados.
// Com texto na busca, procura em TODAS as pastas; sem texto, mostra a pasta atual (inclui subpastas).
function relatoriosVisiveis() {
  const termos = normTxt(_busca).replace(/#/g, '').trim().split(/\s+/).filter(Boolean);
  const escopo = (!termos.length && !_obraId && pastaAtivaId && pastaAtivaId !== 'sem-pasta') ? new Set(idsDescendentes(pastaAtivaId)) : null;
  const l = relatorios.filter(r => {
    if (_sit.size && !_sit.has(r.situacao || '')) return false;
    if (_soMeus && r.user_id !== currentUser.id) return false;
    if (_obraId) {   // vínculo oficial (obra_id) OU, nos relatórios antigos sem vínculo, o nome da obra
      const nomeObra = normTxt(_obraNome || (obrasMapa.find(x => x.id === _obraId) || {}).nome).trim(), ro = normTxt(r.obra).trim();
      const bate = r.obra_id === _obraId || (!r.obra_id && nomeObra.length >= 3 && ro.length >= 3 && (ro === nomeObra || ro.includes(nomeObra) || nomeObra.includes(ro)));
      if (!bate) return false;
    }
    if (termos.length) {
      const pasta = r.pasta_id ? caminhoAte(r.pasta_id).map(p => p.nome).join(' ') : '';
      const txt = normTxt([r.numero, r.obra, r.cliente, r.localidade, r.situacao, r.data, r.data ? fmtData(r.data) : '', pasta].join(' '));
      return termos.every(t => txt.includes(t));
    }
    if (pastaAtivaId === 'sem-pasta') return !r.pasta_id;
    if (escopo) return escopo.has(r.pasta_id);
    return true;
  });
  return l.sort(ORDENS[_ordem] || ORDENS.numero_desc);
}

function renderizarLista() {
  const container = document.getElementById('listaRelatorios');
  const filtrando = !!(_busca.trim() || _sit.size || _soMeus || _obraId);
  const sub = document.getElementById('listSubtitle');
  if (relatorios.length === 0) {
    container.innerHTML = `
      <div class="lista-vazia">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <h3>Nenhum relatório ainda</h3>
        <p>Clique em <strong>Novo Relatório</strong> para criar o primeiro registro de visita.</p>
      </div>`;
    renderizarPastasBar();
    return;
  }
  const lista = relatoriosVisiveis();
  if (sub) sub.textContent = filtrando ? `${lista.length} de ${relatorios.length} relatório${relatorios.length !== 1 ? 's' : ''}` : (sub.dataset.base || sub.textContent);
  if (lista.length === 0) {
    container.innerHTML = filtrando
      ? `<div class="lista-vazia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <h3>Nenhum relatório encontrado</h3>
          <p>Tente outras palavras ou <a onclick="limparFiltros()" style="color:var(--accent);cursor:pointer;font-weight:600">limpe os filtros</a>.</p>
        </div>`
      : `<div class="lista-vazia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:52px;height:52px;color:var(--border-strong);margin-bottom:14px"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <h3>Pasta vazia</h3>
          <p>Nenhum relatório nesta pasta ainda.</p>
        </div>`;
    renderizarPastasBar();
    return;
  }
  container.innerHTML = _agrupar ? htmlAgrupado(lista) : lista.map(r => cardHtml(r)).join('');
  renderizarPastasBar();   // mantém as contagens das pastas em dia
}

function cardHtml(r, visita) {
    const badgeCls = r.situacao === 'Liberado' ? 'badge-conforme'
      : r.situacao === 'Concluído' ? 'badge-conforme'
      : r.situacao === 'Em elaboração' ? 'badge-ressalvas'
      : 'badge-neutro';
    const badgeTxt = escH(r.situacao || 'Sem situação');
    const isMeu = r.user_id === currentUser.id;
    const donoLabel = !isMeu
      ? `<span style="color:var(--accent);font-weight:600;font-size:10px">👤 ${escH(fmtUsuario(r.atualizado_por || r.user_id))}</span>`
      : '';
    const caminhoPasta = r.pasta_id ? caminhoAte(r.pasta_id).map(p => p.nome).join(' › ') : '';
    return `
      <div class="relatorio-card${_selMode && _sel.has(r.id) ? ' sel' : ''}" onclick="${_selMode ? `alternarSel('${r.id}')` : `abrirRelatorio('${r.id}')`}">
        <div class="relatorio-card-accent" style="${isMeu ? 'background:var(--ok)' : 'background:var(--accent)'}"></div>
        <div class="relatorio-card-body">${_selMode ? `<span class="chk${_sel.has(r.id) ? ' on' : ''}"></span>` : ''}
          <div class="relatorio-card-info">
            <div class="relatorio-card-obra-row">
              <span class="relatorio-card-num">#${String(r.numero).padStart(3,'0')}</span>
              <span class="relatorio-card-obra">${escH(r.obra) || '(sem nome de obra)'}</span>${visita ? `<span class="visita-tag">Visita ${visita}</span>` : ''}
            </div>
            <div class="relatorio-card-meta">
              <span>📅 ${r.data ? fmtData(r.data) : '—'}</span>
              ${r.cliente ? `<span>🏢 ${escH(r.cliente)}</span>` : ''}
              ${r.localidade ? `<span>📍 ${escH(r.localidade)}</span>` : ''}
              ${r.criado_por ? `<span style="color:var(--ink-light);font-size:10px">🧑‍💼 Criado por: ${escH(fmtUsuario(r.criado_por))}</span>` : donoLabel}
              ${r.atualizado_em ? `<span style="color:var(--border-strong)">✏️ ${fmtDataHora(r.atualizado_em)}${r.atualizado_por ? ' · ' + escH(fmtUsuario(r.atualizado_por)) : ''}</span>` : ''}
              ${caminhoPasta ? `<span style="color:var(--accent);font-weight:600">📁 ${escH(caminhoPasta)}</span>` : ''}
              ${r._tamanho ? `<span style="color:var(--border-strong);font-family:var(--font-mono);font-size:10px">💾 ${r._tamanho}</span>` : ''}
            </div>
          </div>
          <span class="relatorio-card-badge ${badgeCls}">${badgeTxt}</span>
          <button class="btn-more" onclick="event.stopPropagation();abrirMenuCard('${r.id}','${r.numero}')" title="Opções">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
          </button>
        </div>
      </div>`;
}

// Visão "Por obra": uma seção por obra, com nº de visitas e a data da última
const nomeGrupo = rs => (rs[0].obra_id && (obrasMapa.find(o => o.id === rs[0].obra_id) || {}).nome) || rs[0].obra || '(sem nome de obra)';
function htmlAgrupado(lista) {
  const grupos = new Map();
  lista.forEach(r => { const k = r.obra_id || 'txt:' + normTxt(r.obra).trim(); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  const abrir = grupos.size <= 3 || !!_busca.trim() || !!_obraId;
  return [...grupos.entries()].sort((a, b) => nomeGrupo(a[1]).localeCompare(nomeGrupo(b[1]), 'pt-BR')).map(([k, rs]) => {
    const idx = new Map([...rs].sort((a, b) => a.numero - b.numero).map((r, i) => [r.id, i + 1]));
    const ult = rs.map(r => r.data || '').sort().pop();
    const om = k.startsWith('txt:') ? null : obrasMapa.find(o => o.id === k);
    return `<details class="grupo-obra"${abrir ? ' open' : ''}>
      <summary><span class="grupo-nome">${escH(nomeGrupo(rs))}</span>
        <span class="grupo-meta">${rs.length} visita${rs.length !== 1 ? 's' : ''}${ult ? ' · última em ' + fmtData(ult) : ''}${om ? ' · 🗺️ ' + escH(om.cidade) : ''}</span></summary>
      ${[...rs].sort(ORDENS[_ordem] || ORDENS.numero_desc).map(r => cardHtml(r, idx.get(r.id) + '/' + rs.length)).join('')}
    </details>`;
  }).join('');
}

async function novoRelatorio() {
  const hoje = new Date().toISOString().slice(0,10);
  const novo = {
    user_id:       currentUser.id,
    criado_por:    currentUser.email,
    data:          hoje,
    data_fim:      null,
    cliente:       '',
    obra:          '',
    cc:            '',
    localidade:    '',
    responsavel:   '',
    cargo:         '',
    objetivo:      '',
    observacoes:   '',
    situacao:      '',

    parecer:       '',
    assin_nome:    '',
    assin_registro:'',
    assin_data:    hoje,
    fotos:         [],
  };
  const { data, error } = await inserirComNumero(novo);
  if (error) { showAlert('Erro ao criar relatório: ' + error.message, 'err'); return; }
  currentId = data.id;
  _fotosProntasId = data.id;
  currentRelatorio = data;
  _versaoAberta = null;           // novo relatório — sem conflito possível
  _relatorioRecemCriado = data.id; // marca como recém criado, sem edição ainda
  relatorios.unshift(data);
  exibirForm();
  carregarFormulario();
  renderizarHistorico();
  showAlert(`Relatório #${data.numero} criado!`, 'ok');
}

