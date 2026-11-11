function exibirLista() {
  mostrarLoadingFotos(false);
  document.getElementById('viewLista').style.display = 'flex';
  document.getElementById('viewForm').style.display  = 'none';
  document.getElementById('navLista').style.display  = 'flex';
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
  configurarEdicaoRelatorio();
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
  const { data, error } = await supa
    .from('relatorios')
    .select('id, numero, data, obra, obra_mapa_id, cliente, localidade, situacao, atualizado_em, atualizado_por, criado_por, pasta_id, user_id')
    .is('excluido_em', null)
    .order('numero', { ascending: false });
  if (error) { showAlert('Erro ao carregar lista: ' + error.message, 'err'); return; }
  const obraMapaId = new URLSearchParams(location.search).get('obra_mapa_id');
  _obraMapaFiltroId = '';
  _obraMapaFiltroNome = '';
  if (obraMapaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(obraMapaId)) {
    const { data: obraMapa, error: erroObra } = await supa.from('obras_mapa')
      .select('nome')
      .eq('id', obraMapaId)
      .maybeSingle();
    if (erroObra) { showAlert('Erro ao localizar a obra do mapa: ' + erroObra.message, 'err'); return; }
    if (obraMapa) {
      _obraMapaFiltroId = obraMapaId;
      _obraMapaFiltroNome = obraMapa.nome || '';
    }
  }
  const tamanhosConhecidos = new Map(relatorios.map(r => [r.id, r._tamanho]).filter(([, tamanho]) => tamanho));
  relatorios = (data || []).map(r => ({
    ...r,
    _tamanho: tamanhosConhecidos.get(r.id),
  }));
  sub.textContent = relatorios.length === 0
    ? 'Nenhum relatório ainda'
    : `${relatorios.length} relatório${relatorios.length !== 1 ? 's' : ''}`;
  sub.dataset.base = sub.textContent;

  // Atualiza badge de uso — lê tamanho real do banco via SQL RPC
  atualizarBadgeUso();
  atualizaFiltros();
  renderizarLista();
  renderizarHistorico();
}

