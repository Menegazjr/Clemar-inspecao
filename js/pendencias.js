const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS = { pendente:['Pendente','s-pendente'], aguardando_validacao:['Aguardando validação','s-validacao'], concluida:['Concluída','s-concluida'] };
const ACTIVITY_STATUS = {
  nao_iniciada: 'Não iniciada',
  em_andamento: 'Em andamento',
  aguardando_terceiros: 'Aguardando terceiros',
  concluida: 'Concluída',
  cancelada: 'Cancelada'
};
let currentUser = null, supervisor = false, obras = [], pendencias = [], atividades = [], responsaveis = [], selected = null, creatingPending = false, sendingCorrection = false, listView = 'all', activityFeatureError = '';
const obraParam = new URLSearchParams(location.search).get('obra_mapa_id');

function toast(message){ const el=$('toast'); el.textContent=message; el.style.display='block'; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.style.display='none',3200); }
function closeModal(id){$(id).classList.remove('open');}
function fmtDateTime(value){return value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';}
function statusBadge(status){const s=STATUS[status]||['Indefinido',''];return `<span class="pill ${s[1]}">${s[0]}</span>`;}
function isAdmin(){return currentUser?.role==='admin';}
function photoPicker(prefix){
  return `<div class="photo-picker"><div class="photo-actions"><button type="button" class="primary photo-button" onclick="$('${prefix}PhotoCamera').click()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>Nova foto (câmera)</button><button type="button" class="ghost photo-button" onclick="$('${prefix}Photos').click()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>Nova foto (galeria)</button></div><small id="${prefix}PhotoStatus">Nenhuma foto selecionada</small><input id="${prefix}PhotoCamera" class="photo-input" type="file" accept="image/*" capture="environment" onchange="updatePhotoSelection('${prefix}')"><input id="${prefix}Photos" class="photo-input" type="file" accept="image/*" multiple onchange="updatePhotoSelection('${prefix}')"></div>`;
}
function selectedPhotoFiles(prefix){
  return [...($(`${prefix}PhotoCamera`)?.files||[]),...($(`${prefix}Photos`)?.files||[])];
}
function updatePhotoSelection(prefix){
  const count=selectedPhotoFiles(prefix).length;
  $(`${prefix}PhotoStatus`).textContent=count?`${count} foto(s) selecionada(s)`:'Nenhuma foto selecionada';
}
function resetPhotoPicker(prefix){
  $(`${prefix}PhotoCamera`).value='';
  $(`${prefix}Photos`).value='';
  updatePhotoSelection(prefix);
}

async function init(){
  $('createPhotoPicker').innerHTML=photoPicker('create');
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('detailModal').classList.contains('open'))closeModal('detailModal');});
  const {data,error}=await supa.auth.getSession();
  if(error){
    $('loginError').textContent='Não foi possível verificar sua sessão: '+error.message;
    $('loginError').style.display='block';
    finishInitialSessionCheck();
  }else if(data.session?.user) await validateUser(data.session.user);
  else finishInitialSessionCheck();
  supa.auth.onAuthStateChange((event,session)=>{
    if(event==='INITIAL_SESSION')return;
    if(!session){currentUser=null;$('mainNav').style.display='none';$('loginScreen').classList.remove('hidden');}
    else setTimeout(()=>validateUser(session.user),0);
  });
}
function finishInitialSessionCheck(){document.body.classList.remove('session-pending');}
async function validateUser(user){
  const {data:profile,error}=await supa.from('usuarios').select('id,nome,email,role,aprovado').eq('id',user.id).single();
  if(error||!profile||(!profile.aprovado&&!['admin','supervisor'].includes(profile.role))){
    $('loginError').textContent=error?.message||'Seu acesso ainda não foi aprovado.';
    $('loginError').style.display='block';
    $('mainNav').style.display='none';
    $('loginScreen').classList.remove('hidden');
    finishInitialSessionCheck();
    return;
  }
  currentUser={id:user.id,email:user.email,nome:profile.nome||user.user_metadata?.nome||user.email.split('@')[0],role:profile.role};
  supervisor=['admin','supervisor'].includes(profile.role);
  $('userName').textContent=currentUser.nome;
  $('btnGestaoUsuariosPendencias').style.display=isAdmin()?'inline-flex':'none';
  $('mainNav').style.display='flex';
  $('loginScreen').classList.add('hidden');
  finishInitialSessionCheck();
  await loadData();
}
function abrirGestaoUsuarios(){
  if(!isAdmin()){toast('Somente administradores podem gerenciar usuários.');return;}
  location.href='index.html?gestao=usuarios';
}
async function login(){
  $('loginError').style.display='none';
  const email=$('loginEmail').value.trim(),password=$('loginPassword').value;
  if(!email||!password){$('loginError').textContent='Informe e-mail e senha.';$('loginError').style.display='block';return;}
  const {data,error}=await supa.auth.signInWithPassword({email,password});
  if(error){$('loginError').textContent=error.message;$('loginError').style.display='block';return;}
  await validateUser(data.user);
}
async function logout(){await supa.auth.signOut();location.href='mapa.html';}

