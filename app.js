// ═══════════════════════════════════════════════
//  SUPABASE
// ═══════════════════════════════════════════════
const SUPA_URL = 'https://vsxoeqyqhmrljfahqcsb.supabase.co';
const SUPA_KEY = 'sb_publishable_kBVUT2phcWigWcQNY7PkAQ_xOg72_kt';
const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
const CONFIG_KEY = 'clemar_visita_config_v1';

let currentUser = null;
let relatorios = [];       // lista completa carregada do banco
let currentId  = null;     // id do relatório em edição
let currentRelatorio = null; // objeto completo do relatório em edição (com fotos)
let _pendingFotoId = null;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ═══════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════
function toggleForm(showCad) {
  document.getElementById('authMsg').style.display = 'none';
  document.getElementById('authOk').style.display  = 'none';
  document.getElementById('formLogin').style.display   = showCad ? 'none' : '';
  document.getElementById('formCadastro').style.display = showCad ? '' : 'none';
}

async function fazerLogin() {
  const email    = document.getElementById('authEmail').value.trim();
  const senha    = document.getElementById('authPassword').value;
  const lembrar  = document.getElementById('lembrarMe')?.checked || false;
  const msg      = document.getElementById('authMsg');
  msg.style.display = 'none';
  if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; msg.style.display='block'; return; }

  // Salvar e-mail se marcou lembrar
  if (lembrar) {
    localStorage.setItem('clemar_email', email);
  } else {
    localStorage.removeItem('clemar_email');
  }

  const { data, error } = await supa.auth.signInWithPassword({ email, password: senha });
  if (error) { msg.textContent = error.message; msg.style.display='block'; return; }
  aoLogar(data.user);
}

// Preencher e-mail salvo ao carregar
(function() {
  const saved = localStorage.getItem('clemar_email');
  if (saved) {
    const el = document.getElementById('authEmail');
    const cb = document.getElementById('lembrarMe');
    if (el) el.value = saved;
    if (cb) cb.checked = true;
  }
})();

async function fazerCadastro() {
  const nome  = document.getElementById('authNome').value.trim();
  const email = document.getElementById('authEmailCad').value.trim();
  const senha = document.getElementById('authPasswordCad').value;
  const msg   = document.getElementById('authMsg');
  const ok    = document.getElementById('authOk');
  msg.style.display = 'none'; ok.style.display = 'none';
  if (!nome||!email||!senha) { msg.textContent='Preencha todos os campos.'; msg.style.display='block'; return; }
  if (senha.length < 6)      { msg.textContent='Senha deve ter pelo menos 6 caracteres.'; msg.style.display='block'; return; }
  const { data, error } = await supa.auth.signUp({ email, password: senha, options: { data: { nome } } });
  if (error) { msg.textContent = error.message; msg.style.display='block'; return; }
  ok.textContent = '✅ Conta criada! Verifique seu e-mail ou faça login diretamente.';
  ok.style.display = 'block';
}

async function aoLogar(user) {
  // Garante registro na tabela usuarios e busca role
  await supa.from('usuarios').upsert({
    id:    user.id,
    email: user.email,
    nome:  user.user_metadata?.nome || user.email.split('@')[0],
    ultimo_login: new Date().toISOString(),
  }, { onConflict: 'id' });

  const { data: reg } = await supa.from('usuarios')
    .select('aprovado, role')
    .eq('id', user.id)
    .single();

  // Anexa role ao currentUser para uso global
  currentUser = { ...user, role: reg?.role || 'user' };
  const isAdmin = currentUser.role === 'admin';

  // Verifica aprovação (admin sempre passa)
  if (!isAdmin) {
    if (!reg || !reg.aprovado) {
      await supa.auth.signOut();
      const msg = document.getElementById('authMsg');
      msg.textContent = '⏳ Seu acesso está aguardando aprovação do administrador.';
      msg.style.display = 'block';
      return;
    }
  }

  document.getElementById('authScreen').style.display  = 'none';
  document.getElementById('mainNav').style.display     = 'flex';
  document.getElementById('appBody').style.display     = 'flex';
  document.getElementById('userBar').style.display     = 'flex';
  document.getElementById('userEmail').textContent     = user.email;

  // Mostra controles de admin
  if (isAdmin) {
    document.getElementById('btnAdmin').style.display      = 'flex';
    document.getElementById('badgeUsoDb').style.display    = 'flex';
    document.getElementById('navFormLixeira').style.display = 'inline-flex';
    atualizarBadgeLixeira();
  }

  await carregarPastas();
  exibirLista();
}

async function fazerLogout() {
  if (!confirm('Deseja realmente sair?')) return;
  pararHeartbeat();
  ocultarBannerPresenca();
  if (currentId) await removerPresenca(currentId);
  await supa.auth.signOut();
  currentUser = null; relatorios = []; currentId = null;
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('mainNav').style.display    = 'none';
  document.getElementById('appBody').style.display    = 'none';
  document.getElementById('userBar').style.display    = 'none';
}

// ═══════════════════════════════════════════════
//  NAVEGAÇÃO ENTRE VIEWS
// ═══════════════════════════════════════════════
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

let _abrindoRelatorio = false;
async function abrirRelatorio(id) {
  if (_abrindoRelatorio) return;
  _abrindoRelatorio = true;
  setTimeout(() => { _abrindoRelatorio = false; }, 1500);

  // 1. Buscar dados SEM fotos primeiro — rápido
  const { data, error: err1 } = await supa.from('relatorios')
    .select('id,numero,data,data_fim,obra,cliente,cc,localidade,responsavel,cargo,objetivo,observacoes,situacao,parecer,assin_nome,assin_registro,assin_data,pasta_id,user_id,criado_por,atualizado_em,atualizado_por,versao,excluido_em')
    .eq('id', id).single();
  if (err1) { showAlert('Erro ao abrir: ' + err1.message, 'err'); _abrindoRelatorio = false; return; }
  data.fotos = []; // fotos virão em segundo plano

  data._tamanho = fmtBytes(new Blob([JSON.stringify(data)]).size);
  currentId = id;
  currentRelatorio = data;
  const idx = relatorios.findIndex(r => r.id === id);
  if (idx >= 0) relatorios[idx] = data; else relatorios.unshift(data);
  _versaoAberta = data.versao || data.atualizado_em || null;
  _relatorioRecemCriado = null;

  // 2. Abrir formulário imediatamente — textos já disponíveis
  exibirForm();
  const tf = document.getElementById('tabForm');
  const tc = document.getElementById('tabConfig');
  if (tf) tf.style.display = '';
  if (tc) tc.style.display = 'none';
  carregarFormulario();
  renderizarHistorico();
  renderizarFotos(); // mostra lista vazia enquanto carrega
  mostrarLoadingFotos(true);

  // 3. Buscar fotos em segundo plano
  supa.from('relatorios').select('fotos').eq('id', id).single().then(({ data: fd }) => {
    if (!fd || currentId !== id) return;
    try {
      let fotos = fd.fotos;
      if (!fotos) fotos = [];
      else if (typeof fotos === 'string') fotos = JSON.parse(fotos);
      else if (typeof fotos === 'object' && !Array.isArray(fotos)) fotos = Object.values(fotos);
      fotos = (fotos || []).filter(f => f && typeof f === 'object');
      currentRelatorio.fotos = fotos;
      relatorios[relatorios.findIndex(r => r.id === id)].fotos = fotos;
      renderizarFotos();
    } catch(e) {}
    mostrarLoadingFotos(false);
  });

  ocultarBannerPresenca();
  verificarPresenca(id).then(presenca => {
    if (presenca.ocupado) {
      mostrarBannerPresenca(presenca.email);
    } else {
      registrarPresenca(id);
      iniciarHeartbeat(id);
    }
  });
}

