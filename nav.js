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
    .select('id, numero, data, obra, localidade, situacao, atualizado_em, atualizado_por, criado_por, pasta_id, user_id')
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

  // Atualiza badge de uso — lê tamanho real do banco via SQL RPC
  atualizarBadgeUso();
  renderizarLista();
  renderizarHistorico();
}

function renderizarLista() {
  const container = document.getElementById('listaRelatorios');
  if (relatorios.length === 0) {
    container.innerHTML = `
      <div class="lista-vazia">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <h3>Nenhum relatório ainda</h3>
        <p>Clique em <strong>Novo Relatório</strong> para criar o primeiro registro de visita.</p>
      </div>`;
    return;
  }
  // Filtrar exatamente pela pasta selecionada
  let listaFiltrada;
  if (pastaAtivaId === null && _pastaPaiAtualId !== null) {
    // Navegando dentro de uma pasta pai sem filtro ativo — não mostrar relatórios
    listaFiltrada = [];
  } else if (pastaAtivaId === null) {
    listaFiltrada = relatorios;
  } else if (pastaAtivaId === 'sem-pasta') {
    listaFiltrada = relatorios.filter(r => !r.pasta_id);
  } else {
    listaFiltrada = relatorios.filter(r => r.pasta_id === pastaAtivaId);
  }
  if (listaFiltrada.length === 0 && (pastaAtivaId !== null || _pastaPaiAtualId !== null)) {
    container.innerHTML = `<div class="lista-vazia">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:52px;height:52px;color:var(--border-strong);margin-bottom:14px"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      <h3>Pasta vazia</h3>
      <p>Nenhum relatório nesta pasta ainda.</p>
    </div>`;
    return;
  }
  container.innerHTML = listaFiltrada.map(r => {
    const badgeCls = r.situacao === 'Liberado' ? 'badge-conforme'
      : r.situacao === 'Concluído' ? 'badge-conforme'
      : r.situacao === 'Em elaboração' ? 'badge-ressalvas'
      : r.situacao === 'Em avaliação' ? 'badge-neutro'
      : 'badge-neutro';
    const badgeTxt = r.situacao || 'Sem situação';
    const isMeu = r.user_id === currentUser.id;
    const donoLabel = !isMeu
      ? `<span style="color:var(--accent);font-weight:600;font-size:10px">👤 ${fmtUsuario(r.atualizado_por || r.user_id)}</span>`
      : '';
    return `
      <div class="relatorio-card" onclick="abrirRelatorio('${r.id}')">
        <div class="relatorio-card-accent" style="${isMeu ? 'background:var(--ok)' : 'background:var(--accent)'}"></div>
        <div class="relatorio-card-body">
          <div class="relatorio-card-info">
            <div class="relatorio-card-obra-row">
              <span class="relatorio-card-num">#${String(r.numero).padStart(3,'0')}</span>
              <span class="relatorio-card-obra">${r.obra || '(sem nome de obra)'}</span>
            </div>
            <div class="relatorio-card-meta">
              <span>📅 ${r.data ? fmtData(r.data) : '—'}</span>
              ${r.localidade ? `<span>📍 ${r.localidade}</span>` : ''}
              ${r.criado_por ? `<span style="color:var(--ink-light);font-size:10px">🧑‍💼 Criado por: ${fmtUsuario(r.criado_por)}</span>` : donoLabel}
              ${r.atualizado_em ? `<span style="color:var(--border-strong)">✏️ ${fmtDataHora(r.atualizado_em)}${r.atualizado_por ? ' · ' + fmtUsuario(r.atualizado_por) : ''}</span>` : ''}
              ${r.pasta_id ? (() => { const p = pastas.find(x=>x.id===r.pasta_id); const pai = p ? pastas.find(x=>x.id===p.pasta_pai_id) : null; return `<span style="color:var(--accent);font-weight:600">📁 ${pai ? pai.nome+' › ' : ''}${p?.nome||''}</span>`; })() : ''}
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

