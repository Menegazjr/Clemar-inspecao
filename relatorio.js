let _abrindoRelatorio = false;
let _pendingGrupoId   = null;
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
  supa.from('relatorios').select('fotos').eq('id', id).single().then(({ data: fd, error: ferr }) => {
    console.log('foto fetch result:', fd ? 'ok' : 'null', ferr?.message || '');
    if (!fd || currentId !== id) { mostrarLoadingFotos(false); return; }
    try {
      let fotos = fd.fotos;
      console.log('fotos raw:', typeof fotos, Array.isArray(fotos), fotos ? JSON.stringify(fotos).slice(0,200) : 'null');
      if (!fotos) fotos = [];
      else if (typeof fotos === 'string') fotos = JSON.parse(fotos);
      else if (typeof fotos === 'object' && !Array.isArray(fotos)) fotos = Object.values(fotos);
      fotos = (fotos || []).filter(f => f && typeof f === 'object');
      console.log('fotos após normalizar:', fotos.length, fotos[0] ? Object.keys(fotos[0]) : 'vazio');
      // Migrar formato antigo para grupos
      if (fotos.length > 0 && !fotos[0].fotos) {
        console.log('migrando formato antigo...');
        fotos = fotos.map(f => ({
          id: f.id || uid(),
          titulo: f.local || '',
          descricao: f.descricao || '',
          fotos: [{ id: uid(), base64: f.base64||'', largura: f.largura||0, altura: f.altura||0, timestamp: f.timestamp||'' }]
        }));
      }
      console.log('fotos final:', fotos.length, 'grupos');
      currentRelatorio.fotos = fotos;
      const idxF = relatorios.findIndex(r => r.id === id);
      if (idxF >= 0) relatorios[idxF].fotos = fotos;
      renderizarFotos();
      console.log('renderizarFotos chamado');
    } catch(e) { console.error('erro fotos:', e); }
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
  // Coleta campos de cada grupo antes de salvar
  (r.fotos || []).forEach(g => salvarCamposFoto(g.id));
  if (!r.fotos) r.fotos = [];

  // Salva no Supabase (excluindo user_id, id e campos locais)
  const { user_id, id, _tamanho, fotos: _fotos, criado_por: _criado_por, ...camposSemFotos } = r;
  const campos = { ...camposSemFotos, fotos: r.fotos };
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
  if (!html) return [new docx.TextRun({ text: '—', size: 20, font: 'Arial' })];
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
  return runs.map(r => new docx.TextRun({
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