function mostrarLoadingFotos(ativo) {
  let el = document.getElementById('loadingFotos');
  if (ativo) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'loadingFotos';
      el.style.cssText = [
        'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
        'background:var(--steel)', 'color:#fff', 'border-radius:20px',
        'padding:8px 18px', 'font-size:13px', 'font-family:var(--font-cond)',
        'font-weight:600', 'z-index:500', 'display:flex', 'align-items:center',
        'gap:8px', 'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
        'animation:bannerEntrada 0.2s ease'
      ].join(';');
      el.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          style="width:14px;height:14px;animation:girar 1s linear infinite">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        Carregando fotos...`;
      document.body.appendChild(el);
    }
  } else {
    if (el) {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }
  }
}

function getRelatorioAtual() {
  return currentRelatorio || relatorios.find(r => r.id === currentId) || null;
}

async function salvar() {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Nenhum relatório aberto.', 'warn'); return; }
  // Coleta campos
  r.data           = document.getElementById('fieldData').value || null;
  r.data_fim       = document.getElementById('fieldDataFim').value || null;
  r.cliente        = document.getElementById('fieldCliente').value;
  r.obra           = document.getElementById('fieldObra').value;
  r.cc             = document.getElementById('fieldCC').value;
  r.localidade     = document.getElementById('fieldLocalidade').value;
  r.responsavel    = document.getElementById('fieldResponsavel').value;
  r.cargo          = document.getElementById('fieldCargo').value;
  r.objetivo       = getEditorHtml(_quillObjetivo);
  r.observacoes    = getEditorHtml(_quillObservacoes);
  r.situacao       = document.getElementById('fieldSituacao').value;
  r.parecer        = getEditorHtml(_quillParecer);
  r.assin_nome     = document.getElementById('fieldAssinNome').value;

  r.assin_data     = document.getElementById('fieldAssinData').value;
  r.atualizado_em  = new Date().toISOString();
  r.atualizado_por = currentUser.email;
  // Coleta campos de cada foto antes de salvar
  (r.fotos || []).forEach(f => salvarCamposFoto(f.id));
  // Garante fotos como array limpo
  const fotosArray = (Array.isArray(r.fotos) ? r.fotos : []).map(f => ({
    id:        f.id        || '',
    base64:    f.base64    || '',
    local:     f.local     || '',
    descricao: f.descricao || '',
    timestamp: f.timestamp || '',
    largura:   f.largura   || 0,
    altura:    f.altura    || 0,
  }));
  // Salva no Supabase (excluindo user_id, id e campos locais)
  const { user_id, id, _tamanho, fotos: _fotos, criado_por: _criado_por, ...camposSemFotos } = r;
  const campos = { ...camposSemFotos, fotos: fotosArray };
  // Detecção de conflito: verificar se versão mudou desde que abrimos
  const { data: atual } = await supa.from('relatorios')
    .select('versao, atualizado_em, atualizado_por')
    .eq('id', r.id)
    .single();

  const versaoAtual = atual?.versao || atual?.atualizado_em || null;
  const isNovoRelatorio = !_versaoAberta;
  if (!isNovoRelatorio && versaoAtual && versaoAtual !== _versaoAberta) {
    const quem = atual?.atualizado_por ? fmtUsuario(atual.atualizado_por) : 'outro usuário';
    const confirmar = window.confirm(
      `⚠️ Atenção: "${quem}" modificou este relatório enquanto você editava.\n\n` +
      `Deseja sobrescrever as alterações dele com as suas?\n\n` +
      `• OK = Salvar mesmo assim (sobrescreve)\n• Cancelar = Descartar suas alterações`
    );
    if (!confirmar) {
      // Recarrega do banco para mostrar versão mais recente
      await abrirRelatorio(r.id);
      return;
    }
  }

  // Atualiza versão antes de salvar
  campos.versao = new Date().toISOString();

  const { error } = await supa.from('relatorios').update(campos).eq('id', r.id);
  if (error) { showAlert('Erro ao salvar: ' + error.message, 'err'); return; }

  // Atualiza versão local
  _versaoAberta = campos.versao;
  r.versao = campos.versao;

  // Confirma presença após salvar
  await registrarPresenca(r.id);

  r._tamanho = fmtBytes(new Blob([JSON.stringify(r)]).size);
  renderizarHistorico();
  renderizarLista();
  _relatorioRecemCriado = null; // salvo com sucesso — não é mais vazio
  showAlert('Relatório salvo!', 'ok');
}


let _excluirTargetId = null;

// ── Relatório recém criado (sem edição) ──
let _relatorioRecemCriado = null;
let _pastaPaiAtualId = null;  // pasta pai sendo navegada (null = raiz)
let _quillObjetivo    = null;
let _quillObservacoes = null;
let _quillParecer     = null;

function iniciarEditores() {
  if (_quillObjetivo) return; // já iniciados
  if (!document.getElementById('fieldObjetivo')) return; // DOM não pronto
  try {
    const toolbar = [
      [{ 'color': ['#000000','#1a2940','#c0392b','#e67e22','#27ae60','#2980b9','#8e44ad'] }],
      ['bold', 'italic'],
      ['clean']
    ];
    _quillObjetivo    = new Quill('#fieldObjetivo',    { theme:'snow', placeholder:'Descreva o objetivo da visita...', modules:{ toolbar: { container: toolbar, handlers:{} } } });
    _quillObservacoes = new Quill('#fieldObservacoes', { theme:'snow', placeholder:'Observações adicionais, pendências identificadas...', modules:{ toolbar: { container: toolbar, handlers:{} } } });
    _quillParecer     = new Quill('#fieldParecer',     { theme:'snow', placeholder:'Conclusão técnica da visita...', modules:{ toolbar: { container: toolbar, handlers:{} } } });
  } catch(e) {
    console.warn('Quill init erro:', e);
    _quillObjetivo = _quillObservacoes = _quillParecer = null;
  }
}

// Helpers para ler/escrever HTML nos editores
function getEditorHtml(quill) {
  if (!quill) return '';
  const html = quill.getSemanticHTML();
  // Se só tem parágrafo vazio, retorna string vazia
  return html === '<p></p>' || html === '<p><br></p>' ? '' : html;
}

function setEditorHtml(quill, html) {
  if (!quill) return;
  if (!html) { quill.setContents([]); return; }
  quill.clipboard.dangerouslyPasteHTML(html);
}

// Converte HTML rico em texto puro (para Word paragraph por paragraph)
function htmlParaParas(html) {
  if (!html) return ['—'];
  const div = document.createElement('div');
  div.innerHTML = html;
  const paras = [];
  div.querySelectorAll('p, br').forEach(el => {
    paras.push(el.textContent || '');
  });
  return paras.length > 0 ? paras : [div.textContent || '—'];
}

// Converte HTML rico em runs do Word com formatação
function htmlParaRuns(html) {
  if (!html) return [new TextRun({ text: '—', size: 20, font: 'Arial' })];
  const div = document.createElement('div');
  div.innerHTML = html;
  const runs = [];

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ text: node.textContent });
      return;
    }
    const tag = node.tagName?.toLowerCase();
    const style = node.getAttribute?.('style') || '';
    const colorMatch = style.match(/color:\s*([^;]+)/);
    const color = colorMatch ? colorMatch[1].trim().replace('#','') : null;
    const bold = tag === 'strong' || tag === 'b';
    const italic = tag === 'em' || tag === 'i';

    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE && child.textContent) {
        runs.push({ text: child.textContent, bold, italic, color });
      } else {
        processNode(child);
      }
    });
  }

  div.childNodes.forEach(processNode);
  return runs.map(r => new TextRun({
    text: r.text || '',
    bold: r.bold || false,
    italics: r.italic || false,
    color: r.color || undefined,
    size: 20, font: 'Arial'
  }));
}

// ── Presença / lock ──
let _presencaInterval = null;   // heartbeat de atividade
let _versaoAberta     = null;   // versao do relatório quando foi aberto (para detectar conflito)
const PRESENCA_TTL    = 5 * 60 * 1000;  // 5 min sem atividade = libera
const PRESENCA_HB     = 60 * 1000;      // heartbeat a cada 1 min

// ═══════════════════════════════════════════════
//  PRESENÇA — quem está editando
// ═══════════════════════════════════════════════
async function registrarPresenca(relatorioId) {
  if (!currentUser || !relatorioId) return;
  await supa.from('relatorios_ativo').upsert({
    relatorio_id:      relatorioId,
    user_id:           currentUser.id,
    user_email:        currentUser.email,
    ultima_atividade:  new Date().toISOString(),
  }, { onConflict: 'relatorio_id' });
}

async function removerPresenca(relatorioId) {
  if (!currentUser || !relatorioId) return;
  await supa.from('relatorios_ativo')
    .delete()
    .eq('relatorio_id', relatorioId)
    .eq('user_id', currentUser.id);
}

async function verificarPresenca(relatorioId) {
  // Retorna { ocupado: bool, email: string|null }
  const { data } = await supa.from('relatorios_ativo')
    .select('user_email, ultima_atividade')
    .eq('relatorio_id', relatorioId)
    .single();
  if (!data) return { ocupado: false, email: null };
  // Verifica se ainda está dentro do TTL
  const diff = Date.now() - new Date(data.ultima_atividade).getTime();
  if (diff > PRESENCA_TTL) {
    // Registro expirado — limpa e libera
    await supa.from('relatorios_ativo').delete().eq('relatorio_id', relatorioId);
    return { ocupado: false, email: null };
  }
  // É o próprio usuário?
  if (data.user_email === currentUser.email) return { ocupado: false, email: null };
  return { ocupado: true, email: data.user_email };
}

function iniciarHeartbeat(relatorioId) {
  pararHeartbeat();
  _presencaInterval = setInterval(() => registrarPresenca(relatorioId), PRESENCA_HB);
  // Atualiza presença a cada interação do usuário
  document.addEventListener('keydown', _heartbeatHandler);
  document.addEventListener('click',   _heartbeatHandler);
}

function pararHeartbeat() {
  if (_presencaInterval) { clearInterval(_presencaInterval); _presencaInterval = null; }
  document.removeEventListener('keydown', _heartbeatHandler);
  document.removeEventListener('click',   _heartbeatHandler);
}

let _heartbeatThrottle = 0;
function _heartbeatHandler(e) {
  // Se o usuário interagiu com um campo de formulário, marca como editado
  const tag = e.target && e.target.tagName;
  if (['INPUT','TEXTAREA','SELECT'].includes(tag)) {
    _relatorioRecemCriado = null; // usuário editou — não excluir ao sair
  }
  const agora = Date.now();
  if (agora - _heartbeatThrottle < 30000) return; // no máximo 1 vez a cada 30s
  _heartbeatThrottle = agora;
  if (currentId) registrarPresenca(currentId);
}

function mostrarBannerPresenca(email) {
  let banner = document.getElementById('bannerPresenca');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bannerPresenca';
    const isMobile = window.innerWidth <= 600;
    banner.style.cssText = isMobile ? [
      'position:fixed', 'top:60px', 'left:8px', 'right:8px',
      'background:#c0392b', 'color:#fff', 'border-radius:10px',
      'padding:14px 16px', 'z-index:999',
      'box-shadow:0 6px 32px rgba(0,0,0,0.45)',
      'font-family:var(--font-cond)', 'font-size:14px', 'font-weight:600',
      'display:flex', 'align-items:flex-start', 'gap:10px',
      'text-align:left', 'line-height:1.4',
      'animation:bannerEntrada 0.3s ease',
      'border:2px solid rgba(255,255,255,0.25)'
    ].join(';') : [
      'position:fixed', 'top:66px', 'left:50%', 'transform:translateX(-50%)',
      'background:#c0392b', 'color:#fff', 'border-radius:10px',
      'padding:14px 22px', 'z-index:999',
      'box-shadow:0 6px 32px rgba(0,0,0,0.45)',
      'font-family:var(--font-cond)', 'font-size:15px', 'font-weight:600',
      'display:flex', 'align-items:center', 'gap:12px',
      'max-width:680px', 'width:max-content', 'text-align:center', 'line-height:1.4',
      'animation:bannerEntrada 0.3s ease',
      'border:2px solid rgba(255,255,255,0.25)'
    ].join(';');
    document.body.appendChild(banner);
  }
  const nome = fmtUsuario(email);
  banner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      style="width:22px;height:22px;flex-shrink:0">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span>⚠️ <strong>${nome}</strong> está editando este relatório no momento.<br>
    <span style="font-size:12px;font-weight:400;opacity:0.9">
      Suas alterações podem ser sobrescritas. Aguarde ou avise a pessoa.</span></span>
    <button onclick="ocultarBannerPresenca()"
      style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:6px;
             padding:4px 10px;cursor:pointer;font-size:13px;flex-shrink:0">✕</button>`;
}

