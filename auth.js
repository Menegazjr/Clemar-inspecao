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
