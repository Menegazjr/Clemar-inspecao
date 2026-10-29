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
  const { data, error } = await supa
    .from('relatorios')
    .select('id, numero, data, obra, cliente, localidade, situacao, atualizado_em, atualizado_por, criado_por, pasta_id, user_id')
    .is('excluido_em', null)
    .order('numero', { ascending: false });
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
}

// ═══════════════════════════════════════════════
//  BUSCA, FILTROS E ORDENAÇÃO DA LISTA
// ═══════════════════════════════════════════════
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normTxt = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let _busca = '', _sit = new Set(), _soMeus = false, _ordem = 'numero_desc';
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
  _busca = ''; _sit = new Set(); _soMeus = false;
  const i = document.getElementById('listaBusca'); if (i) i.value = '';
  atualizaFiltros(); renderizarLista();
}
function atualizaFiltros() {
  document.querySelectorAll('#listaFiltros .fchip[data-sit]').forEach(b => b.classList.toggle('on', _sit.has(b.dataset.sit)));
  const m = document.getElementById('fMeus'); if (m) m.classList.toggle('on', _soMeus);
  const ativo = !!(_busca.trim() || _sit.size || _soMeus);
  const l = document.getElementById('btnLimparFiltros'); if (l) l.style.display = ativo ? '' : 'none';
  const d = document.getElementById('listaDica'); if (d) d.style.display = _busca.trim() ? '' : 'none';
}
// Relatórios que passam pela busca, filtros e pasta atual, já ordenados.
// Com texto na busca, procura em TODAS as pastas; sem texto, mostra a pasta atual (inclui subpastas).
function relatoriosVisiveis() {
  const termos = normTxt(_busca).replace(/#/g, '').trim().split(/\s+/).filter(Boolean);
  const escopo = (!termos.length && pastaAtivaId && pastaAtivaId !== 'sem-pasta') ? new Set(idsDescendentes(pastaAtivaId)) : null;
  const l = relatorios.filter(r => {
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
  const filtrando = !!(_busca.trim() || _sit.size || _soMeus);
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
  container.innerHTML = lista.map(r => {
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
      <div class="relatorio-card" onclick="abrirRelatorio('${r.id}')">
        <div class="relatorio-card-accent" style="${isMeu ? 'background:var(--ok)' : 'background:var(--accent)'}"></div>
        <div class="relatorio-card-body">
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
  }).join('');
  renderizarPastasBar();   // mantém as contagens das pastas em dia
}

async function novoRelatorio() {
  const num  = (relatorios.length > 0 ? Math.max(...relatorios.map(r=>r.numero)) : 0) + 1;
  const hoje = new Date().toISOString().slice(0,10);
  const novo = {
    user_id:       currentUser.id,
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
  _versaoAberta = null;           // novo relatório — sem conflito possível
  _relatorioRecemCriado = data.id; // marca como recém criado, sem edição ainda
  relatorios.unshift(data);
  exibirForm();
  carregarFormulario();
  renderizarHistorico();
  showAlert(`Relatório #${num} criado!`, 'ok');
}