function ocultarBannerPresenca() {
  const b = document.getElementById('bannerPresenca');
  if (b) b.remove();
}

function confirmarExcluir() {
  if (!currentId) { showAlert('Nenhum relatório aberto.', 'warn'); return; }
  const r = relatorios.find(x => x.id === currentId);
  const isAdmin = currentUser?.role === 'admin';
  if (!isAdmin && r?.user_id !== currentUser?.id) {
    showAlert('Você não pode excluir relatórios de outros usuários.', 'err');
    return;
  }
  _excluirTargetId = currentId;
  document.getElementById('modalExcluirMsg').textContent =
    `Tem certeza que deseja excluir o Relatório #${r ? String(r.numero).padStart(3,'0') : '?'}? Esta ação não pode ser desfeita.`;
  document.getElementById('modalExcluir').classList.add('open');
}

async function duplicarRelatorio(id) {
  const { data: orig, error } = await supa.from('relatorios').select('*').eq('id', id).single();
  if (error) { showAlert('Erro ao duplicar: ' + error.message, 'err'); return; }
  const num = (relatorios.length > 0 ? Math.max(...relatorios.map(r => r.numero)) : 0) + 1;
  const hoje = new Date().toISOString().slice(0, 10);
  orig.fotos = Array.isArray(orig.fotos) ? orig.fotos : (orig.fotos ? Object.values(orig.fotos) : []);
  const { id: _, atualizado_em: __, _tamanho: ___, ...campos } = orig;
  const novo = { ...campos, numero: num, data: hoje, assin_data: hoje, atualizado_em: new Date().toISOString(), user_id: currentUser.id };
  const { data, error: err2 } = await supa.from('relatorios').insert([novo]).select().single();
  if (err2) { showAlert('Erro ao duplicar: ' + err2.message, 'err'); return; }
  relatorios.unshift(data);
  showAlert(`Relatório #${num} criado como cópia!`, 'ok');
  carregarLista();
}

async function excluirRelatorio() {
  const targetId = _excluirTargetId || currentId;
  if (!targetId) return;
  // Mover para lixeira (soft delete)
  const { error } = await supa.from('relatorios').update({
    excluido_em:  new Date().toISOString(),
    excluido_por: currentUser.email,
  }).eq('id', targetId);
  if (error) { showAlert('Erro ao excluir: ' + error.message, 'err'); fecharModal('modalExcluir'); return; }
  relatorios = relatorios.filter(r => r.id !== targetId);
  if (currentId === targetId) {
    pararHeartbeat();
    ocultarBannerPresenca();
    removerPresenca(targetId);
    currentId = null;
    currentRelatorio = null;
  }
  _excluirTargetId = null;
  fecharModal('modalExcluir');
  showAlert('Relatório movido para a lixeira. Você tem 15 dias para recuperar.', 'warn');
  exibirLista();
  atualizarBadgeLixeira();
}

// (confirmarExcluir definida acima)

// ═══════════════════════════════════════════════
//  PERFIL DO USUÁRIO
// ═══════════════════════════════════════════════
async function abrirPerfil() {
  document.getElementById('modalPerfil').classList.add('open');
  document.getElementById('perfilMsg').style.display = 'none';
  document.getElementById('perfilSenha').value = '';
  document.getElementById('perfilSenhaConf').value = '';
  // Preencher dados atuais
  const { data: u } = await supa.from('usuarios').select('nome, email').eq('id', currentUser.id).single();
  document.getElementById('perfilNome').value  = u?.nome  || currentUser.email.split('@')[0];
  document.getElementById('perfilEmail').value = u?.email || currentUser.email;
}

async function salvarPerfil() {
  const nome     = document.getElementById('perfilNome').value.trim();
  const email    = document.getElementById('perfilEmail').value.trim();
  const senha    = document.getElementById('perfilSenha').value;
  const senhaConf= document.getElementById('perfilSenhaConf').value;
  const msg      = document.getElementById('perfilMsg');

  const showMsg = (txt, ok) => {
    msg.textContent = txt;
    msg.style.display = 'block';
    msg.style.background = ok ? '#e8f5e9' : '#fdecea';
    msg.style.color = ok ? '#27ae60' : '#c0392b';
    msg.style.border = `1px solid ${ok ? '#a5d6a7' : '#f5c6cb'}`;
  };

  if (!nome) { showMsg('Informe seu nome.', false); return; }
  if (!email) { showMsg('Informe seu e-mail.', false); return; }
  if (senha && senha !== senhaConf) { showMsg('As senhas não coincidem.', false); return; }
  if (senha && senha.length < 6) { showMsg('A senha deve ter pelo menos 6 caracteres.', false); return; }

  try {
    // Atualiza tabela usuarios
    const { error: errNome } = await supa.from('usuarios').update({ nome, email }).eq('id', currentUser.id);
    if (errNome) { showMsg('Erro ao salvar nome: ' + errNome.message, false); return; }

    // Atualiza e-mail no auth se mudou
    if (email !== currentUser.email) {
      const { error: errEmail } = await supa.auth.updateUser({ email });
      if (errEmail) { showMsg('Erro ao alterar e-mail: ' + errEmail.message, false); return; }
    }

    // Atualiza senha se preenchida
    if (senha) {
      const { error: errSenha } = await supa.auth.updateUser({ password: senha });
      if (errSenha) { showMsg('Erro ao alterar senha: ' + errSenha.message, false); return; }
    }

    // Atualiza exibição
    currentUser.email = email;
    document.getElementById('userEmail').textContent = email;
    showMsg('Perfil atualizado com sucesso!', true);
    setTimeout(() => fecharModal('modalPerfil'), 1500);
  } catch(e) {
    showMsg('Erro inesperado: ' + e.message, false);
  }
}

