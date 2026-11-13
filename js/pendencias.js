const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS = { pendente:['Pendente','s-pendente'], aguardando_validacao:['Aguardando validação','s-validacao'], concluida:['Concluída','s-concluida'] };
let currentUser = null, supervisor = false, obras = [], pendencias = [], selected = null, creatingPending = false, sendingCorrection = false;
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
  $('mainNav').style.display='flex';
  $('loginScreen').classList.add('hidden');
  finishInitialSessionCheck();
  await loadData();
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
  const rows=pendencias.filter(p=>{
    const obra=p.obras_mapa?.nome||'';const matchText=`${p.descricao} ${obra} ${p.criado_por_nome}`.toLocaleLowerCase('pt-BR').includes(q);
    const matchStatus=status==='todos'||p.status===status;
    return matchText&&matchStatus&&(work==='todas'||p.obra_mapa_id===work);
  });
  $('listCount').textContent=`${rows.length} de ${pendencias.length} pendência(s)`;
  $('pendingList').innerHTML=rows.length?rows.map(p=>{
    const obra=p.obras_mapa?.nome||'Obra';
    const reportUrl=p.relatorio_id?`index.html?relatorio_id=${encodeURIComponent(p.relatorio_id)}`:'';
    return `<article class="pending-row" onclick="openPending('${p.id}')"><div class="pending-main"><div class="pending-top"><b>${esc(obra)}</b>${statusBadge(p.status)}</div><div class="pending-desc">${esc(p.descricao)}</div><div class="pending-meta"><span>Aberta por ${esc(p.criado_por_nome)}</span>${p.relatorio_id?`<span>Relatório #${esc(p.relatorios?.numero??'—')}</span>`:''}</div></div><div class="row-actions">${p.relatorio_id?`<a class="row-action report-link" href="${reportUrl}" onclick="event.stopPropagation()">Abrir relatório</a>`:''}<button type="button" class="ghost row-action" onclick="event.stopPropagation();openDetail('${p.id}')">Detalhes</button>${isAdmin()?`<button type="button" class="danger row-action" onclick="event.stopPropagation();deletePending('${p.id}')">Excluir</button>`:''}</div></article>`;
  }).join(''):'<div class="empty">Nenhuma pendência encontrada com esses filtros.</div>';
}
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
  if(!confirm(`Excluir a pendência "${pendencia.descricao}"? Esta ação não pode ser desfeita.`))return;
  const {error,erroFotos}=await excluirPendenciaComFotos(id);
  if(error){toast('Não foi possível excluir: '+error.message);return;}
  if(selected?.id===id){closeModal('detailModal');selected=null;}
  toast(erroFotos?`Pendência excluída, mas não foi possível remover todas as fotos: ${erroFotos.message}`:'Pendência excluída.');
  await loadData();
}
async function openDetail(id){
  selected=pendencias.find(p=>p.id===id);if(!selected)return;
  const p=selected,obra=p.obras_mapa?.nome||'Obra';
  $('detailMeta').textContent=`${obra} · ${STATUS[p.status]?.[0]||p.status}`;
  $('detailTitle').textContent=p.descricao;
  $('detailBody').innerHTML='<div class="empty">Carregando histórico...</div>';
  $('detailModal').classList.add('open');
  const {data:history,error}=await supa.from('pendencias_historico').select('*').eq('pendencia_id',id).order('criado_em',{ascending:true});
  if(error){$('detailBody').innerHTML=`<div class="empty">Erro ao carregar histórico: ${esc(error.message)}</div>`;return;}
  const historyHtml=await Promise.all((history||[]).map(async h=>{
    const titles={criada:'Pendência cadastrada',correcao_enviada:'Correção registrada',devolvida:'Correção devolvida pelo supervisor',aprovada:'Correção aprovada'};
    const pics=await signedPhotos(h.fotos||[]);
    return `<div class="history-item"><b>${titles[h.evento]||h.evento}</b><small>${esc(h.usuario_nome)} · ${fmtDateTime(h.criado_em)}</small>${h.descricao?`<p>${esc(h.descricao)}</p>`:''}${h.motivo?`<p><b>Motivo:</b> ${esc(h.motivo)}</p>`:''}${pics?`<div class="photo-grid">${pics}</div>`:''}</div>`;
  }));
  const photos=await signedPhotos(p.fotos_correcao||[]);
  const originalPhotos=await signedPhotos(p.fotos||[]);
  const report=p.relatorios?.numero?`<a href="index.html?relatorio_id=${encodeURIComponent(p.relatorio_id)}">Abrir relatório #${p.relatorios.numero}</a>`:'Cadastro direto na obra';
  const adminAction=isAdmin()?`<div class="review-actions"><button class="danger" onclick="deletePending('${p.id}')">Excluir pendência</button></div>`:'';
  const review=p.status==='aguardando_validacao'&&supervisor?`<div class="review-actions"><button class="danger" onclick="returnCorrection('${p.id}')">Devolver para correção</button><button class="primary" onclick="approveCorrection('${p.id}')">Aprovar correção</button></div>`:'';
  const correctionForm=p.status==='pendente'?`<div class="correction-box"><h3>Registrar correção</h3><label>Descreva o que foi corrigido <em>*</em><textarea id="correctionText" placeholder="Informe o serviço realizado e o resultado..."></textarea></label><div class="photo-field"><div class="photo-label">Fotos da correção (opcional)</div>${photoPicker('correction')}</div><div class="correction-actions"><button class="primary" onclick="submitCorrection('${p.id}')">Enviar para validação</button></div></div>`:'';
  $('detailBody').innerHTML=`<div class="detail-grid"><div><small>SITUAÇÃO</small><b>${STATUS[p.status]?.[0]||p.status}</b></div><div><small>CADASTRADA POR</small><b>${esc(p.criado_por_nome)}</b></div><div><small>DATA DE ABERTURA</small><b>${fmtDateTime(p.criado_em)}</b></div><div><small>ORIGEM</small><b>${report}</b></div></div><div class="detail-description">${esc(p.descricao)}${originalPhotos?`<div class="photo-grid">${originalPhotos}</div>`:''}</div>${p.correcao_texto?`<div class="detail-description"><b>Última correção enviada por ${esc(p.corrigido_por_nome||'—')}:</b><br>${esc(p.correcao_texto)}${photos?`<div class="photo-grid">${photos}</div>`:''}</div>`:''}${p.motivo_devolucao?`<div class="detail-description"><b>Última devolução:</b><br>${esc(p.motivo_devolucao)}</div>`:''}<div class="section-title">Histórico de movimentações</div><div class="history">${historyHtml.join('')||'<p>Sem histórico.</p>'}</div>${correctionForm}${review}${adminAction}${p.status==='concluida'?`<div class="detail-description" style="margin-top:16px;color:#16865b"><b>Concluída por ${esc(p.aprovado_por_nome||'Supervisor')}</b><br>${fmtDateTime(p.aprovado_em)}</div>`:''}`;
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