async function loadData(){
  $('pendingList').innerHTML='<div class="empty">Carregando pendências...</div>';
  const [{data:workData,error:workError},{data:pendingData,error:pendingError}]=await Promise.all([
    supa.from('obras_mapa').select('id,nome,cliente,cidade,uf,supervisorio_url').order('nome'),
    supa.from('pendencias').select('*,obras_mapa(id,nome,cliente,cidade,uf),relatorios(id,numero,data)').order('criado_em',{ascending:false})
  ]);
  if(workError||pendingError){$('pendingList').innerHTML=`<div class="empty access-denied">Erro ao carregar: ${esc(workError?.message||pendingError?.message)}<br><small>Confira se a migração sql/supabase_pendencias.sql foi executada no Supabase.</small></div>`;return;}
  obras=workData||[];pendencias=pendingData||[];
  const [activitiesResult, usersResult]=await Promise.all([
    supa.from('pendencias_atividades').select('*').order('criado_em',{ascending:true}),
    supa.rpc('pendencias_listar_responsaveis')
  ]);
  if(activitiesResult.error||usersResult.error){
    activityFeatureError=activitiesResult.error?.message||usersResult.error?.message||'Falha ao carregar atividades e responsáveis.';
    atividades=[];responsaveis=[];
  }else{
    activityFeatureError='';
    atividades=activitiesResult.data||[];
    responsaveis=usersResult.data||[];
  }
  fillWorkFilters();renderDashboard();renderList();
}
function fillWorkFilters(){
  const options=obras.map(o=>`<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('');
  $('filterObra').innerHTML='<option value="todas">Todas as obras</option>'+options;
  $('createObra').innerHTML='<option value="">Selecione uma obra...</option>'+options;
  if(obraParam){$('filterObra').value=obraParam;$('createObra').value=obraParam;}
}
function renderDashboard(){
  const total=pendencias.length, open=pendencias.filter(p=>p.status==='pendente').length, validation=pendencias.filter(p=>p.status==='aguardando_validacao').length, done=pendencias.filter(p=>p.status==='concluida').length;
  const cards=[['Total',total,'Todos os registros'],['Pendentes',open,'Aguardando correção'],['Aguardando validação',validation,'Correções enviadas'],['Concluídas',done,'Aprovadas pelo supervisor']];
  $('kpis').innerHTML=cards.map((c,i)=>`<div class="kpi"><small>${c[0]}</small><strong>${c[1]}</strong><div class="hint">${c[2]}</div></div>`).join('');
  const items=[['Pendente',open,'#c43d45'],['Aguardando validação',validation,'#d69a32'],['Concluída',done,'#16865b']];
  $('statusChart').innerHTML=items.map(i=>`<div class="chart-item"><strong>${i[1]}</strong><span>${i[0]}</span><div class="chart-bar"><i style="width:${total?i[1]/total*100:0}%;background:${i[2]}"></i></div></div>`).join('');
  const byWork={};pendencias.filter(p=>p.status!=='concluida').forEach(p=>{const name=p.obras_mapa?.nome||'Obra não identificada';byWork[name]=(byWork[name]||0)+1;});
  const rank=Object.entries(byWork).sort((a,b)=>b[1]-a[1]).slice(0,5),max=rank[0]?.[1]||1;
  $('obraRanking').innerHTML=rank.length?rank.map(([name,count])=>`<div class="rank-row"><b>${esc(name)}</b><span>${count} aberta(s)</span><div class="rank-bar"><i style="width:${count/max*100}%"></i></div></div>`).join(''):'<div class="empty">Nenhuma pendência aberta.</div>';
}
function renderList(){
  const q=($('search').value||'').trim().toLocaleLowerCase('pt-BR'),status=$('filterStatus').value,work=$('filterObra').value;
  const minhas=atividades.filter(item=>item.responsavel_id===currentUser?.id);
  $('mineCount').textContent=String(minhas.length);
  $('viewAllPendencies').classList.toggle('active',listView==='all');
  $('viewAllPendencies').setAttribute('aria-selected',String(listView==='all'));
  $('viewMyActivities').classList.toggle('active',listView==='mine');
  $('viewMyActivities').setAttribute('aria-selected',String(listView==='mine'));
  $('filterStatus').style.display=listView==='mine'?'none':'';
  if(listView==='mine'){
    const rows=minhas.filter(item=>{
      const pendencia=pendencias.find(p=>p.id===item.pendencia_id);
      const obra=pendencia?.obras_mapa?.nome||'';
      const texto=`${item.titulo} ${item.descricao} ${pendencia?.titulo||''} ${pendencia?.descricao||''} ${obra}`.toLocaleLowerCase('pt-BR');
      return texto.includes(q)&&(work==='todas'||pendencia?.obra_mapa_id===work);
    });
    $('listCount').textContent=`${rows.length} de ${minhas.length} atividade(s) atribuída(s) a você`;
    $('pendingList').innerHTML=activityFeatureError
      ? `<div class="empty access-denied">Não foi possível carregar as atividades: ${esc(activityFeatureError)}<br><small>Confira se a migração sql/supabase_pendencias_ajustes_v5.sql foi executada no Supabase.</small></div>`
      : rows.length?rows.map(item=>{
        const pendencia=pendencias.find(p=>p.id===item.pendencia_id);
        const obra=pendencia?.obras_mapa?.nome||'Obra';
        return `<article class="pending-row mine-activity-row" onclick="openPending('${esc(item.pendencia_id)}')"><div class="pending-main"><div class="pending-top"><b>${esc(obra)}</b><span class="pill activity-${esc(item.status)}">${esc(ACTIVITY_STATUS[item.status]||item.status)}</span></div><div class="pending-title">${esc(item.titulo)}</div><div class="pending-desc">${esc(item.descricao)}</div><div class="pending-meta"><span>Pendência: ${esc(pendencia?.titulo||pendencia?.descricao||'—')}</span></div></div><span class="row-arrow" aria-hidden="true">›</span></article>`;
      }).join('')
      :'<div class="empty">Você ainda não tem atividades atribuídas.</div>';
    return;
  }
  const rows=pendencias.filter(p=>{
    const obra=p.obras_mapa?.nome||'';const matchText=`${p.titulo||''} ${p.descricao} ${obra} ${p.criado_por_nome}`.toLocaleLowerCase('pt-BR').includes(q);
    const matchStatus=status==='todos'||p.status===status;
    return matchText&&matchStatus&&(work==='todas'||p.obra_mapa_id===work);
  });
  $('listCount').textContent=`${rows.length} de ${pendencias.length} pendência(s)`;
  $('pendingList').innerHTML=rows.length?rows.map(p=>{
    const obra=p.obras_mapa?.nome||'Obra';
    const reportUrl=p.relatorio_id?`index.html?relatorio_id=${encodeURIComponent(p.relatorio_id)}`:'';
    return `<article class="pending-row" onclick="openPending('${p.id}')"><div class="pending-main"><div class="pending-top"><b>${esc(obra)}</b>${statusBadge(p.status)}</div>${p.titulo?`<div class="pending-title">${esc(p.titulo)}</div>`:''}<div class="pending-desc">${esc(p.descricao)}</div><div class="pending-meta"><span>Aberta por ${esc(p.criado_por_nome)}</span>${p.responsavel_nome?`<span>Responsável principal: ${esc(p.responsavel_nome)}</span>`:''}${p.relatorio_id?`<span>Relatório #${esc(p.relatorios?.numero??'—')}</span>`:''}</div></div><div class="row-actions">${p.relatorio_id?`<a class="row-action report-link" href="${reportUrl}" onclick="event.stopPropagation()">Abrir relatório</a>`:''}<button type="button" class="ghost row-action" onclick="event.stopPropagation();openDetail('${p.id}')">Detalhes</button>${isAdmin()?`<button type="button" class="danger row-action" onclick="event.stopPropagation();deletePending('${p.id}')">Excluir</button>`:''}</div></article>`;
  }).join(''):'<div class="empty">Nenhuma pendência encontrada com esses filtros.</div>';
}
function setListView(view){listView=view==='mine'?'mine':'all';renderList();}
function openPending(id){
  openDetail(id);
}
function openCreate(){
  if(!obras.length){toast('Cadastre uma obra no mapa antes de criar pendências.');return;}
  $('createDescription').value='';resetPhotoPicker('create');
  if(obraParam)$('createObra').value=obraParam;
  $('createModal').classList.add('open');
}
async function createPending(){
  if(creatingPending)return;
  const obraId=$('createObra').value,description=$('createDescription').value.trim();
  if(!obraId||!description){toast('Selecione a obra e informe a descrição.');return;}
  const id=crypto.randomUUID(), files=selectedPhotoFiles('create');
  creatingPending=true;
  let fotos=[];
  try{
    fotos=await uploadCorrectionPhotos(id,files);
    const {error}=await supa.from('pendencias').insert({id,obra_mapa_id:obraId,descricao,fotos});
    if(error)throw error;
    $('createDescription').value='';resetPhotoPicker('create');
    closeModal('createModal');toast('Pendência cadastrada.');await loadData();
  }catch(error){if(fotos.length)await supa.storage.from('pendencia-fotos').remove(fotos);toast('Não foi possível cadastrar: '+error.message);}
  finally{creatingPending=false;}
}
async function deletePending(id){
  if(!isAdmin()){toast('Somente administradores podem excluir pendências.');return;}
  const pendencia=pendencias.find(item=>item.id===id);
  if(!pendencia)return;
  if(!confirm(`Excluir a pendência "${pendencia.titulo||pendencia.descricao}"? Esta ação não pode ser desfeita.`))return;
  const {error,erroFotos}=await excluirPendenciaComFotos(id);
  if(error){toast('Não foi possível excluir: '+error.message);return;}
  if(selected?.id===id){closeModal('detailModal');selected=null;}
  toast(erroFotos?`Pendência excluída, mas não foi possível remover todas as fotos: ${erroFotos.message}`:'Pendência excluída.');
  await loadData();
}
function responsibleOptions(selectedId='', includeEmpty=true){
  const empty=includeEmpty?`<option value="">Sem responsável</option>`:'<option value="">Selecione um responsável...</option>';
  return empty+responsaveis.map(user=>`<option value="${esc(user.id)}"${user.id===selectedId?' selected':''}>${esc(user.nome)}${user.email?` · ${esc(user.email)}`:''}</option>`).join('');
}
function activityEventText(event){
  return ({
    criada:'Atividade criada',
    titulo_alterado:'Título alterado',
    descricao_alterada:'Descrição alterada',
    responsavel_alterado:'Responsável alterado',
    status_alterado:'Status alterado',
    prazo_alterado:'Prazo alterado',
    comentario:'Comentário'
  })[event]||event;
}
function activityEventDetails(item){
  if(item.evento==='comentario')return esc(item.comentario||'');
  const details=item.detalhes||{};
  if(item.evento==='criada'){
    return `Descrição: ${esc(details.descricao||'—')} · Responsável: ${esc(details.responsavel||'Sem responsável')}${details.prazo?` · Prazo: ${esc(details.prazo)}`:''}`;
  }
  const value=raw=>raw===null||raw===undefined||raw===''?'—':String(raw);
  const before=item.evento==='status_alterado'?(ACTIVITY_STATUS[details.antes]||value(details.antes)):value(details.antes);
  const after=item.evento==='status_alterado'?(ACTIVITY_STATUS[details.depois]||value(details.depois)):value(details.depois);
  const completed=details.concluido_em?` · Concluída em ${fmtDateTime(details.concluido_em)}`:'';
  return `${esc(before)} → ${esc(after)}${completed}`;
}
function renderActivityCard(activity, history){
  const id=esc(activity.id),mine=activity.responsavel_id===currentUser?.id;
  const activityHistory=history.filter(item=>item.atividade_id===activity.id);
  const historyRows=activityHistory.map(item=>`<div class="activity-history-row"><b>${esc(activityEventText(item.evento))}</b><small>${esc(item.usuario_nome)} · ${fmtDateTime(item.criado_em)}</small>${activityEventDetails(item)?`<p>${activityEventDetails(item)}</p>`:''}</div>`).join('');
  const commentsMarkup=renderActivityComments(activity,history);
  const statusOptions=Object.entries(ACTIVITY_STATUS).map(([value,label])=>`<option value="${value}"${activity.status===value?' selected':''}>${label}</option>`).join('');
  const meta=[`Responsável: ${activity.responsavel_nome||'Não atribuído'}`,activity.prazo?`Prazo: ${activity.prazo}`:'Sem prazo'].join(' · ');
  return `<article class="activity-card${mine?' mine':''}">
    <div class="activity-card-heading"><div><h4>${esc(activity.titulo)}</h4><small>${esc(meta)}</small></div><span class="pill activity-${esc(activity.status)}">${esc(ACTIVITY_STATUS[activity.status]||activity.status)}</span></div>
    ${activity.descricao?`<p class="activity-card-description">${esc(activity.descricao)}</p>`:''}
    <div class="activity-card-footer"><small>Criada por ${esc(activity.criado_por_nome)} · ${fmtDateTime(activity.criado_em)}</small>${mine?'<span class="activity-mine-badge">Atribuída a você</span>':''}</div>
    ${activity.concluido_em?`<p class="activity-completion">Concluída em ${fmtDateTime(activity.concluido_em)}</p>`:''}
    <details class="activity-disclosure activity-edit-disclosure" data-disclosure-id="activity-edit-${id}">
      <summary>Editar atividade</summary>
      <div class="activity-form-grid">
        <label><span>Título</span><input id="activityTitle-${id}" type="text" maxlength="160" value="${esc(activity.titulo)}"></label>
        <label><span>Responsável</span><select id="activityAssignee-${id}">${responsibleOptions(activity.responsavel_id)}</select></label>
        <label class="activity-description-field"><span>Descrição</span><textarea id="activityDescription-${id}" rows="3" maxlength="5000">${esc(activity.descricao)}</textarea></label>
        <label><span>Status</span><select id="activityStatus-${id}">${statusOptions}</select></label>
        <label><span>Prazo (opcional)</span><input id="activityDue-${id}" type="date" value="${esc(activity.prazo||'')}"></label>
      </div>
      <div class="activity-actions"><button class="primary" type="button" onclick="updateActivity('${id}','${esc(activity.pendencia_id)}')">Salvar alterações</button></div>
    </details>
    ${commentsMarkup}
    <details class="activity-disclosure activity-history" data-disclosure-id="activity-history-${id}"><summary>Histórico da atividade <span>${activityHistory.length}</span></summary><div>${historyRows||'<p>Sem alterações registradas.</p>'}</div></details>
  </article>`;
}
function renderActivityComments(activity, history){
  const id=esc(activity.id);
  const comments=history.filter(item=>item.atividade_id===activity.id&&item.evento==='comentario');
  return `<details class="activity-disclosure activity-comments-disclosure" data-disclosure-id="activity-comments-${id}"><summary>Comentários e atualizações <span>${comments.length}</span></summary><div class="activity-comment-list">${comments.length?comments.map(item=>`<div class="activity-comment"><p>${esc(item.comentario)}</p><small>${esc(item.usuario_nome)} · ${fmtDateTime(item.criado_em)}</small></div>`).join(''):'<p class="activity-empty">Nenhum comentário registrado.</p>'}</div><form onsubmit="event.preventDefault();addActivityComment('${id}','${esc(activity.pendencia_id)}')"><label>Adicionar comentário<textarea id="activityComment-${id}" rows="2" maxlength="5000" required placeholder="Registre uma atualização sobre esta atividade..."></textarea></label><button class="ghost" type="submit">Adicionar comentário</button></form></details>`;
}
async function renderFullHistory(mainHistory, activityHistory, activities){
  const activityById=new Map(activities.map(item=>[item.id,item]));
  const mainLabels={criada:'Pendência cadastrada',responsavel_atribuido:'Responsável principal atribuído',responsavel_alterado:'Responsável principal alterado',responsavel_removido:'Responsável principal removido',titulo_alterado:'Título alterado',descricao_alterada:'Descrição alterada',correcao_enviada:'Correção enviada para validação',devolvida:'Pendência devolvida para correção',aprovada:'Pendência aprovada'};
  const mainRows=await Promise.all(mainHistory.map(async item=>{
    const photos=await signedPhotos(item.fotos||[]);
    return {date:item.criado_em,html:`<div class="history-item"><b>${esc(mainLabels[item.evento]||item.evento)}</b><small>${esc(item.usuario_nome)} · ${fmtDateTime(item.criado_em)}</small>${item.descricao?`<p>${esc(item.descricao)}</p>`:''}${item.motivo?`<p><b>Motivo:</b> ${esc(item.motivo)}</p>`:''}${photos?`<div class="photo-grid">${photos}</div>`:''}</div>`};
  }));
  const activityRows=activityHistory.map(item=>{
    const activity=activityById.get(item.atividade_id);
    const title=item.detalhes?.titulo||activity?.titulo||'Atividade';
    return {date:item.criado_em,html:`<div class="history-item activity-global-history"><b>${esc(title)} · ${esc(activityEventText(item.evento))}</b><small>${esc(item.usuario_nome)} · ${fmtDateTime(item.criado_em)}</small>${activityEventDetails(item)?`<p>${activityEventDetails(item)}</p>`:''}</div>`};
  });
  return [...mainRows,...activityRows].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(item=>item.html).join('');
}
async function openDetail(id){
  const expandedDisclosures=selected?.id===id
    ? [...$('detailBody').querySelectorAll('details[open][data-disclosure-id]')].map(item=>item.dataset.disclosureId)
    : [];
  selected=pendencias.find(p=>p.id===id);if(!selected)return;
  const p=selected,obra=p.obras_mapa?.nome||'Obra';
  $('detailMeta').textContent=`${obra} · ${STATUS[p.status]?.[0]||p.status}`;
  $('detailTitle').textContent=p.titulo||p.descricao;
  $('detailBody').innerHTML='<div class="empty">Carregando histórico...</div>';
  $('detailModal').classList.add('open');
  const {data:history,error}=await supa.from('pendencias_historico').select('*').eq('pendencia_id',id).order('criado_em',{ascending:true});
  if(error){$('detailBody').innerHTML=`<div class="empty">Erro ao carregar histórico: ${esc(error.message)}</div>`;return;}
  const {data:activityRows,error:activitiesError}=await supa.from('pendencias_atividades').select('*').eq('pendencia_id',id).order('criado_em',{ascending:true});
  const activities=activitiesError?[]:(activityRows||[]);
  let activityHistory=[],activityHistoryError=null;
  if(activities.length){
    const result=await supa.from('pendencias_atividades_historico').select('*').in('atividade_id',activities.map(item=>item.id)).order('criado_em',{ascending:true});
    activityHistory=result.data||[];activityHistoryError=result.error;
  }
  const featureError=activitiesError||activityHistoryError;
  const featureErrorMessage=featureError?.message||activityFeatureError;
  const originalPhotos=await signedPhotos(p.fotos||[]);
  const correctionPhotos=await signedPhotos(p.fotos_correcao||[]);
  const report=p.relatorios?.numero?`<a href="index.html?relatorio_id=${encodeURIComponent(p.relatorio_id)}">Abrir relatório #${p.relatorios.numero}</a>`:'Cadastro direto na obra';
  const primaryResponsibleControls=featureErrorMessage
    ? `<small class="activity-feature-error">Disponível após a migração v5: ${esc(featureErrorMessage)}</small>`
    : supervisor
    ? `<div class="responsible-edit"><select id="principalResponsible">${responsibleOptions(p.responsavel_id)}</select><button class="ghost" type="button" onclick="updatePrimaryResponsible('${esc(p.id)}')">Salvar responsável</button></div>`
    : `<p>${esc(p.responsavel_nome||'Ainda não atribuído')}</p>`;
  const primaryAssignedMeta=p.responsavel_atribuido_em?`<small>Atribuído por ${esc(p.responsavel_atribuido_por_nome||'—')} · ${fmtDateTime(p.responsavel_atribuido_em)}</small>`:'';
  const activityErrorMarkup=featureErrorMessage?`<div class="activity-feature-error">Não foi possível carregar o módulo de atividades: ${esc(featureErrorMessage)}. Execute a migração <code>sql/supabase_pendencias_ajustes_v5.sql</code>.</div>`:'';
  const activitiesMarkup=featureErrorMessage?'':`<p class="activity-section-note">As atividades extras ajudam a dividir a execução. Concluir uma atividade não conclui a pendência.</p>${activities.map(item=>renderActivityCard(item,activityHistory)).join('')||'<p class="activity-empty">Ainda não há atividades extras.</p>'}`;
  const createActivityMarkup=featureErrorMessage?'':`<details class="activity-create-disclosure" data-disclosure-id="activity-create"><summary>＋ Adicionar atividade extra</summary><form class="activity-create" onsubmit="event.preventDefault();createActivity('${esc(p.id)}')"><div class="activity-form-grid"><label><span>Título <em>*</em></span><input id="newActivityTitle" type="text" maxlength="160" required placeholder="Ex.: Comprar materiais"></label><label><span>Responsável <em>*</em></span><select id="newActivityAssignee" required>${responsibleOptions('',false)}</select></label><label class="activity-description-field"><span>Descrição <em>*</em></span><textarea id="newActivityDescription" rows="3" maxlength="5000" required placeholder="Descreva o que precisa ser feito..."></textarea></label><label><span>Prazo (opcional)</span><input id="newActivityDue" type="date"></label></div><button class="primary" type="submit">Criar atividade</button></form></details>`;
  const activityCount=activities.length;
  const activitySection=featureErrorMessage
    ? `<section class="detail-section"><h3>Atividades extras</h3>${activityErrorMarkup}</section>`
    : `<details class="detail-section detail-accordion activity-accordion" data-disclosure-id="activities"><summary class="detail-accordion-summary"><span><strong>Atividades extras</strong><small>Detalhes e criação são opcionais</small></span><span class="accordion-count">${activityCount}</span></summary><div class="detail-accordion-content">${activitiesMarkup}${createActivityMarkup}</div></details>`;
  const historyMarkup=await renderFullHistory(history||[],activityHistory,activities);
  const review=p.status==='aguardando_validacao'&&supervisor?`<div class="review-actions"><button class="danger" onclick="returnCorrection('${p.id}')">Devolver para correção</button><button class="primary" onclick="approveCorrection('${p.id}')">Aprovar correção</button></div>`:'';
  const correctionForm=p.status==='pendente'?`<div class="correction-box"><p>Descreva o que foi corrigido. O envio encaminha a pendência para validação.</p><label><span>Correção realizada <em>*</em></span><textarea id="correctionText" placeholder="Informe o serviço realizado e o resultado..."></textarea></label><div class="photo-field"><div class="photo-label">Fotos da correção (opcional)</div>${photoPicker('correction')}</div><div class="correction-actions"><button class="primary" onclick="submitCorrection('${p.id}')">Enviar para validação</button></div></div>`:'';
  const workflowContent=p.status==='pendente'
    ? correctionForm
    : p.status==='aguardando_validacao'
    ? review||'<p class="workflow-note">Correção enviada. A pendência aguarda a validação de um administrador ou supervisor.</p>'
    : `<div class="workflow-complete"><b>Pendência aprovada</b><span>Por ${esc(p.aprovado_por_nome||'Supervisor')} · ${fmtDateTime(p.aprovado_em)}</span></div>`;
  const workflowTitle=p.status==='pendente'?'Registrar correção':p.status==='aguardando_validacao'?'Validação final':'Conclusão';
  const adminAction=isAdmin()?`<details class="detail-section danger-zone" data-disclosure-id="danger-zone"><summary class="detail-accordion-summary"><span><strong>Ações administrativas</strong><small>Exclusão permanente da pendência</small></span><span class="danger-zone-chevron" aria-hidden="true">›</span></summary><div class="danger-zone-content"><p>Esta ação não pode ser desfeita e remove a pendência do sistema.</p><button class="danger" onclick="deletePending('${p.id}')">Excluir pendência</button></div></details>`:'';
  $('detailBody').innerHTML=`
    <section class="detail-section">
      <h3>Dados gerais</h3>
      <div class="detail-grid">
        <div><small>SITUAÇÃO GERAL</small><b>${STATUS[p.status]?.[0]||p.status}</b></div>
        <div><small>CADASTRADA POR</small><b>${esc(p.criado_por_nome)}</b></div>
        <div><small>DATA DE ABERTURA</small><b>${fmtDateTime(p.criado_em)}</b></div>
        <div><small>ORIGEM</small><b>${report}</b></div>
      </div>
      <div class="detail-description">${p.titulo?`<strong>${esc(p.titulo)}</strong><br>`:''}${esc(p.descricao)}${originalPhotos?`<div class="photo-grid">${originalPhotos}</div>`:''}</div>
      ${p.correcao_texto?`<div class="detail-description"><b>Última correção enviada por ${esc(p.corrigido_por_nome||'—')}:</b><br>${esc(p.correcao_texto)}${correctionPhotos?`<div class="photo-grid">${correctionPhotos}</div>`:''}</div>`:''}
      ${p.motivo_devolucao?`<div class="detail-description"><b>Última devolução:</b><br>${esc(p.motivo_devolucao)}</div>`:''}
    </section>
    <section class="detail-section"><h3>Responsável principal</h3>${primaryResponsibleControls}${primaryAssignedMeta}</section>
    ${activitySection}
    <section class="detail-section workflow-section"><h3>${workflowTitle}</h3>${workflowContent}</section>
    <section class="detail-section"><h3>Histórico completo</h3><div class="history">${historyMarkup||'<p>Sem movimentações registradas.</p>'}</div></section>
    ${adminAction}`;
  for(const disclosure of $('detailBody').querySelectorAll('details[data-disclosure-id]')){
    if(expandedDisclosures.includes(disclosure.dataset.disclosureId))disclosure.open=true;
  }
}
async function updatePrimaryResponsible(pendenciaId){
  if(!supervisor)return;
  const {error}=await supa.rpc('pendencia_atribuir_responsavel',{p_pendencia_id:pendenciaId,p_responsavel_id:$('principalResponsible').value||null});
  if(error){toast('Não foi possível atribuir o responsável: '+error.message);return;}
  toast('Responsável principal atualizado.');
  await loadData();await openDetail(pendenciaId);
}
async function createActivity(pendenciaId){
  const titulo=$('newActivityTitle')?.value.trim()||'',descricao=$('newActivityDescription')?.value.trim()||'',responsavelId=$('newActivityAssignee')?.value||'';
  if(!titulo||!descricao||!responsavelId){toast('Informe título, descrição e responsável da atividade.');return;}
  const {error}=await supa.rpc('pendencia_atividade_criar',{p_pendencia_id:pendenciaId,p_titulo:titulo,p_descricao:descricao,p_responsavel_id:responsavelId,p_prazo:$('newActivityDue').value||null});
  if(error){toast('Não foi possível criar a atividade: '+error.message);return;}
  toast('Atividade criada.');
  await loadData();await openDetail(pendenciaId);
}
async function updateActivity(activityId,pendenciaId){
  const {error}=await supa.rpc('pendencia_atividade_atualizar',{
    p_atividade_id:activityId,
    p_titulo:$(`activityTitle-${activityId}`).value,
    p_descricao:$(`activityDescription-${activityId}`).value,
    p_responsavel_id:$(`activityAssignee-${activityId}`).value||null,
    p_status:$(`activityStatus-${activityId}`).value,
    p_prazo:$(`activityDue-${activityId}`).value||null
  });
  if(error){toast('Não foi possível atualizar a atividade: '+error.message);return;}
  toast('Atividade atualizada.');
  await loadData();await openDetail(pendenciaId);
}
async function addActivityComment(activityId,pendenciaId){
  const input=$(`activityComment-${activityId}`),comentario=input?.value.trim()||'';
  if(!comentario){toast('Escreva um comentário antes de adicionar.');return;}
  const {error}=await supa.rpc('pendencia_atividade_comentar',{p_atividade_id:activityId,p_comentario:comentario});
  if(error){toast('Não foi possível adicionar o comentário: '+error.message);return;}
  toast('Comentário adicionado.');
  await loadData();await openDetail(pendenciaId);
}
async function signedPhotos(paths){
  if(!Array.isArray(paths)||!paths.length)return '';
  const urls=await Promise.all(paths.map(async path=>{const {data}=await supa.storage.from('pendencia-fotos').createSignedUrl(path,1800);return data?.signedUrl||null;}));
  return urls.filter(Boolean).map(url=>`<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Foto da correção"></a>`).join('');
}
async function compressPhoto(file){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const max=1400,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Falha ao processar imagem')),'image/jpeg',.78);};img.src=reader.result;};reader.readAsDataURL(file);});
}
async function uploadCorrectionPhotos(id,files){
  const paths=[];
  try{
    for(const file of files){if(!file.type.startsWith('image/'))continue;const blob=await compressPhoto(file);const path=`${id}/${crypto.randomUUID()}.jpg`;const {error}=await supa.storage.from('pendencia-fotos').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(error)throw error;paths.push(path);}
    return paths;
  }catch(error){if(paths.length)await supa.storage.from('pendencia-fotos').remove(paths);throw error;}
}
async function submitCorrection(id){
  if(sendingCorrection)return;
  const text=$('correctionText')?.value.trim()||'',files=selectedPhotoFiles('correction');
  if(!text){toast('A descrição da correção é obrigatória.');return;}
  sendingCorrection=true;
  let paths=[];
  try{paths=await uploadCorrectionPhotos(id,files);const {error}=await supa.rpc('pendencia_registrar_correcao',{p_pendencia_id:id,p_texto:text,p_fotos:paths});if(error)throw error;toast('Correção enviada para validação do supervisor.');closeModal('detailModal');await loadData();}catch(error){if(paths.length)await supa.storage.from('pendencia-fotos').remove(paths);toast('Erro ao enviar correção: '+error.message);}finally{sendingCorrection=false;}
}
async function approveCorrection(id){
  if(!confirm('Confirma a aprovação desta correção? A pendência será concluída.'))return;
  const {error}=await supa.rpc('pendencia_validar',{p_pendencia_id:id,p_aprovar:true,p_motivo:null});
  if(error){toast('Não foi possível aprovar: '+error.message);return;}toast('Correção aprovada. Pendência concluída.');closeModal('detailModal');await loadData();
}
async function returnCorrection(id){
  const reason=prompt('Informe o motivo da devolução para correção:');if(!reason?.trim())return;
  const {error}=await supa.rpc('pendencia_validar',{p_pendencia_id:id,p_aprovar:false,p_motivo:reason.trim()});
  if(error){toast('Não foi possível devolver: '+error.message);return;}toast('Pendência devolvida para correção.');closeModal('detailModal');await loadData();
}
window.addEventListener('DOMContentLoaded',init);