// ═══════════════════════════════════════════════
//  LIXEIRA
// ═══════════════════════════════════════════════
const LIXEIRA_DIAS = 15;

async function atualizarBadgeUso() {
  try {
    // Executa SQL direto via rpc para pegar tamanho real do banco
    const { data, error } = await supa.rpc('db_size');
    let bytes = null;

    if (!error && data !== null) {
      // data é o tamanho em bytes retornado pela função RPC
      bytes = Number(data);
    }

    if (bytes === null) {
      // Fallback: estimativa por JSON (caso a função RPC não exista ainda)
      const { data: d } = await supa.from('relatorios').select('*').limit(1000);
      bytes = d ? new Blob([JSON.stringify(d)]).size : 0;
    }

    const txt   = document.getElementById('badgeUsoDbTxt');
    const badge = document.getElementById('badgeUsoDb');
    if (!txt || !badge) return;

    txt.textContent = fmtBytes(bytes);
    badge.title = `Tamanho real do banco de dados (limite free: 500 MB)`;

    // Cor conforme uso
    const pct = bytes / (500 * 1024 * 1024);
    badge.style.borderColor = pct > 0.8 ? 'var(--signal)' : pct > 0.5 ? 'var(--accent)' : 'rgba(255,255,255,0.15)';
    badge.style.color       = pct > 0.8 ? 'var(--signal)' : pct > 0.5 ? 'var(--accent)' : 'rgba(255,255,255,0.75)';
  } catch(e) { console.warn('badgeUso:', e); }
}

async function atualizarBadgeLixeira() {
  const { count } = await supa.from('relatorios')
    .select('id', { count: 'exact', head: true })
    .not('excluido_em', 'is', null);
  ['badgeLixeira','badgeLixeiraForm'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  });
}

async function abrirLixeira() {
  document.getElementById('modalLixeira').classList.add('open');
  const conteudo = document.getElementById('lixeiraConteudo');
  conteudo.innerHTML = '<div style="text-align:center;padding:24px;color:var(--ink-light)">Carregando...</div>';

  // Botão limpar só para admin
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('btnLimparLixeira').style.display = isAdmin ? 'flex' : 'none';

  const { data, error } = await supa.from('relatorios')
    .select('id, numero, obra, localidade, excluido_em, excluido_por, criado_por')
    .not('excluido_em', 'is', null)
    .order('excluido_em', { ascending: false });

  if (error) { conteudo.innerHTML = `<p style="color:var(--signal)">Erro: ${error.message}</p>`; return; }
  if (!data || data.length === 0) {
    conteudo.innerHTML = '<div style="text-align:center;padding:32px;color:var(--ink-light)">🗑️ Lixeira vazia</div>';
    return;
  }

  conteudo.innerHTML = data.map(r => {
    const excluido = new Date(r.excluido_em);
    const expira   = new Date(excluido.getTime() + LIXEIRA_DIAS * 24 * 60 * 60 * 1000);
    const diasRestantes = Math.ceil((expira - Date.now()) / (24 * 60 * 60 * 1000));
    const diasCls = diasRestantes <= 2 ? 'urgente' : diasRestantes <= 7 ? 'normal' : 'ok';
    const diasTxt = diasRestantes <= 0 ? 'Expirando hoje' : `${diasRestantes}d restantes`;
    return `
      <div class="lixeira-item">
        <div class="lixeira-item-info">
          <div class="lixeira-item-num">#${String(r.numero).padStart(3,'0')}</div>
          <div class="lixeira-item-obra">${r.obra || '(sem nome)'}</div>
          <div class="lixeira-item-meta">
            ${r.localidade ? `📍 ${r.localidade} · ` : ''}
            🗑️ Excluído por ${fmtUsuario(r.excluido_por || '')} em ${fmtDataHora(r.excluido_em)}
          </div>
        </div>
        <span class="lixeira-dias ${diasCls}">${diasTxt}</span>
        <button class="btn btn-ok btn-sm" onclick="recuperarRelatorio('${r.id}')" title="Recuperar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          <span class="btn-hide-mobile">Recuperar</span>
        </button>
      </div>`;
  }).join('');
}

async function recuperarRelatorio(id) {
  const { error } = await supa.from('relatorios').update({
    excluido_em:  null,
    excluido_por: null,
  }).eq('id', id);
  if (error) { showAlert('Erro ao recuperar: ' + error.message, 'err'); return; }
  showAlert('Relatório recuperado com sucesso!', 'ok');
  await carregarLista();
  atualizarBadgeLixeira();
  abrirLixeira(); // recarrega a lista da lixeira
}

async function confirmarLimparLixeira() {
  const isAdmin = currentUser?.role === 'admin';
  if (!isAdmin) { showAlert('Apenas administradores podem limpar a lixeira.', 'err'); return; }
  if (!window.confirm('⚠️ Isso vai excluir PERMANENTEMENTE todos os relatórios da lixeira. Não tem como desfazer. Continuar?')) return;

  // Busca IDs dos excluídos e deleta permanentemente
  const { data } = await supa.from('relatorios').select('id').not('excluido_em', 'is', null);
  if (!data || data.length === 0) { showAlert('Lixeira já está vazia.', 'warn'); return; }
  const ids = data.map(r => r.id);
  const { error } = await supa.from('relatorios').delete().in('id', ids);
  if (error) { showAlert('Erro ao limpar: ' + error.message, 'err'); return; }
  showAlert(`${ids.length} relatório(s) excluído(s) permanentemente.`, 'warn');
  fecharModal('modalLixeira');
  atualizarBadgeLixeira();
}

// ═══════════════════════════════════════════════
//  UI — FORMULÁRIO
// ═══════════════════════════════════════════════
function carregarFormulario() {
  const r = getRelatorioAtual();
  if (!r) return;
  const num = String(r.numero).padStart(3,'0');
  document.getElementById('displayNum').textContent = num;
  // Mostrar criador no topo do formulário
  let elCriador = document.getElementById('infoCriador');
  if (!elCriador) {
    elCriador = document.createElement('div');
    elCriador.id = 'infoCriador';
    elCriador.style.cssText = 'font-size:12px;color:var(--ink-light);margin-bottom:10px;padding:5px 10px;background:var(--surface-2);border-radius:6px;display:inline-flex;align-items:center;gap:6px';
    const formBody = document.querySelector('.form-body');
    if (formBody) formBody.insertBefore(elCriador, formBody.firstChild);
  }
  elCriador.innerHTML = r.criado_por
    ? `🧑‍💼 Criado por: <strong>${fmtUsuario(r.criado_por)}</strong>`
    : `🧑‍💼 Criado por: <strong>${fmtUsuario(r.user_id)}</strong>`;
  document.getElementById('headerNum').textContent  = `#${r.numero}`;
  document.getElementById('badgeNum').textContent   = `VISITA #${r.numero}`;
  document.getElementById('badgeDate').textContent  = r.data ? fmtData(r.data) : '—';
  document.getElementById('fieldData').value        = r.data || '';
  document.getElementById('fieldDataFim').value     = r.data_fim || '';
  document.getElementById('fieldCliente').value     = r.cliente || '';
  document.getElementById('fieldObra').value        = r.obra || '';
  document.getElementById('fieldCC').value          = r.cc || '';
  document.getElementById('fieldLocalidade').value  = r.localidade || '';
  document.getElementById('fieldResponsavel').value = r.responsavel || '';
  document.getElementById('fieldCargo').value       = r.cargo || '';
  setTimeout(() => { setEditorHtml(_quillObjetivo, r.objetivo || ''); }, 80);
  setTimeout(() => { setEditorHtml(_quillObservacoes, r.observacoes || ''); }, 80);
  document.getElementById('fieldSituacao').value    = r.situacao || '';

  setTimeout(() => { setEditorHtml(_quillParecer, r.parecer || ''); }, 80);
  document.getElementById('fieldAssinNome').value   = r.assin_nome || '';
  document.getElementById('fieldAssinData').value   = r.assin_data || '';
  renderizarFotos();
  // Mostra tamanho
  const badgeSz = document.getElementById('badgeTamanho');
  if (badgeSz && r) {
    const bytes = new Blob([JSON.stringify(r)]).size;
    badgeSz.textContent = '💾 ' + fmtBytes(bytes);
  }
}

