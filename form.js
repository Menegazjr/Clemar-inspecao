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
function prepararNovaFotoBtn(camera, grupoId) {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Abra um relatório primeiro.', 'warn'); return; }
  if (!r.fotos) r.fotos = [];

  if (grupoId) {
    // Adicionar foto a grupo existente
    const grupo = r.fotos.find(g => g.id === grupoId);
    if (!grupo) return;
    if (grupo.fotos.length >= 4) { showAlert('Máximo de 4 fotos por grupo.', 'warn'); return; }
    const novaFoto = { id: uid(), base64: '', largura: 0, altura: 0, timestamp: new Date().toISOString() };
    grupo.fotos.push(novaFoto);
    _pendingFotoId = novaFoto.id;
    _pendingGrupoId = grupoId;
  } else {
    // Criar novo grupo
    const grupo = { id: uid(), titulo: '', descricao: '', fotos: [] };
    const novaFoto = { id: uid(), base64: '', largura: 0, altura: 0, timestamp: new Date().toISOString() };
    grupo.fotos.push(novaFoto);
    r.fotos.push(grupo);
    _pendingFotoId = novaFoto.id;
    _pendingGrupoId = grupo.id;
  }
  renderizarFotos();
  const inp = document.getElementById(camera ? 'inputFotoCamera' : 'inputFotoGaleria');
  if (inp) { inp.value = ''; setTimeout(() => inp.click(), 0); }
}

function processarFotoInput(event) {
  const r = getRelatorioAtual();
  if (!r) { event.target.value=''; return; }
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
      // Encontrar a foto no grupo correto
      const grupo = (r.fotos||[]).find(g => g.id === _pendingGrupoId);
      if (grupo) {
        const foto = grupo.fotos.find(f => f.id === _pendingFotoId);
        if (foto) { foto.base64=base64; foto.largura=w; foto.altura=h; }
      }
      _pendingFotoId = null;
      _pendingGrupoId = null;
      renderizarFotos();
      showAlert('Foto adicionada!','ok');
    };
    img.onerror = () => { showAlert('Erro ao carregar imagem.','err'); _pendingFotoId=null; _pendingGrupoId=null; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value='';
}

function trocarFotoBtn(fotoId, grupoId, camera) {
  _pendingFotoId  = fotoId;
  _pendingGrupoId = grupoId;
  document.getElementById('inputFotoCamera').value  = '';
  document.getElementById('inputFotoGaleria').value = '';
  const inp = document.getElementById(camera ? 'inputFotoCamera' : 'inputFotoGaleria');
  setTimeout(() => inp.click(), 0);
}

function excluirFotoRegistro(fotoId, grupoId) {
  const r = getRelatorioAtual();
  if (!r) return;
  const grupo = (r.fotos||[]).find(g => g.id === grupoId);
  if (!grupo) return;
  grupo.fotos = grupo.fotos.filter(f => f.id !== fotoId);
  if (grupo.fotos.length === 0) {
    r.fotos = r.fotos.filter(g => g.id !== grupoId);
  }
  renderizarFotos();
  showAlert('Foto removida.','warn');
}

function excluirGrupoFotos(grupoId) {
  const r = getRelatorioAtual();
  if (!r) return;
  if (!confirm('Remover este grupo e todas as fotos?')) return;
  r.fotos = (r.fotos||[]).filter(g => g.id !== grupoId);
  renderizarFotos();
  showAlert('Grupo removido.','warn');
}

function salvarCamposFoto(grupoId) {
  const r = getRelatorioAtual(); if (!r) return;
  const grupo = (r.fotos||[]).find(g => g.id === grupoId); if (!grupo) return;
  const te = document.getElementById(`titulo_${grupoId}`);
  const de = document.getElementById(`desc_${grupoId}`);
  if (te) grupo.titulo    = te.value;
  if (de) grupo.descricao = de.value;
}

