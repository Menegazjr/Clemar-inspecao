// ═══════════════════════════════════════════════
//  GESTÃO — usuários + espaço do Supabase
//  Substitui o painel simples antigo (as funções abaixo têm os mesmos nomes e valem por último).
// ═══════════════════════════════════════════════
const _G_DB_LIMITE = 500 * 1024 * 1024;        // limite do plano gratuito (banco)
const _G_ST_LIMITE = 1024 * 1024 * 1024;       // limite do plano gratuito (arquivos)
let _gUsuarios = [], _gFiltro = 'todos', _gBusca = '';

// O selo do topo foi para esta tela: não precisa mais consultar o banco a cada carregamento da lista
async function atualizarBadgeUso() {}

async function abrirAdmin() {
  document.getElementById('adminPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
  _gFiltro = 'todos'; _gBusca = '';
  const b = document.getElementById('gBusca'); if (b) b.value = '';
  await Promise.all([carregarUsuariosAdmin(), carregarEspaco()]);
}
function fecharAdmin() {
  document.getElementById('adminPanel').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Espaço no Supabase ──
async function carregarEspaco() {
  const box = document.getElementById('gEspaco'); if (!box) return;
  box.innerHTML = '<div class="admin-empty" style="grid-column:1/-1">Calculando…</div>';
  const [db, st] = await Promise.all([supa.rpc('db_size'), supa.rpc('storage_size')]);
  const dbB = (!db.error && db.data != null) ? Number(db.data) : null;
  const stB = (!st.error && st.data != null) ? Number(st.data) : null;
  box.innerHTML = barraEspaco('Banco de dados', 'relatórios, usuários e obras', dbB, _G_DB_LIMITE)
                + barraEspaco('Arquivos (fotos)', 'Storage', stB, _G_ST_LIMITE, 'Rode o SQL da gestão (supabase_gestao.sql) para mostrar este valor.');
}
function barraEspaco(titulo, sub, bytes, limite, aviso) {
  if (bytes == null) return `<div class="g-esp"><div class="g-esp-top"><div><b>${titulo}</b><small>${sub}</small></div><span class="g-nd">indisponível</span></div>${aviso ? `<small>${aviso}</small>` : ''}</div>`;
  const pct = Math.min(100, bytes / limite * 100), cor = pct > 80 ? 'var(--signal)' : pct > 50 ? 'var(--accent)' : 'var(--ok)';
  return `<div class="g-esp"><div class="g-esp-top"><div><b>${titulo}</b><small>${sub}</small></div><span><strong>${fmtBytes(bytes)}</strong> <em>de ${fmtBytes(limite)}</em></span></div>
    <div class="g-barra"><i style="width:${Math.max(pct, 1.5)}%;background:${cor}"></i></div><small>${pct.toFixed(1)}% do limite do plano gratuito</small></div>`;
}

// ── Usuários ──
async function carregarUsuariosAdmin() {
  const lista = document.getElementById('gUsuarios'); if (!lista) return;
  lista.innerHTML = '<div class="admin-empty">Carregando…</div>';
  const { data, error } = await supa.from('usuarios').select('*').order('criado_em', { ascending: false });
  if (error) { lista.innerHTML = `<div class="admin-empty" style="color:var(--signal)">Erro: ${escH(error.message)}<br><small>Verifique as políticas RLS no Supabase.</small></div>`; return; }
  _gUsuarios = data || [];
  renderGestao();
}
const _gStatus = u => u.role === 'admin' ? 'admin' : (u.aprovado ? 'aprovado' : 'pendente');
const _gCoresAvatar = ['#0a8fe0', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#c0392b', '#34495e'];
const _gCorAvatar = s => _gCoresAvatar[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % _gCoresAvatar.length];
function _gRel(iso) {
  if (!iso) return 'nunca acessou';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'acessou hoje' : d === 1 ? 'acessou ontem' : `acessou há ${d} dias`;
}
function gBuscar(v) { _gBusca = v; renderGestao(); }
function gFiltrar(f) { _gFiltro = f; renderGestao(); }

function renderGestao() {
  const us = _gUsuarios, n = f => us.filter(f).length;
  const pend = n(u => _gStatus(u) === 'pendente'), adm = n(u => u.role === 'admin'), apr = n(u => _gStatus(u) === 'aprovado');
  const semana = Date.now() - 7 * 864e5, ativos = n(u => u.ultimo_login && new Date(u.ultimo_login).getTime() > semana);
  const card = (t, v, cls = '') => `<div class="g-card ${cls}"><b>${v}</b><span>${t}</span></div>`;
  document.getElementById('gCards').innerHTML = card('Usuários', us.length) + card('Aguardando aprovação', pend, pend ? 'g-alerta' : '')
    + card('Administradores', adm) + card('Ativos nos últimos 7 dias', ativos);
  const chip = (f, t, q) => `<button class="g-chip${_gFiltro === f ? ' on' : ''}" onclick="gFiltrar('${f}')">${t}<small>${q}</small></button>`;
  document.getElementById('gChips').innerHTML = chip('todos', 'Todos', us.length) + chip('pendente', 'Pendentes', pend) + chip('aprovado', 'Aprovados', apr) + chip('admin', 'Admins', adm);

  const q = normTxt(_gBusca).trim(), ordem = { pendente: 0, admin: 1, aprovado: 2 };
  const lista = us.filter(u => (_gFiltro === 'todos' || _gStatus(u) === _gFiltro) && (!q || normTxt((u.nome || '') + ' ' + (u.email || '')).includes(q)))
    .sort((a, b) => ordem[_gStatus(a)] - ordem[_gStatus(b)] || (b.ultimo_login || '').localeCompare(a.ultimo_login || ''));
  document.getElementById('gUsuarios').innerHTML = lista.length ? lista.map(_gLinha).join('') : '<div class="admin-empty">Nenhum usuário encontrado.</div>';
}

function _gLinha(u) {
  const st = _gStatus(u), eu = currentUser && u.id === currentUser.id, id = escH(u.id);
  const nome = u.nome || (u.email || '').split('@')[0] || 'Sem nome';
  const ini = nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  const badge = st === 'admin' ? '<span class="g-badge adm">Admin</span>' : st === 'aprovado' ? '<span class="g-badge ok">Aprovado</span>' : '<span class="g-badge pend">Pendente</span>';
  let acoes = '';
  if (eu) acoes = '<span class="g-meta">você</span>';
  else {
    if (st === 'pendente') acoes += `<button class="g-btn ok" onclick="aprovarUsuario('${id}')">✓ Aprovar</button>`;
    if (st === 'aprovado') acoes += `<button class="g-btn" onclick="alterarRole('${id}','admin')">Tornar admin</button><button class="g-btn" onclick="revogarUsuario('${id}')">Revogar acesso</button>`;
    if (st === 'admin') acoes += `<button class="g-btn" onclick="alterarRole('${id}','user')">Remover admin</button>`;
    acoes += `<button class="g-btn perigo" onclick="excluirUsuario('${id}')">Excluir</button>`;
  }
  const meta = [escH(u.email), u.criado_em ? 'criado em ' + new Date(u.criado_em).toLocaleDateString('pt-BR') : '', _gRel(u.ultimo_login)].filter(Boolean).join(' · ');
  return `<div class="g-user ${st}">
    <div class="g-avatar" style="background:${_gCorAvatar(u.email)}">${escH(ini)}</div>
    <div class="g-nome">${escH(nome)} ${badge}</div>
    <div class="g-acoes">${acoes}</div>
    <div class="g-meta">${meta}</div>
  </div>`;
}

const _gUser = id => _gUsuarios.find(u => u.id === id) || {};
async function _gAtualiza(id, campos, msg, tipo) {
  const { error } = await supa.from('usuarios').update(campos).eq('id', id);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  showAlert(msg, tipo);
  await carregarUsuariosAdmin();
}
async function aprovarUsuario(id) { await _gAtualiza(id, { aprovado: true }, 'Usuário aprovado!', 'ok'); }
async function revogarUsuario(id) {
  if (!confirm(`Revogar o acesso de ${_gUser(id).email || 'este usuário'}? Ele volta para "pendente" e não consegue mais abrir o sistema.`)) return;
  await _gAtualiza(id, { aprovado: false }, 'Acesso revogado.', 'warn');
}
async function alterarRole(id, novoRole) {
  const u = _gUser(id);
  if (!confirm(novoRole === 'admin' ? `Tornar ${u.email} administrador? Ele poderá aprovar usuários e ver esta tela.` : `Remover os privilégios de administrador de ${u.email}?`)) return;
  await _gAtualiza(id, novoRole === 'admin' ? { role: 'admin', aprovado: true } : { role: 'user' }, novoRole === 'admin' ? 'Usuário promovido a admin!' : 'Privilégios de admin removidos.', 'ok');
}
async function excluirUsuario(id) {
  const u = _gUser(id);
  if (!confirm(`Excluir ${u.email} da lista de usuários?\n\nEle perde o acesso. Se tentar entrar de novo, volta como "pendente" e precisará ser aprovado outra vez.`)) return;
  const { error } = await supa.from('usuarios').delete().eq('id', id);
  if (error) { showAlert('Erro ao excluir: ' + error.message, 'err'); return; }
  showAlert('Usuário excluído.', 'warn');
  await carregarUsuariosAdmin();
}