function renderizarHistorico() {
  const list = document.getElementById('historyList');
  const q    = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const arr  = [...relatorios].sort((a,b) => b.numero - a.numero);
  const fil  = arr.filter(r =>
    String(r.numero).includes(q) || (r.data||'').includes(q) ||
    (r.localidade||'').toLowerCase().includes(q) || (r.obra||'').toLowerCase().includes(q)
  );
  if (!fil.length) { list.innerHTML = '<div class="history-empty">Nenhum resultado.</div>'; return; }
  list.innerHTML = fil.map(r => `
    <div class="history-item ${r.id === currentId ? 'active' : ''}" onclick="abrirRelatorio('${r.id}')">
      <div class="history-item-num">Visita #${r.numero}</div>
      <div class="history-item-date">${r.data ? fmtData(r.data) : '—'}</div>
      <div class="history-item-date" style="font-size:10px;opacity:.7">${r.obra || r.localidade || '—'}</div>
    </div>
  `).join('');
}

function filtrarHistorico() { renderizarHistorico(); }

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', (i===0&&tab==='form')||(i===1&&tab==='config')));
  document.getElementById('tabForm').style.display   = tab==='form' ? '' : 'none';
  document.getElementById('tabConfig').style.display = tab==='config' ? '' : 'none';
  if (tab==='config') carregarCamposConfig();
}

// ═══════════════════════════════════════════════
//  CONFIG LOCAL
// ═══════════════════════════════════════════════
function carregarConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : {};
}