function renderizarFotos() {
  const r = getRelatorioAtual();
  const grupos = r && r.fotos ? r.fotos : [];
  console.log('renderizarFotos:', grupos.length, 'grupos', grupos[0] ? JSON.stringify(grupos[0]).slice(0,100) : 'vazio');
  const n = grupos.reduce((acc, g) => acc + (g.fotos||[]).length, 0);
  const txt = n === 0 ? '' : `${n} foto${n!==1?'s':''}`;
  if (document.getElementById('badgeFotos')) document.getElementById('badgeFotos').textContent = txt;
  if (document.getElementById('fotoBadgeCard')) document.getElementById('fotoBadgeCard').textContent = txt;

  let list  = document.getElementById('fotoRegistroList');
  const empty = document.getElementById('fotoEmpty');
  // Se elemento não existe ainda, tentar novamente em 300ms
  if (!list) {
    setTimeout(renderizarFotos, 300);
    return;
  }

  if (grupos.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = grupos.map((grupo, gi) => {
    const fotosHtml = (grupo.fotos||[]).map((f, fi) => {
      const ts = f.timestamp ? new Date(f.timestamp).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      const imgArea = f.base64
        ? `<img src="${f.base64}" style="width:100%;height:200px;object-fit:cover;border-radius:6px;cursor:pointer;display:block;transition:opacity 0.2s" onmouseover="this.style.opacity=0.85" onmouseout="this.style.opacity=1" onclick="abrirViewer('${f.id}','${grupo.id}')" loading="lazy">`
        : `<div style="background:var(--surface-2);border-radius:6px;height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--ink-light);font-size:12px">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;margin-bottom:8px;opacity:0.4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
             Sem imagem
           </div>`;
      return `<div style="width:280px;flex-shrink:0">
        ${imgArea}
        ${ts ? `<div style="font-size:10px;color:var(--ink-light);margin-top:3px;text-align:center">🕐 ${ts}</div>` : ''}
        <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline btn-only-mobile" onclick="trocarFotoBtn('${f.id}','${grupo.id}',true)" title="Câmera">📷</button>
          <button class="btn btn-sm btn-steel" onclick="trocarFotoBtn('${f.id}','${grupo.id}',false)" title="Trocar foto" style="flex:1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Trocar
          </button>
          <button class="btn btn-sm btn-danger" onclick="excluirFotoRegistro('${f.id}','${grupo.id}')" title="Remover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            <span class="btn-hide-mobile">Remover</span>
          </button>
        </div>
      </div>`;
    }).join('');

    const podeAddFoto = (grupo.fotos||[]).filter(f => f.base64).length < 4;

    return `<div class="foto-registro" id="reg_${grupo.id}">
      <div class="foto-registro-header">
        <div class="foto-registro-num" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          <span class="dot"></span>GRUPO ${String(gi+1).padStart(2,'0')} · ${(grupo.fotos||[]).length} foto${(grupo.fotos||[]).length!==1?'s':''}
        </div>
        <button class="btn btn-sm btn-danger" onclick="excluirGrupoFotos('${grupo.id}')" title="Remover grupo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span class="btn-hide-mobile">Remover grupo</span>
        </button>
      </div>
      <div class="foto-registro-content" style="padding:14px">
        <div class="field" style="margin-bottom:8px">
          <label style="font-size:11px">Título</label>
          <input type="text" id="titulo_${grupo.id}" value="${(grupo.titulo||'').replace(/"/g,'&quot;')}"
            placeholder="Ex: Sala de máquinas, Quadro elétrico..."
            onchange="salvarCamposFoto('${grupo.id}')" style="font-size:13px">
        </div>
        <div class="field" style="margin-bottom:12px">
          <label style="font-size:11px">Descrição</label>
          <textarea id="desc_${grupo.id}" rows="2" placeholder="Descreva o que está sendo fotografado..."
            onchange="salvarCamposFoto('${grupo.id}')" style="font-size:13px">${grupo.descricao||''}</textarea>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
          ${fotosHtml}
        </div>
        ${podeAddFoto
          ? '<button class="btn btn-steel btn-sm btn-only-mobile" onclick="prepararNovaFotoBtn(true,\'' + grupo.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> + Câmera</button>'
          + '<button class="btn btn-steel btn-sm" onclick="prepararNovaFotoBtn(false,\'' + grupo.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg> + Foto</button>'
          : '<span style="font-size:11px;color:var(--ink-light)">Máximo de 4 fotos por grupo</span>'}
      </div>
    </div>`;
  }).join('');

  // Botão adicionar novo grupo — só no desktop
  const btnFinal = document.createElement('div');
  btnFinal.style.cssText = 'margin-top:12px;display:flex;justify-content:center';
  btnFinal.innerHTML = `<button type="button" class="btn btn-steel" onclick="prepararNovaFotoBtn(false)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
    Novo grupo de fotos
  </button>`;
  list.appendChild(btnFinal);
}

function abrirViewer(fotoId, grupoId) {
  const r = getRelatorioAtual(); if (!r) return;
  // Correção: as fotos ficam DENTRO de cada grupo (r.fotos = grupos, grupo.fotos = fotos)
  const grupo = (r.fotos||[]).find(g => g.id === grupoId);
  const f = grupo && (grupo.fotos||[]).find(x => x.id === fotoId);
  if (!f || !f.base64) return;

  const img = document.getElementById('viewerImg');
  img.src = f.base64;
  // O destaque (hover) da foto expandida é feito via CSS em .foto-viewer-img:hover

  document.getElementById('viewerInfo').textContent = f.local ? `📍 ${f.local}` : '';
  document.getElementById('fotoViewer').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function fecharViewer(e) { if(e.target===document.getElementById('fotoViewer')) fecharViewerBtn(); }
function fecharViewerBtn() {
  document.getElementById('fotoViewer').classList.remove('open');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════
//  EXPORTAR PDF