// ═══════════════════════════════════════════════
//  BUSCA, FILTROS E ORDENAÇÃO DA LISTA
// ═══════════════════════════════════════════════
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normTxt = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let _busca = '', _sit = new Set(), _soMeus = false, _ordem = 'obra';
let _agrupar = true, _selMode = false, _sel = new Set();
let _obraMapaFiltroId = '';
let _obraMapaFiltroNome = '';
const collatorObras = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const ORDENS = {
  numero_desc: (a, b) => b.numero - a.numero,
  numero_asc:  (a, b) => a.numero - b.numero,
  editado:     (a, b) => (b.atualizado_em || '').localeCompare(a.atualizado_em || '') || b.numero - a.numero,
  data:        (a, b) => (b.data || '').localeCompare(a.data || '') || b.numero - a.numero,
  obra:        (a, b) => collatorObras.compare(a.obra || '~', b.obra || '~') || b.numero - a.numero,
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
function alternarAgrupar(){ _agrupar = !_agrupar; atualizaFiltros(); renderizarLista(); }
function alternarSelecao(){
  _selMode = !_selMode;
  _sel.clear();
  atualizaFiltros();
  atualizaBarraSel();
  renderizarLista();
}
function sairSelecao(){
  _selMode = false;
  _sel.clear();
  atualizaFiltros();
  atualizaBarraSel();
  renderizarLista();
}
function alternarSel(id){
  if (_sel.has(id)) _sel.delete(id);
  else _sel.add(id);
  atualizaBarraSel();
  renderizarLista();
}
function atualizaBarraSel(){
  const barra = document.getElementById('barraSel');
  if (!barra) return;
  barra.style.display = _selMode ? 'flex' : 'none';
  const count = document.getElementById('selCount');
  if (count) count.textContent = `${_sel.size} selecionado${_sel.size === 1 ? '' : 's'}`;
  const mover = document.getElementById('btnMoverSelecionados');
  if (mover) mover.disabled = _sel.size === 0;
}
function moverSelecionados(){
  if (!_sel.size) {
    showAlert('Selecione ao menos um relatório.', 'warn');
    return;
  }
  abrirSeletorPasta([..._sel]);
}
function aoOrdenar(v)  { _ordem = v; renderizarLista(); }
function limparFiltros() {
  _busca = ''; _sit = new Set(); _soMeus = false;
  _obraMapaFiltroId = '';
  _obraMapaFiltroNome = '';
  const url = new URL(location.href);
  url.searchParams.delete('obra_mapa_id');
  history.replaceState(history.state, '', url);
  const i = document.getElementById('listaBusca'); if (i) i.value = '';
  atualizaFiltros(); renderizarLista();
}
function atualizaFiltros() {
  document.querySelectorAll('#listaFiltros .fchip[data-sit]').forEach(b => b.classList.toggle('on', _sit.has(b.dataset.sit)));
  const sitLabel = document.getElementById('filtroSituacaoLabel');
  if (sitLabel) {
    sitLabel.classList.toggle('on', _sit.size > 0);
    const count = document.getElementById('filtroSituacaoCount');
    if (count) count.textContent = _sit.size ? String(_sit.size) : '';
  }
  const ordem = document.getElementById('listaOrdem');
  if (ordem && ordem.value !== _ordem) ordem.value = _ordem;
  const m = document.getElementById('fMeus'); if (m) m.classList.toggle('on', _soMeus);
  const a = document.getElementById('fAgrupar'); if (a) a.classList.toggle('on', _agrupar);
  const s = document.getElementById('fSel'); if (s) s.classList.toggle('on', _selMode);
  const ativo = !!(_busca.trim() || _sit.size || _soMeus || _obraMapaFiltroId);
  const l = document.getElementById('btnLimparFiltros');
  if (l) {
    l.style.display = ativo ? '' : 'none';
    l.textContent = _obraMapaFiltroId ? 'Limpar filtro da obra' : 'Limpar';
    l.title = _obraMapaFiltroId ? `Mostrar relatórios de todas as obras (filtro atual: ${_obraMapaFiltroNome || 'obra selecionada'})` : 'Limpar filtros';
  }
  const d = document.getElementById('listaDica'); if (d) d.style.display = _busca.trim() ? '' : 'none';
}
// Relatórios que passam pela busca, filtros e pasta atual, já ordenados.
// Com texto na busca, procura em TODAS as pastas; sem texto, mostra a pasta atual (inclui subpastas).
function relatoriosVisiveis() {
  const termos = normTxt(_busca).replace(/#/g, '').trim().split(/\s+/).filter(Boolean);
  const escopo = (!termos.length && pastaAtivaId && pastaAtivaId !== 'sem-pasta') ? new Set(idsDescendentes(pastaAtivaId)) : null;
  const l = relatorios.filter(r => {
    if (_obraMapaFiltroId && r.obra_mapa_id !== _obraMapaFiltroId &&
      (!_obraMapaFiltroNome || normTxt((r.obra || '').trim()) !== normTxt(_obraMapaFiltroNome.trim()))) return false;
    if (_sit.size && !_sit.has(r.situacao || '')) return false;
    if (_soMeus && r.user_id !== currentUser.id) return false;
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
  const filtrando = !!(_busca.trim() || _sit.size || _soMeus || _obraMapaFiltroId);
  const sub = document.getElementById('listSubtitle');
  if (relatorios.length === 0 && !_obraMapaFiltroId) {
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
  const renderCard = r => {
    const badgeCls = r.situacao === 'Liberado' || r.situacao === 'Concluído' ? 'badge-conforme'
      : r.situacao === 'Em elaboração' ? 'badge-ressalvas' : 'badge-neutro';
    const badgeTxt = escH(r.situacao || 'Sem situação');
    const isMeu = r.user_id === currentUser.id;
    const donoLabel = !isMeu
      ? `<span style="color:var(--accent);font-weight:600;font-size:10px">👤 ${escH(fmtUsuario(r.atualizado_por || r.user_id))}</span>`
      : '';
    const caminhoPasta = r.pasta_id ? caminhoAte(r.pasta_id).map(p => p.nome).join(' › ') : '';
    const selecionado = _sel.has(r.id);
    return `
      <div class="relatorio-card${selecionado ? ' sel' : ''}" onclick="${_selMode ? `alternarSel('${r.id}')` : `abrirRelatorio('${r.id}')`}">
        <div class="relatorio-card-accent" style="${isMeu ? 'background:var(--ok)' : 'background:var(--accent)'}"></div>
        <div class="relatorio-card-body">
          ${_selMode ? `<span class="chk${selecionado ? ' on' : ''}" aria-hidden="true"></span>` : ''}
          <div class="relatorio-card-info">
            <div class="relatorio-card-obra-row">
              <span class="relatorio-card-num">#${String(r.numero).padStart(3,'0')}</span>
              <span class="relatorio-card-obra">${escH(r.obra) || '(sem nome de obra)'}</span>
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
  };
  if (_agrupar && !_selMode) {
    const grupos = new Map();
    lista.forEach(r => {
      const chave = r.obra_mapa_id || normTxt(r.obra || '(sem obra)');
      if (!grupos.has(chave)) grupos.set(chave, { nome: r.obra || '(sem nome de obra)', relatorios: [] });
      grupos.get(chave).relatorios.push(r);
    });
    container.innerHTML = [...grupos.values()]
      .sort((a, b) => collatorObras.compare(a.nome, b.nome))
      .map(grupo => `
      <details class="grupo-obra">
        <summary><strong>${escH(grupo.nome)}</strong><small>${grupo.relatorios.length} relatório(s)</small></summary>
        ${grupo.relatorios.map(renderCard).join('')}
      </details>`).join('');
  } else {
    container.innerHTML = lista.map(renderCard).join('');
  }
  renderizarPastasBar();   // mantém as contagens das pastas em dia
  atualizaBarraSel();
}

async function novoRelatorio() {
  const num  = (relatorios.length > 0 ? Math.max(...relatorios.map(r=>r.numero)) : 0) + 1;
  const hoje = new Date().toISOString().slice(0,10);
  const novo = {
    user_id:       currentUser.id,
    obra_mapa_id:  new URLSearchParams(location.search).get('obra_mapa_id') || null,
    criado_por:    currentUser.email,
    numero:        num,
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
  const { data, error } = await supa.from('relatorios').insert([novo]).select().single();
  if (error) { showAlert('Erro ao criar relatório: ' + error.message, 'err'); return; }
  currentId = data.id;
  currentRelatorio = data;
  _fotosProntasId = data.id;
  _versaoAberta = null;           // novo relatório — sem conflito possível
  _relatorioRecemCriado = data.id; // marca como recém criado, sem edição ainda
  relatorios.unshift(data);
  exibirForm();
  carregarFormulario();
  renderizarHistorico();
  showAlert(`Relatório #${num} criado!`, 'ok');
}