function salvarConfig() {
  const cfg = {
    cliente:     document.getElementById('cfgCliente').value.trim(),
    obra:        document.getElementById('cfgObra').value.trim(),
    cc:          document.getElementById('cfgCC').value.trim(),
    localidade:  document.getElementById('cfgLocalidade').value.trim(),
    responsavel: document.getElementById('cfgResponsavel').value.trim(),
    cargo:       document.getElementById('cfgCargo').value.trim(),
    registro:    document.getElementById('cfgRegistro').value.trim(),
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  showAlert('Dados da obra salvos!', 'ok');
}

function carregarCamposConfig() {
  const cfg = carregarConfig();
  document.getElementById('cfgCliente').value     = cfg.cliente || '';
  document.getElementById('cfgObra').value        = cfg.obra || '';
  document.getElementById('cfgCC').value          = cfg.cc || '';
  document.getElementById('cfgLocalidade').value  = cfg.localidade || '';
  document.getElementById('cfgResponsavel').value = cfg.responsavel || '';
  document.getElementById('cfgCargo').value       = cfg.cargo || '';
  document.getElementById('cfgRegistro').value    = cfg.registro || '';
}

// ═══════════════════════════════════════════════
//  FOTOS
// ═══════════════════════════════════════════════
function prepararNovaFotoBtn(camera) {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Abra um relatório primeiro.', 'warn'); return; }
  if (!r.fotos) r.fotos = [];
  const reg = { id: uid(), base64: '', local: '', descricao: '', timestamp: new Date().toISOString(), largura: 0, altura: 0 };
  r.fotos.push(reg);
  renderizarFotos();
  _pendingFotoId = reg.id;
  const inp = document.getElementById(camera ? 'inputFotoCamera' : 'inputFotoGaleria');
  if (inp) { inp.value = ''; setTimeout(() => inp.click(), 0); }
}

function processarFotoInput(event) {
  const r = getRelatorioAtual();
  if (!r) { event.target.value=''; return; }
  if (!_pendingFotoId) {
    if (!r.fotos) r.fotos = [];
    const reg = { id: uid(), base64: '', local: '', descricao: '', timestamp: new Date().toISOString(), largura: 0, altura: 0 };
    r.fotos.push(reg);
    _pendingFotoId = reg.id;
  }
  const file = event.target.files && event.target.files[0];
  if (!file) { event.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900; let w = img.width, h = img.height;
      if (w>MAX||h>MAX) { if(w>h) { h=Math.round(h*MAX/w); w=MAX; } else { w=Math.round(w*MAX/h); h=MAX; } }
      const canvas = document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      const base64 = canvas.toDataURL('image/jpeg',0.72);
      const reg = r.fotos.find(f=>f.id===_pendingFotoId);
      if (reg) { reg.base64=base64; reg.largura=w; reg.altura=h; }
      _pendingFotoId = null;
      renderizarFotos();
      showAlert('Foto adicionada!','ok');
    };
    img.onerror = () => { showAlert('Erro ao carregar imagem.','err'); _pendingFotoId=null; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value='';
}

function trocarFotoBtn(fotoId, camera) {
  _pendingFotoId = fotoId;
  document.getElementById('inputFotoCamera').value  = '';
  document.getElementById('inputFotoGaleria').value = '';
  const inp = document.getElementById(camera ? 'inputFotoCamera' : 'inputFotoGaleria');
  setTimeout(() => inp.click(), 0);
}

function excluirFotoRegistro(fotoId) {
  const r = getRelatorioAtual();
  if (!r) return;
  r.fotos = (r.fotos||[]).filter(f => f.id !== fotoId);
  renderizarFotos();
  showAlert('Foto removida.','warn');
}

function salvarCamposFoto(fotoId) {
  const r = getRelatorioAtual(); if (!r) return;
  const reg = (r.fotos||[]).find(f=>f.id===fotoId); if (!reg) return;
  const le = document.getElementById(`local_${fotoId}`);
  const de = document.getElementById(`desc_${fotoId}`);
  if (le) reg.local     = le.value;
  if (de) reg.descricao = de.value;
}

function renderizarFotos() {
  const r = getRelatorioAtual();
  const fotos = r && r.fotos ? r.fotos : [];
  const n = fotos.length;
  const txt = `${n} foto${n!==1?'s':''}`;
  if (document.getElementById('badgeFotos'))    document.getElementById('badgeFotos').textContent    = txt;
  if (document.getElementById('fotoBadgeCard')) document.getElementById('fotoBadgeCard').textContent = txt;
  // Mostra tamanho no badge
  const r2 = getRelatorioAtual();
  const badgeSz = document.getElementById('badgeTamanho');
  if (badgeSz && r2) {
    const bytes = new Blob([JSON.stringify(r2)]).size;
    badgeSz.textContent = '💾 ' + fmtBytes(bytes);
  }
  const list  = document.getElementById('fotoRegistroList');
  const empty = document.getElementById('fotoEmpty');
  if (!list) return;
  if (fotos.length === 0) { list.innerHTML=''; if(empty) empty.style.display=''; return; }
  if (empty) empty.style.display='none';
  list.innerHTML = fotos.map((f,idx) => {
    const ts = f.timestamp ? new Date(f.timestamp).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    const imgArea = f.base64
      ? `<img src="${f.base64}" alt="Foto ${idx+1}" onclick="abrirViewer('${f.id}')" title="Ampliar">
         <button type="button" class="foto-trocar-btn" onclick="trocarFotoBtn('${f.id}',false)">🔄 Trocar</button>`
      : `<button type="button" class="foto-sem-imagem" onclick="trocarFotoBtn('${f.id}',false)">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
           Toque para adicionar foto
         </button>`;
    return `
      <div class="foto-registro" id="reg_${f.id}">
        <div class="foto-registro-header">
          <div class="foto-registro-num" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="dot"></span>FOTO ${String(idx+1).padStart(2,'0')}${f.local?` <span style="font-weight:400;color:var(--ink-light);font-size:12px">— ${f.local}</span>`:''}</div>
          <button class="btn btn-danger btn-sm" onclick="excluirFotoRegistro('${f.id}')" title="Remover foto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            <span class="btn-hide-mobile">Remover</span>
          </button>
        </div>
        <div class="foto-registro-body">
          <div class="foto-registro-img-wrap">${imgArea}</div>
          <div class="foto-registro-content">
            <div class="foto-local-wrap">
              <div class="foto-local-label">📍 Local / Área Visitada</div>
              <input type="text" class="foto-local-input" id="local_${f.id}" value="${escHtml(f.local)}" placeholder="ex: Sala de Máquinas..." onchange="salvarCamposFoto('${f.id}')" oninput="salvarCamposFoto('${f.id}')">
            </div>
            <div class="foto-desc-wrap">
              <div class="foto-desc-label">📝 Descrição</div>
              <textarea class="foto-desc-textarea" id="desc_${f.id}" placeholder="Descreva o que a foto mostra..." onchange="salvarCamposFoto('${f.id}')" oninput="salvarCamposFoto('${f.id}')">${escHtml(f.descricao)}</textarea>
            </div>
          </div>
        </div>
        <div class="foto-registro-footer">
          <span class="foto-ts">${ts?'🕐 '+ts:''}</span>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-steel btn-sm" onclick="trocarFotoBtn('${f.id}',true)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Câmera
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="trocarFotoBtn('${f.id}',false)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
              Galeria
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function abrirViewer(fotoId) {
  const r = getRelatorioAtual(); if (!r) return;
  const f = (r.fotos||[]).find(x=>x.id===fotoId);
  if (!f||!f.base64) return;
  document.getElementById('viewerImg').src = f.base64;
  document.getElementById('viewerInfo').textContent = f.local ? `📍 ${f.local}` : '';
  document.getElementById('fotoViewer').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function fecharViewer(e) { if(e.target===document.getElementById('fotoViewer')) fecharViewerBtn(); }
function fecharViewerBtn() { document.getElementById('fotoViewer').classList.remove('open'); document.body.style.overflow=''; }

// ═══════════════════════════════════════════════
//  EXPORTAR PDF
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
    const fotosHtml = (r.fotos||[]).map((f,i) => `
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
// ═══════════════════════════════════════════════
async function exportarWord() {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Nenhum relatório aberto.', 'warn'); return; }
  // Coleta campos atuais do formulário
  r.data           = document.getElementById('fieldData').value || null;
  r.obra           = document.getElementById('fieldObra').value;
  r.cliente        = document.getElementById('fieldCliente').value;
  r.localidade     = document.getElementById('fieldLocalidade').value;
  r.responsavel    = document.getElementById('fieldResponsavel').value;
  r.cargo          = document.getElementById('fieldCargo').value;
  r.objetivo       = getEditorHtml(_quillObjetivo);
  r.observacoes    = getEditorHtml(_quillObservacoes);
  r.situacao       = document.getElementById('fieldSituacao').value;
  r.parecer        = getEditorHtml(_quillParecer);
  r.assin_nome     = document.getElementById('fieldAssinNome').value;
  r.assin_data     = document.getElementById('fieldAssinData').value;
  r.cc             = document.getElementById('fieldCC').value;
  (r.fotos||[]).forEach(f => { salvarCamposFoto(f.id); });

  if (typeof docx === 'undefined') {
    showAlert('Biblioteca docx.js não carregada. Verifique conexão.', 'err');
    return;
  }

  // Mostrar overlay
  const ov = document.getElementById('exportOverlay');
  const msg = document.getElementById('exportMsg');
  ov.classList.add('open');
  msg.textContent = 'Preparando documento...';

  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            ImageRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
            ShadingType, VerticalAlign, PageBreak, PageNumber, Header, Footer } = docx;

    await new Promise(r => setTimeout(r, 50));
    msg.textContent = 'Processando fotos...';
    await new Promise(r => setTimeout(r, 30));

    // Helpers
    const cel = (text, w, bold, shade) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      borders: { top: bd(), bottom: bd(), left: bd(), right: bd() },
      children: [new Paragraph({ children: [new TextRun({ text: String(text||'—'), bold: !!bold, size: 20, font: 'Arial' })] })],
    });
    const bd = () => ({ style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' });
    const bds = () => ({ top: bd(), bottom: bd(), left: bd(), right: bd() });

    function rowInfo(label, value) {
      return new TableRow({ children: [
        new TableCell({ width: { size: 2800, type: WidthType.DXA }, shading: { fill: 'E8EDF3', type: ShadingType.CLEAR }, margins: { top:80,bottom:80,left:120,right:120 }, borders: bds(),
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial', color: '1A2940' })] })] }),
        new TableCell({ width: { size: 6560, type: WidthType.DXA }, margins: { top:80,bottom:80,left:120,right:120 }, borders: bds(),
          children: [new Paragraph({ children: [new TextRun({ text: String(value||'—'), size: 20, font: 'Arial' })] })] }),
      ]});
    }

    function secTitle(text) {
      return new Paragraph({
        spacing: { before: 280, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E8A020', space: 4 } },
        children: [new TextRun({ text, bold: true, size: 26, font: 'Arial', color: '1A2940' })],
      });
    }

    function bloco(text) {
      const linhas = String(text||'—').split('\n');
      return linhas.map((linha, i) => new Paragraph({
        spacing: { before: i === 0 ? 60 : 0, after: i === linhas.length - 1 ? 60 : 40 },
        children: [new TextRun({ text: linha, size: 20, font: 'Arial' })],
      }));
    }

    function pushBloco(children, text) {
      const items = bloco(text);
      items.forEach(p => children.push(p));
    }

    const children = [];

    // ── Logo no cabeçalho do Word — mesmo arquivo do login ──
    try {
      const resp = await fetch('logo-clemar-cores.png');
      const buf  = await resp.arrayBuffer();
      const arr  = new Uint8Array(buf);
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new ImageRun({
          data: arr,
          transformation: { width: 200, height: 60 },
        })],
      }));
    } catch(e) { console.warn('Logo Word:', e); }

    // ── Cabeçalho do documento ──
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 180 },
      children: [new TextRun({ text: 'RELATÓRIO DE VISITA DE OBRA', bold: true, size: 36, font: 'Arial', color: '1A2940' })],
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: 'Clemar Engenharia', size: 24, font: 'Arial', color: '888888' })],
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: 'E8A020', space: 4 } },
      children: [new TextRun({ text: `Visita Nº ${String(r.numero).padStart(3,'0')}  ·  ${r.data ? fmtData(r.data) : '—'}`, size: 22, font: 'Arial', color: 'E8A020', bold: true })],
    }));

    // ── 01 Identificação ──
    children.push(secTitle('01 — IDENTIFICAÇÃO DA VISITA'));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        rowInfo('Nº do Relatório', String(r.numero).padStart(3,'0')),
        rowInfo('Início da Inspeção', r.data ? fmtData(r.data) : '—'),
        rowInfo('Fim da Inspeção', r.data_fim ? fmtData(r.data_fim) : '—'),
        rowInfo('Cliente', r.cliente),
        rowInfo('Obra / Projeto', r.obra),
        rowInfo('Centro de Custo', r.cc),
        rowInfo('Localidade', r.localidade),
        rowInfo('Responsável', r.responsavel),
        rowInfo('Cargo / Função', r.cargo),
      ],
    }));

    // ── 02 Objetivo ──
    children.push(secTitle('02 — OBJETIVO DA VISITA'));
    // Objetivo com formatação rica
    const parasObj = (r.objetivo||'').split(/<\/p>|<br>/).filter(Boolean);
    if (parasObj.length <= 1) {
      children.push(new Paragraph({ spacing:{before:60,after:60}, children: htmlParaRuns(r.objetivo) }));
    } else {
      const divObj = document.createElement('div');
      divObj.innerHTML = r.objetivo || '';
      divObj.querySelectorAll('p').forEach((p,i,arr) => {
        children.push(new Paragraph({ spacing:{before:i===0?60:0,after:i===arr.length-1?60:30}, children: htmlParaRuns(p.innerHTML) }));
      });
    }

    // ── 03 Registro Fotográfico ──
    msg.textContent = 'Inserindo fotos no documento...';
    await new Promise(x => setTimeout(x, 30));

    children.push(secTitle('03 — REGISTRO FOTOGRÁFICO'));

    if (!r.fotos || r.fotos.length === 0) {
      children.push(bloco('Nenhuma foto registrada nesta visita.'));
    } else {
      for (let i = 0; i < r.fotos.length; i++) {
        const f = r.fotos[i];
        msg.textContent = `Processando foto ${i+1} de ${r.fotos.length}...`;
        await new Promise(x => setTimeout(x, 20));

        // Número da foto
        children.push(new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [
            new TextRun({ text: `FOTO ${String(i+1).padStart(2,'0')}`, bold: true, size: 22, font: 'Arial', color: 'E8A020' }),
            new TextRun({ text: f.local ? `  —  ${f.local}` : '', size: 20, font: 'Arial', color: '1A2940' }),
          ],
        }));

        // Imagem
        if (f.base64 && f.base64.length > 100) {
          try {
            // data URI passado diretamente para ImageRun
            // Dimensões em pixels (ImageRun recebe px, não EMU)
            const maxPxW = 530;
            let pxW, pxH;
            if (f.largura && f.altura && f.largura > 0) {
              const ratio = f.altura / f.largura;
              pxW = Math.min(f.largura, maxPxW);
              pxH = Math.round(pxW * ratio);
              const maxPxH = 420;
              if (pxH > maxPxH) { pxH = maxPxH; pxW = Math.round(pxH / ratio); }
            } else {
              pxW = maxPxW; pxH = Math.round(maxPxW * 0.75);
            }
            children.push(new Paragraph({
              spacing: { before: 40, after: 60 },
              children: [new ImageRun({ data: f.base64, transformation: { width: pxW, height: pxH } })],
            }));
          } catch(e) {
            console.error('ImageRun erro:', e); children.push(bloco('[Foto ' + (i+1) + ': ' + e.message + ']'));
          }
        } else {
          children.push(bloco('[Sem foto]'));
        }

        // Descrição
        children.push(new Paragraph({
          spacing: { before: 60, after: 40 },
          children: [new TextRun({ text: '📍 Local: ', bold: true, size: 20, font: 'Arial', color: '1A2940' }),
                     new TextRun({ text: f.local || '—', size: 20, font: 'Arial' })],
        }));
        children.push(new Paragraph({
          spacing: { before: 40, after: 60 },
          children: [new TextRun({ text: '📝 Descrição: ', bold: true, size: 20, font: 'Arial', color: '1A2940' }),
                     new TextRun({ text: f.descricao || '—', size: 20, font: 'Arial' })],
        }));
        children.push(new Paragraph({
          spacing: { before: 20, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0', space: 2 } },
          children: [],
        }));
      }
    }

    // ── 04 Observações ──
    children.push(secTitle('04 — OBSERVAÇÕES GERAIS'));
    const divObs = document.createElement('div');
    divObs.innerHTML = r.observacoes || '—';
    const pObss = divObs.querySelectorAll('p');
    if (pObss.length > 0) {
      pObss.forEach((p,i,arr) => children.push(new Paragraph({ spacing:{before:i===0?60:0,after:i===arr.length-1?60:30}, children: htmlParaRuns(p.innerHTML) })));
    } else {
      children.push(new Paragraph({ spacing:{before:60,after:60}, children: htmlParaRuns(r.observacoes) }));
    }

    // ── 05 Conclusão ──
    children.push(secTitle('05 — CONCLUSÃO / PARECER TÉCNICO'));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        rowInfo('Situação Geral', r.situacao),
      ],
    }));
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: 'Parecer Técnico:', bold: true, size: 20, font: 'Arial' })] }));
    const divPar = document.createElement('div');
    divPar.innerHTML = r.parecer || '—';
    const pPars = divPar.querySelectorAll('p');
    if (pPars.length > 0) {
      pPars.forEach((p,i,arr) => children.push(new Paragraph({ spacing:{before:i===0?60:0,after:i===arr.length-1?60:30}, children: htmlParaRuns(p.innerHTML) })));
    } else {
      children.push(new Paragraph({ spacing:{before:60,after:60}, children: htmlParaRuns(r.parecer) }));
    }

    // ── 06 Assinatura ──
    children.push(secTitle('06 — RESPONSÁVEL PELO RELATÓRIO'));
    children.push(new Paragraph({ spacing: { before: 400, after: 0 }, children: [] }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '1A2940', space: 2 } },
      children: [new TextRun({ text: ' ', size: 20, font: 'Arial' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 60, after: 20 },
      children: [new TextRun({ text: r.assin_nome || r.responsavel || '—', bold: true, size: 22, font: 'Arial', color: '1A2940' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 20 },
      children: [new TextRun({ text: r.cargo || '—', size: 20, font: 'Arial' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 20 },
      children: [new TextRun({ text: r.assin_registro || '', size: 20, font: 'Arial', color: '555555' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: `Emitido em: ${r.assin_data ? fmtData(r.assin_data) : fmtData(r.data)}`, size: 18, font: 'Arial', color: '888888' })],
    }));

    msg.textContent = 'Gerando arquivo .docx...';
    await new Promise(x => setTimeout(x, 40));

    // Criar documento
    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } },
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      }],
    });

    const buffer = await Packer.toBlob(doc);
    const nomeArq = `Relatorio_Visita_${String(r.numero).padStart(3,'0')}_${(r.data||'').replace(/-/g,'')}_${(r.localidade||r.obra||'obra').replace(/[^a-zA-Z0-9]/g,'_').slice(0,20)}.docx`;
    downloadBlobIOS(buffer, nomeArq);
    ov.classList.remove('open');
    showAlert('Word exportado com sucesso!', 'ok');
  } catch(err) {
    ov.classList.remove('open');
    console.error(err);
    showAlert('Erro ao gerar Word: ' + err.message, 'err');
  }
}


// ── DOWNLOAD HELPERS ──
function downloadBlobIOS(blob, filename) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isIOS || isSafari) {
    // iOS/Safari: converter para base64 e usar link data URI que o Safari consegue abrir
    const reader = new FileReader();
    reader.onloadend = function() {
      const base64 = reader.result; // data:...;base64,...
      // Criar um link invisível e simular clique — funciona no Safari iOS 15+
      const a = document.createElement('a');
      a.href = base64;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Fallback: se não baixar em 1s, mostra o modal de compartilhamento
      setTimeout(() => {
        document.body.removeChild(a);
        // Verificar se o download foi iniciado (heurística)
        mostrarModalDownloadIOS(base64, filename);
      }, 800);
    };
    reader.readAsDataURL(blob);
  } else {
    const isAndroid = /android/i.test(navigator.userAgent);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // No Android, mostrar instrução pois o arquivo vai para Downloads
    if (isAndroid) {
      setTimeout(() => showAlert('Arquivo salvo em Downloads. Abra com Word ou Google Docs.', 'ok'), 800);
    }
  }
}

function mostrarModalDownloadIOS(dataUri, filename) {
  // Cria modal nativo com botão de compartilhar / salvar
  let modal = document.getElementById('modalDownloadIOS');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDownloadIOS';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,20,35,0.7);z-index:800;align-items:flex-end;justify-content:center;padding:0';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px 16px 0 0;padding:24px 20px;width:100%;max-width:480px;box-shadow:0 -8px 40px rgba(0,0,0,0.3)">
        <div style="font-family:var(--font-cond);font-size:16px;font-weight:700;color:var(--steel);margin-bottom:6px">📄 Arquivo Word Gerado</div>
        <div style="font-size:13px;color:var(--ink-light);margin-bottom:20px;line-height:1.5">
          No iPhone/Safari, toque em <strong>"Abrir arquivo"</strong> e depois use o botão 
          <strong>Compartilhar ↗</strong> para escolher onde salvar (Arquivos, Google Drive, etc).
        </div>
        <a id="iosDownloadLink" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;background:var(--ok);color:#fff;border-radius:8px;font-family:var(--font-cond);font-size:15px;font-weight:700;text-decoration:none;margin-bottom:10px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
          Abrir arquivo
        </a>
        <button onclick="fecharModalDownloadIOS()" style="display:flex;align-items:center;justify-content:center;width:100%;padding:12px;background:var(--surface-2);border:none;border-radius:8px;font-family:var(--font-cond);font-size:14px;font-weight:600;color:var(--ink-mid);cursor:pointer">
          Fechar
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const link = modal.querySelector('#iosDownloadLink');
  link.href = dataUri;
  link.download = filename;
  modal.style.display = 'flex';
}

function fecharModalDownloadIOS() {
  const modal = document.getElementById('modalDownloadIOS');
  if (modal) modal.style.display = 'none';
}


// ═══════════════════════════════════════════════
//  PASTAS
// ═══════════════════════════════════════════════
let pastas = [];
let pastaAtivaId = null; // null = todas

async function carregarPastas() {
  const { data, error } = await supa.from('pastas').select('*').order('nome');
  if (!error) pastas = data || [];
  renderizarPastasBar();
}

function pastasNivel(paiId) {
  return pastas.filter(p => {
    const pai = p.pasta_pai_id || null;
    // Comparar como string para evitar tipo misto (uuid vs null)
    return pai === paiId || String(pai) === String(paiId);
  });
}

function caminhoAte(id) {
  const caminho = [];
  let atual = pastas.find(p => p.id === id);
  while (atual) {
    caminho.unshift(atual);
    atual = pastas.find(p => p.id === atual.pasta_pai_id);
  }
  return caminho;
}

function renderizarPastasBar() {
  const bar = document.getElementById('pastasBar');
  if (!bar) return;

  const nivelAtual = pastasNivel(_pastaPaiAtualId);
  const caminho = _pastaPaiAtualId ? caminhoAte(_pastaPaiAtualId) : [];

  // Breadcrumb
  let breadcrumb = '';
  if (caminho.length > 0) {
    const crumbs = [`<button class="pasta-breadcrumb-item" onclick="navegarPasta(null)">Todos</button>`];
    caminho.forEach((p, i) => {
      crumbs.push(`<span class="pasta-breadcrumb-sep">›</span>`);
      if (i < caminho.length - 1) {
        crumbs.push(`<button class="pasta-breadcrumb-item" onclick="navegarPasta('${p.id}')">${p.nome}</button>`);
      } else {
        crumbs.push(`<span class="pasta-breadcrumb-item atual">${p.nome}</span>`);
      }
    });
    breadcrumb = `<div class="pasta-breadcrumb">${crumbs.join('')}</div>`;
  }

  // Chips — clique único entra na pasta e filtra relatórios
  const chips = nivelAtual.map(p => `
    <button class="pasta-chip ${pastaAtivaId === p.id ? 'ativa' : ''}" onclick="entrarPasta('${p.id}')">
      📁 ${p.nome}
      <span class="pasta-del" onclick="event.stopPropagation();confirmarExcluirPasta('${p.id}','${p.nome.replace(/'/g,"\'")}')" style="position:relative;z-index:2">×</span>
    </button>`).join('');

  const chipsFixos = _pastaPaiAtualId === null ? `
    <button class="pasta-chip ${pastaAtivaId === null ? 'ativa' : ''}" onclick="filtrarPasta(null)">Todos</button>
    <button class="pasta-chip sem-pasta ${pastaAtivaId === 'sem-pasta' ? 'ativa' : ''}" onclick="filtrarPasta('sem-pasta')">Sem pasta</button>
  ` : `
    <button class="pasta-chip" onclick="navegarPasta(null);filtrarPasta(null)">← Início</button>
  `;

  bar.innerHTML = `
    ${breadcrumb}
    <div class="pastas-chips-row">
      ${chipsFixos}
      ${chips}
      <button class="btn-nova-pasta" onclick="abrirModalNovaPasta()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova pasta
      </button>
    </div>`;
}

function filtrarPasta(id) {
  pastaAtivaId = id;
  renderizarPastasBar();
  renderizarLista();
}

function entrarPasta(id) {
  const temFilhos = pastas.some(p => p.pasta_pai_id === id);
  if (temFilhos) {
    // Tem subpastas — só navega, não filtra ainda
    _pastaPaiAtualId = id;
    pastaAtivaId = null;
    renderizarPastasBar();
    renderizarLista();
  } else {
    // Pasta folha — navega e filtra os relatórios
    _pastaPaiAtualId = id;
    pastaAtivaId = id;
    renderizarPastasBar();
    renderizarLista();
  }
}

function navegarPasta(paiId) {
  _pastaPaiAtualId = paiId;
  pastaAtivaId = null;
  renderizarPastasBar();
  renderizarLista();
}

function abrirModalNovaPasta() {
  document.getElementById('inputNovaPasta').value = '';

  // Mostrar onde a pasta será criada
  const titulo = document.getElementById('modalNovaPastaTitulo');
  const info   = document.getElementById('novaPastaLocalInfo');
  if (_pastaPaiAtualId) {
    const pai = pastas.find(p => p.id === _pastaPaiAtualId);
    if (titulo) titulo.textContent = '📁 Nova Subpasta';
    if (info) {
      info.style.display = 'block';
      info.innerHTML = `📂 Será criada dentro de: <strong>${pai?.nome || ''}</strong>`;
    }
  } else {
    if (titulo) titulo.textContent = '📁 Nova Pasta';
    if (info) info.style.display = 'none';
  }

  document.getElementById('modalNovaPasta').classList.add('open');
  setTimeout(() => document.getElementById('inputNovaPasta').focus(), 100);
}

async function criarPasta() {
  const nome = document.getElementById('inputNovaPasta').value.trim();
  if (!nome) return;
  const payload = { nome, criado_por: currentUser?.email };
  if (_pastaPaiAtualId) payload.pasta_pai_id = _pastaPaiAtualId;
  const { data, error } = await supa.from('pastas').insert([payload]).select().single();
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  pastas.push(data);
  pastas.sort((a,b) => a.nome.localeCompare(b.nome));
  fecharModal('modalNovaPasta');
  // Recarregar do banco mantendo o nível atual
  const paiAtual = _pastaPaiAtualId;
  await carregarPastas();
  _pastaPaiAtualId = paiAtual; // garantir que não resetou
  renderizarPastasBar();
  const nivel = paiAtual ? 'Subpasta' : 'Pasta';
  showAlert(`${nivel} "${nome}" criada!`, 'ok');
}

async function confirmarExcluirPasta(id, nome) {
  if (!confirm(`Excluir a pasta "${nome}"? Os relatórios dentro dela não serão excluídos.`)) return;
  const { error } = await supa.from('pastas').delete().eq('id', id);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  pastas = pastas.filter(p => p.id !== id);
  if (pastaAtivaId === id) pastaAtivaId = null;
  renderizarPastasBar();
  renderizarLista();
  showAlert(`Pasta excluída.`, 'warn');
}

// Mover relatório para pasta
let _moverRelatorioId = null;

async function menuMoverPasta() {
  fecharMenuCard();
  _moverRelatorioId = _menuCardId;
  // Recarregar pastas do banco para garantir dados atualizados
  await carregarPastas();
  const r = relatorios.find(x => x.id === _menuCardId);
  const list = document.getElementById('pastaSelectList');
  list.innerHTML = `
    <button class="pasta-select-item ${!r?.pasta_id ? 'selecionada' : ''}" onclick="moverParaPasta(null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      Sem pasta
    </button>
    ${[...pastas].sort((a,b) => {
      const labelA = (a.pasta_pai_id ? (pastas.find(x=>x.id===a.pasta_pai_id)?.nome||'') + ' › ' : '') + a.nome;
      const labelB = (b.pasta_pai_id ? (pastas.find(x=>x.id===b.pasta_pai_id)?.nome||'') + ' › ' : '') + b.nome;
      return labelA.localeCompare(labelB);
    }).map(p => {
      const pai = pastas.find(x => x.id === p.pasta_pai_id);
      const label = pai ? `${pai.nome} › ${p.nome}` : p.nome;
      const indent = pai ? 'padding-left:24px;' : '';
      return `
      <button class="pasta-select-item ${r?.pasta_id === p.id ? 'selecionada' : ''}" onclick="moverParaPasta('${p.id}')" style="${indent}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        ${label}
      </button>`;
    }).join('')}`;
  document.getElementById('pastaSelectOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function fecharPastaSelect() {
  document.getElementById('pastaSelectOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function moverParaPasta(pastaId) {
  fecharPastaSelect();
  if (!_moverRelatorioId) return;
  const { error } = await supa.from('relatorios').update({ pasta_id: pastaId }).eq('id', _moverRelatorioId);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  const r = relatorios.find(x => x.id === _moverRelatorioId);
  if (r) r.pasta_id = pastaId;
  const pastaAlvo = pastaId ? pastas.find(p => p.id === pastaId) : null;
  const paiAlvo = pastaAlvo ? pastas.find(p => p.id === pastaAlvo.pasta_pai_id) : null;
  const nomePasta = pastaAlvo ? (paiAlvo ? `${paiAlvo.nome} › ${pastaAlvo.nome}` : pastaAlvo.nome) : 'sem pasta';
  showAlert(`Movido para: ${nomePasta}`, 'ok');
  renderizarLista();
}


document.getElementById('inputFotoCamera').addEventListener('change', processarFotoInput);
document.getElementById('inputFotoGaleria').addEventListener('change', processarFotoInput);
document.addEventListener('keydown', e => { if(e.key==='Escape') fecharViewerBtn(); });

// ═══════════════════════════════════════════════
//  INIT — VERIFICA SESSÃO
// ═══════════════════════════════════════════════
(async function() {
  const { data: { session } } = await supa.auth.getSession();
  if (session && session.user) {
    aoLogar(session.user);
  }
})();

// Limpar presença ao fechar/recarregar a aba
window.addEventListener('beforeunload', () => {
  if (currentId && currentUser) {
    try { removerPresenca(currentId); } catch(e) {}
  }
});
