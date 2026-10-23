'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Android keeps the same interface and sends local operations to its private store.
const nativePlatform = window.UrnaAndroid && typeof window.UrnaAndroid.request==='function' ? {pending:new Map(),sequence:0} : null;
if(nativePlatform){
  document.documentElement.classList.add('android-app');
  window.__urnaAndroidReply=(id,encoded)=>{
    const pending=nativePlatform.pending.get(String(id));if(!pending)return;
    nativePlatform.pending.delete(String(id));
    try{
      const binary=atob(encoded),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      const text=typeof TextDecoder==='function'?new TextDecoder().decode(bytes):decodeURIComponent(Array.from(bytes,b=>'%'+b.toString(16).padStart(2,'0')).join(''));
      const reply=JSON.parse(text);
      if(!Number.isInteger(reply.status)||reply.status<200||reply.status>=300)throw new Error(reply.data?.error||'Não foi possível concluir a operação no tablet.');
      pending.resolve(reply);
    }catch(err){pending.reject(err);}
  };
}
function nativeCall(method,...args){
  return new Promise((resolve,reject)=>{
    const id=String(++nativePlatform.sequence);nativePlatform.pending.set(id,{resolve,reject});
    try{window.UrnaAndroid[method](id,...args);}
    catch(err){nativePlatform.pending.delete(id);reject(new Error('Não foi possível acessar o aplicativo Android. Reabra a urna.'));}
  });
}
function nativeRequest(path,body,admin=false){
  return nativeCall('request',JSON.stringify({method:body===undefined?'GET':'POST',path,body,csrf:state.csrf,admin:admin?state.admin:''}));
}
const icons = {
  urn:'<path d="M4 10h16v11H4zM8 14h8"/><path d="m8 7 3-5 8 5-3 5"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  check:'<path d="m5 12 4 4L19 6"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  group:'<circle cx="12" cy="8" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M5 5a3 3 0 0 0 0 6m14-6a3 3 0 0 1 0 6M1 20v-3a4 4 0 0 1 3-4m19 7v-3a4 4 0 0 0-3-4"/>',
  user:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  print:'<path d="M7 7V2h10v5M7 17H3V8h18v9h-4M7 14h10v8H7zM17 11h1"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  back:'<path d="M20 12H5m6-6-6 6 6 6"/>',
  shield:'<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5z"/><path d="m8 11 3 3 5-6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', edit:'<path d="m16 3 5 5-12 12H4v-5zM13 6l5 5"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const state = {data:null,admin:null,adminData:null,adminTab:'results',csrf:$('meta[name=urna-token]').content,route:'home',voter:null,digits:'',blank:false,saving:false,batches:[],merged:null,toastTimer:null,finishTimer:null,draft:null,step:0,selected:0,dirty:false,configBusy:false,photoBusy:false};
async function api(path, body, admin = false) {
  if(nativePlatform)return (await nativeRequest(path,body,admin)).data;
  const headers = {};
  if (body !== undefined) { headers['Content-Type']='application/json'; headers['X-Urna-Token']=state.csrf; }
  if (admin && state.admin) headers['X-Admin-Token']=state.admin;
  const response = await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const type=response.headers.get('content-type') || '';
  const data=type.includes('json')?await response.json():await response.text();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}
function toast(message, error=false) {
  clearTimeout(state.toastTimer); const el=$('#toast');el.textContent=message;el.className='visible'+(error?' error':'');
  state.toastTimer=setTimeout(()=>{el.className='';},error?8500:5000);
}
async function refresh() { state.data=await api('state'); if(state.data.csrfToken)state.csrf=state.data.csrfToken; }
function institutionalLogos(){return '<div class="institutional-logos" aria-label="Símbolos institucionais"><img class="logo-gresp" src="/assets/gresp.png" alt="GRESP — Grêmio Estudantil Paulista"><img class="logo-sp" src="/assets/estado-sp.png" alt="Brasão do Estado de São Paulo"></div>';}
function brand() { return `<a class="brand" href="#" data-action="brand-home" aria-label="Voz da Escola, início"><span class="brand-icon">${icon('urn')}</span><span class="brand-text"><strong>Voz da Escola<span class="brand-dot">.</span></strong><small>Participação que transforma</small></span></a>`; }
function imageSource(src) { return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src||''); }
function photo(candidate) {
  if(imageSource(candidate.groupPhoto)) return `<img src="${esc(candidate.groupPhoto)}" alt="Foto de ${esc(candidate.name||'candidatura')}">`;
  return `<div class="photo-placeholder">${icon('group')}<span>${candidate.name?'Conheça esta candidatura':'A próxima ideia começa aqui'}</span><small>Vozes que representam a escola</small></div>`;
}
function schoolMark(d) { return imageSource(d.schoolLogo)?`<img class="school-logo" src="${esc(d.schoolLogo)}" alt="Logo da escola">`:''; }
function total(counts) { return Object.values(counts||{}).reduce((sum,n)=>sum+Number(n||0),0); }
function countPublic() { return Number(state.data.total == null ? (state.data.participantCount||0) : state.data.total); }
function home() {
  if(state.data.status==='setup'){if(!state.draft)state.draft=configuration(state.data);setup();return;}
  state.route='home';state.voter=null;state.digits='';state.blank=false;
  const d=state.data,candidates=d.candidates||[],open=d.status==='open',closed=d.status==='closed';
  $('#app').innerHTML=`<main class="shell">
    <header class="topbar">${brand()}<div class="top-actions"><span class="status"><i></i> Sem internet, com participação</span><button class="icon-btn" data-action="fullscreen" aria-label="Tela cheia">${icon('expand')}</button></div></header>
    <section class="hero"><div class="hero-copy"><div class="school-kicker">${schoolMark(d)}<span>${esc(d.school)}</span></div><span class="eyebrow">${esc(d.electionTitle)}</span><h1>A sua voz faz<br><em>a escola acontecer.</em></h1><p>Conheça as ideias, escolha seus representantes<br class="desktop-break"> e participe do próximo capítulo da sua escola.</p><button class="btn primary large" data-action="${closed?'finish':'identify'}">${icon(closed?'check':'urn')} ${closed?'Ver resultados':'Quero votar'} ${icon('arrow')}</button><span class="hero-caption">${icon('shield')} Voto sigiloso. Participação registrada.</span></div><aside class="hero-visual" aria-label="Etapas da votação"><div class="visual-orbit orbit-one"></div><div class="visual-orbit orbit-two"></div><span class="visual-spark">${icon('spark')}</span><div class="visual-ballot">${icon('urn')}<span>O futuro tem<br><strong>a sua escolha.</strong></span><small>GRÊMIO ESTUDANTIL</small></div><div class="floating-chip chip-top"><span>01</span> Identifique-se</div><div class="floating-chip chip-bottom"><span>02</span> Escolha. Confira. Confirme.</div></aside></section>
    <div class="section-line"><div><span class="eyebrow">Ideias para ir além</span><h2>Quem quer representar você</h2></div><span class="count-pill">${candidates.length} candidaturas</span></div>
    <section class="candidates" aria-label="Candidaturas">${candidates.map((c,i)=>`<article class="candidate-card tone-${i%3}"><button class="group-photo photo-button" type="button" data-action="enlarge-photo" data-value="${esc(c.id)}" aria-label="Ampliar foto de ${esc(c.name)}">${photo(c)}<span class="photo-zoom-label">${icon('expand')} Ampliar</span></button><div class="candidate-meta"><div><small>CHAPA / CANDIDATURA</small><h3>${esc(c.name)}</h3>${c.representativeName?`<p>${esc(c.representativeName)}</p>`:''}</div><span class="number-badge" aria-label="Número ${esc(c.number)}">${esc(c.number)}</span></div><button class="candidate-link" data-action="candidate-details" data-value="${esc(c.id)}">Conhecer propostas e equipe ${icon('arrow')}</button></article>`).join('')}</section>
    <section class="start-panel"><div><span class="eyebrow">Cada participação importa</span><h2>${closed?'A escolha foi feita.':'Sua vez de fazer parte.'}</h2><p>${closed?'A apuração e os arquivos desta eleição estão disponíveis.':'Para começar, você só precisa do seu nome e da sua turma.'}</p></div><button class="btn white" data-action="${open?'identify':'finish'}">${open?'Identificar e votar':'Ver resultados'} ${icon('arrow')}</button></section>
    <footer class="footer"><div>${institutionalLogos()}<p>Voz da Escola · Urna estudantil offline</p></div><div class="footer-actions"><span>${esc(d.urnName)}</span><button class="text-btn" data-action="finish">${closed?'Ver resultados':'Finalizar votação'} ${icon('arrow')}</button></div></footer>
  </main>`;
  window.scrollTo(0,0);
}
function configuration(d) {
  return {school:d.school||'',electionTitle:d.electionTitle||'Eleição do Grêmio Estudantil',urnName:d.urnName||'',schoolLogo:d.schoolLogo||'',candidates:(d.candidates||[]).map((c,i)=>({id:'c'+(i+1),name:c.name||'',number:c.number||'',groupPhoto:c.groupPhoto||'',representativeName:c.representativeName||'',proposals:c.proposals||'',members:c.members||''}))};
}
function dirty() { state.dirty=true; const el=$('#save-status');if(el)el.textContent='Alterações ainda não salvas'; }
function freezeEditor(locked) {
  document.querySelectorAll('.setup-shell input,.setup-shell textarea,.setup-shell button').forEach(el=>{
    if(locked){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}
    else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}
  });
}
function configInput(event) {
  const input=event.target;if(state.route!=='setup'||!input.dataset.scope)return;
  const target=input.dataset.scope==='school'?state.draft:state.draft.candidates[state.selected];
  if(input.name==='number')input.value=input.value.replace(/\D/g,'').slice(0,2);
  target[input.name]=input.value;dirty();
}
function setup() {
  state.route='setup';const d=state.draft,c=d.candidates[state.selected],labels=['Identidade','Candidaturas','Revisão'];
  $('#app').innerHTML=`<main class="shell setup-shell"><header class="topbar">${brand()}<div class="top-actions"><span class="status"><i></i> Aplicativo offline</span><button class="icon-btn" data-action="fullscreen" aria-label="Tela cheia">${icon('expand')}</button></div></header><section class="setup-heading"><div><span class="eyebrow">Uma nova eleição começa aqui</span><h1>Do seu jeito.<br class="mobile-break"><em> Com a voz de todos.</em></h1><p>Personalize a eleição da sua escola em três passos.</p></div><span class="setup-badge">${icon('edit')} Espaço de criação</span></section><div class="setup-layout"><aside class="setup-sidebar"><nav class="setup-steps" aria-label="Etapas da personalização">${labels.map((label,i)=>`<button class="setup-step ${state.step===i?'active':''}" data-action="setup-step" data-value="${i}" ${state.configBusy?'disabled':''}><span>${state.step>i?icon('check'):'0'+(i+1)}</span><div><strong>${label}</strong><small>${['A cara da sua escola','Ideias, pessoas e números','Tudo pronto para começar'][i]}</small></div>${icon('arrow')}</button>`).join('')}</nav><div class="setup-tip">${icon('shield')}<strong>Primeiro personalize.<br>Depois, abra a votação.</strong><p>Ao abrir, o cadastro fica bloqueado para preservar a eleição.</p></div><div class="config-transfer"><button class="text-btn" data-action="export-config">${icon('download')} Exportar configuração</button><label class="text-btn upload-label">${icon('upload')} Importar configuração<input id="import-config" type="file" accept=".json,application/json"></label><p>Leve a mesma configuração para outros aparelhos. Votos e presenças ficam em cada urna.</p></div></aside><section class="setup-panel" aria-label="${labels[state.step]}">${state.step===0?identityEditor(d):state.step===1?candidatesEditor(d,c):reviewEditor(d)}<footer class="editor-footer"><div class="save-state">${icon('info')}<span id="save-status">${state.dirty?'Alterações ainda não salvas':'Rascunho salvo neste aparelho'}</span></div><div class="form-actions">${state.step>0?'<button class="btn secondary" data-action="setup-back">Voltar</button>':''}<button class="btn secondary" data-action="save-config">Salvar rascunho</button>${state.step<2?'<button class="btn primary" data-action="setup-next">Salvar e continuar '+icon('arrow')+'</button>':'<button class="btn primary" data-action="open-election">Abrir votação '+icon('arrow')+'</button>'}</div></footer></section></div><footer class="setup-bottom">${institutionalLogos()}<span>Voz da Escola · Feito para participar</span></footer></main>`;
  if(state.configBusy||state.photoBusy)freezeEditor(true);
}
function identityEditor(d) {
  return `<div class="editor-body"><div class="panel-heading"><span class="eyebrow">Passo 01</span><h2>A identidade da eleição</h2><p>Uma experiência com o nome e a marca da sua escola.</p></div><div class="identity-grid"><div><label class="field">Nome da escola <span class="required">*</span><input data-scope="school" name="school" value="${esc(d.school)}" maxlength="160" placeholder="Digite o nome da instituição" autocomplete="off"></label><label class="field">Título da eleição <span class="required">*</span><input data-scope="school" name="electionTitle" value="${esc(d.electionTitle)}" maxlength="160" placeholder="Ex.: Eleição do Grêmio Estudantil"></label><label class="field">Nome deste aparelho / urna <span class="required">*</span><input data-scope="school" name="urnName" value="${esc(d.urnName)}" maxlength="80" placeholder="Ex.: Urna 01 — Biblioteca"><small>Use um nome diferente em cada aparelho para reconhecer os resultados.</small></label></div><div class="identity-preview"><div class="logo-upload-preview">${imageSource(d.schoolLogo)?`<img src="${esc(d.schoolLogo)}" alt="Logo da escola">`:icon('urn')}</div><strong>Sua escola, sua identidade.</strong><p>Adicione a logo da instituição.<br>Esta etapa é opcional.</p><label class="btn secondary upload-label">${icon('upload')} Escolher logo<input id="school-photo" type="file" accept="image/png,image/jpeg,image/webp"></label>${d.schoolLogo?'<button class="text-btn" data-action="remove-school-logo">Remover logo</button>':''}<small>PNG, JPG ou WebP</small></div></div><div class="notice subtle">${icon('info')} Os dados ficam salvos ${nativePlatform?'na área privada do aplicativo':'na pasta Dados, ao lado do aplicativo'}. Não é preciso criar conta nem conectar à internet.</div></div>`;
}
function candidatesEditor(d,c) {
  return `<div class="editor-body"><div class="panel-heading"><span class="eyebrow">Passo 02</span><h2>Quem vai fazer parte?</h2><p>Cadastre de 2 a 12 chapas ou candidaturas. Cada uma precisa de um número único de dois dígitos.</p></div><div class="candidate-editor-layout"><aside class="candidate-picker">${d.candidates.map((v,i)=>`<button class="candidate-pick ${i===state.selected?'active':''}" data-action="select-candidate" data-value="${i}"><span>${esc(v.number||'—')}</span><div><strong>${esc(v.name||'Nova candidatura')}</strong><small>Candidatura ${i+1}</small></div></button>`).join('')}<button class="btn secondary block" data-action="add-candidate" ${d.candidates.length>=12?'disabled':''}>${icon('plus')} Adicionar</button><small>${d.candidates.length} de 12 candidaturas</small></aside><div class="candidate-fields"><div class="candidate-edit-top"><h3>Candidatura ${state.selected+1}</h3><button class="text-btn danger-text" data-action="remove-candidate" ${d.candidates.length<=2?'disabled':''}>${icon('trash')} Remover</button></div><div class="candidate-basics"><label class="field">Nome da chapa / candidatura <span class="required">*</span><input data-scope="candidate" name="name" maxlength="120" value="${esc(c.name)}" placeholder="Como aparecerá na urna"></label><label class="field number-field">Número <span class="required">*</span><input data-scope="candidate" name="number" maxlength="2" inputmode="numeric" value="${esc(c.number)}" placeholder="00" aria-label="Número de dois dígitos"></label></div><div class="candidate-photo-upload"><div class="edit-photo">${photo(c)}</div><div><strong>Foto da chapa ou candidatura</strong><p>A foto aparece na tela inicial e na confirmação do voto. Prefira uma imagem em que todos apareçam.</p><label class="btn secondary upload-label">${icon('upload')} ${c.groupPhoto?'Trocar foto':'Escolher foto'}<input id="candidate-photo" type="file" accept="image/png,image/jpeg,image/webp"></label>${c.groupPhoto?'<button class="text-btn" data-action="remove-candidate-photo">Remover</button>':''}<small>PNG, JPG ou WebP · imagem ajustada automaticamente</small></div></div><label class="field">Representante <span class="optional">Opcional</span><input data-scope="candidate" name="representativeName" maxlength="120" value="${esc(c.representativeName)}" placeholder="Nome da pessoa representante"></label><label class="field">Propostas <span class="optional">Uma por linha</span><textarea data-scope="candidate" name="proposals" rows="5" maxlength="4000" placeholder="Escreva aqui as ideias e propostas">${esc(c.proposals)}</textarea></label><label class="field">Integrantes <span class="optional">Um por linha</span><textarea data-scope="candidate" name="members" rows="4" maxlength="4000" placeholder="Nome do integrante — série e turma">${esc(c.members)}</textarea></label></div></div></div>`;
}
function validationIssues(d) {
  const issues=[];
  if(d.school.trim().length<2)issues.push('Preencha o nome da escola.');
  if(d.electionTitle.trim().length<2)issues.push('Preencha o título da eleição.');
  if(d.urnName.trim().length<2)issues.push('Preencha o nome desta urna.');
  const used=new Set();
  d.candidates.forEach((c,i)=>{if(c.name.trim().length<2)issues.push(`Dê um nome à candidatura ${i+1}.`);if(!/^\d{2}$/.test(c.number))issues.push(`Informe dois dígitos para a candidatura ${i+1}.`);else if(used.has(c.number))issues.push(`O número ${c.number} está repetido.`);used.add(c.number);});
  return issues;
}
function reviewEditor(d) {
  const issues=validationIssues(d);
  return `<div class="editor-body"><div class="panel-heading"><span class="eyebrow">Passo 03</span><h2>Confira. Prepare. Participe.</h2><p>Revise os dados antes de receber o primeiro voto.</p></div><div class="review-identity">${schoolMark(d)}<div><small>${esc(d.electionTitle)}</small><h3>${esc(d.school||'Nome da escola pendente')}</h3><span>${esc(d.urnName||'Nome da urna pendente')}</span></div><button class="icon-btn" data-action="setup-step" data-value="0" aria-label="Editar identidade">${icon('edit')}</button></div><div class="review-candidates">${d.candidates.map((c,i)=>`<button class="review-card tone-${i%3}" data-action="edit-review" data-value="${i}"><div class="review-photo">${photo(c)}</div><div><span>${esc(c.number||'—')}</span><strong>${esc(c.name||'Nome pendente')}</strong><small>${c.proposals.trim().split(/\r?\n/).filter(Boolean).length} propostas · ${c.members.trim().split(/\r?\n/).filter(Boolean).length} integrantes</small></div>${icon('edit')}</button>`).join('')}</div>${issues.length?`<div class="notice warning"><strong>Ainda falta um detalhe</strong><ul>${issues.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>`:'<div class="notice success">'+icon('check')+' As informações obrigatórias estão preenchidas.</div>'}<label class="check-line review-confirm"><input id="open-confirm" type="checkbox"> <span>Conferi os nomes e números. Entendo que a configuração ficará bloqueada ao abrir a votação.</span></label><p class="small-text">Vai usar outros aparelhos? Exporte a configuração e importe em cada um antes de abrir. ${nativePlatform?'Após encerrar e exportar os resultados, você poderá preparar uma nova eleição pelo painel.':'Para uma nova eleição, use outra pasta limpa do aplicativo.'}</p></div>`;
}
async function ensureAccess(){if(!state.admin){const access=await api('admin/access',{});state.admin=access.adminToken;}}
async function saveConfig(showMessage=true) {
  if(state.configBusy||state.photoBusy)throw new Error('Aguarde a imagem ou o salvamento terminar.');
  state.configBusy=true;freezeEditor(true);
  try {await ensureAccess();state.draft.candidates.forEach((c,i)=>c.id='c'+(i+1));const saved=await api('admin/config',state.draft,true);state.draft=configuration(saved);state.dirty=false;if(showMessage)toast('Rascunho salvo neste aparelho.');}
  finally{state.configBusy=false;freezeEditor(false);}
}
async function configAction(name,button) {
  if(state.configBusy||state.photoBusy)throw new Error('Aguarde a operação terminar.');
  if(name==='setup-step'){state.step=Number(button.dataset.value);setup();return;}
  if(name==='setup-back'){state.step--;setup();return;}
  if(name==='setup-next'){await saveConfig(false);state.step++;setup();window.scrollTo(0,0);return;}
  if(name==='save-config'){await saveConfig();setup();return;}
  if(name==='select-candidate'){state.selected=Number(button.dataset.value);setup();return;}
  if(name==='edit-review'){state.selected=Number(button.dataset.value);state.step=1;setup();return;}
  if(name==='add-candidate'){if(state.draft.candidates.length>=12)return;state.draft.candidates.push({id:'c'+(state.draft.candidates.length+1),name:'',number:'',groupPhoto:'',representativeName:'',proposals:'',members:''});state.selected=state.draft.candidates.length-1;dirty();setup();return;}
  if(name==='remove-candidate'){if(state.draft.candidates.length<=2)return;const c=state.draft.candidates[state.selected];dialog('Remover candidatura?',esc(c.name||'Candidatura sem nome'),'<div class="dialog-body"><p>Esta candidatura será retirada do rascunho.</p><div class="form-actions"><button class="btn secondary" data-action="dismiss">Manter</button><button class="btn danger" data-action="confirm-remove-candidate">Remover candidatura</button></div></div>');return;}
  if(name==='confirm-remove-candidate'){state.draft.candidates.splice(state.selected,1);state.selected=Math.max(0,state.selected-1);state.draft.candidates.forEach((c,i)=>c.id='c'+(i+1));dirty();dismiss();setup();return;}
  if(name==='remove-school-logo'){state.draft.schoolLogo='';dirty();setup();return;}
  if(name==='remove-candidate-photo'){state.draft.candidates[state.selected].groupPhoto='';dirty();setup();return;}
  if(name==='export-config'){await saveConfig(false);const d={...state.draft};delete d.urnName;await download(JSON.stringify({format:'voz-da-escola-config-v1',...d},null,2),'configuracao-voz-da-escola.json','application/json');setup();toast('Configuração exportada. Importe nos outros aparelhos antes de abrir a votação.');return;}
  if(name==='open-election'){
    const issues=validationIssues(state.draft);if(issues.length)throw new Error(issues[0]);if(!$('#open-confirm')?.checked)throw new Error('Marque a confirmação depois de conferir a configuração.');
    button.disabled=true;
    try{await saveConfig(false);state.data=await api('admin/open',{},true);state.draft=null;state.dirty=false;home();toast('Votação aberta. A escola já pode participar.');}finally{button.disabled=false;}
    return;
  }
}
async function uploadPhoto(file,school=false) {
  if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error('Escolha uma imagem PNG, JPG ou WebP.');
  if(file.size>15*1024*1024)throw new Error('Escolha uma foto de até 15 MB.');
  if(state.photoBusy||state.configBusy)throw new Error('Aguarde a operação em andamento.');
  const candidate=state.draft.candidates[state.selected];state.photoBusy=true;freezeEditor(true);toast('Preparando sua imagem…');
  try {
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));reader.readAsDataURL(file);});
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('A imagem não pôde ser aberta.'));img.src=src;});
    const max=school?640:1600,scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');
    if(!school){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}context.drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL(school?'image/png':'image/jpeg',.88);
    if(data.length>4*1024*1024)throw new Error('A imagem ficou grande demais. Escolha uma imagem menor.');
    if(school)state.draft.schoolLogo=data;else candidate.groupPhoto=data;dirty();toast('Imagem pronta. Salve o rascunho para guardar.');
  }finally{state.photoBusy=false;setup();}
}
async function importConfiguration(file) {
  if(!file)return;if(state.photoBusy||state.configBusy)throw new Error('Aguarde a operação terminar.');if(file.size>60*1024*1024)throw new Error('Configuração grande demais.');
  let imported;try{imported=JSON.parse(await file.text());}catch(_){throw new Error('O arquivo não é uma configuração JSON válida.');}
  if(!imported||!['voz-da-escola-config-v1','urna-estudantil-config-v1'].includes(imported.format)||!Array.isArray(imported.candidates)||imported.candidates.length<2||imported.candidates.length>12||!imported.candidates.every(c=>c&&typeof c==='object'&&['name','number','groupPhoto','proposals','members','representativeName'].every(k=>c[k]===undefined||typeof c[k]==='string')))throw new Error('Selecione um arquivo exportado pelo editor desta urna.');
  const previous=state.draft,selected=state.selected;
  try{state.draft=configuration({...imported,urnName:previous.urnName});state.selected=0;await saveConfig(false);state.step=2;setup();toast('Configuração importada. Confira os dados e o nome deste aparelho.');}
  catch(err){state.draft=previous;state.selected=selected;setup();throw err;}
}
function dialog(title,description,body,wide=false) {
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="dialog ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${description?`<p>${description}</p>`:''}</div><button class="icon-btn" data-action="dismiss" aria-label="Fechar">${icon('close')}</button></header>${body}</section></div>`;
  state.dialogFocus=document.activeElement;
  setTimeout(()=>($('.dialog input:not([type=file]):not([readonly])')||$('.dialog button'))?.focus(),70);
}
function candidateDetails(id) {
  const c=state.data.candidates.find(candidate=>candidate.id===id);if(!c)return;
  const proposals=String(c.proposals||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const members=String(c.members||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  dialog(esc(c.name),`Chapa ${esc(c.number)} · Conheça a equipe e as propostas`,
    `<div class="dialog-body candidate-details"><div class="candidate-detail-layout"><figure class="details-group"><button class="detail-photo-button" data-action="enlarge-photo" data-value="${esc(c.id)}" aria-label="Ampliar foto da ${esc(c.name)}">${photo(c)}<span class="photo-zoom-label">${icon('expand')} Ampliar foto</span></button><figcaption>${c.representativeName?'Representante: '+esc(c.representativeName):'Chapa '+esc(c.number)}</figcaption></figure><div class="details-copy"><h3>Principais propostas</h3>${proposals.length?`<ul class="proposal-list">${proposals.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:'<p class="small-text mt">As propostas desta chapa ainda não foram informadas.</p>'}${members.length?`<section class="team-section"><h3>Integrantes da chapa</h3><ul class="member-list">${members.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></section>`:''}</div></div><div class="form-actions"><button class="btn primary" data-action="dismiss">Voltar às chapas ${icon('back')}</button></div></div>`,true);
}
function enlargePhoto(id){
  const c=state.data.candidates.find(candidate=>candidate.id===id);if(!c)return;
  dialog(esc(c.name),`Chapa ${esc(c.number)} · Foto da candidatura`, `<div class="dialog-body photo-viewer">${photo(c)}<div class="form-actions"><button class="btn primary" data-action="candidate-details" data-value="${esc(c.id)}">Voltar à chapa ${icon('back')}</button></div></div>`,true);
}
function dismiss() { $('#modal-root').innerHTML='';state.admin=null;state.adminData=null;state.dialogFocus?.focus(); }
function identify() {
  if(state.data.status!=='open')return;
  dialog('Antes de votar, identifique-se.','Preencha os dados como estão na lista da sua turma.',`<form class="dialog-body" data-form="identify"><label class="field">Nome completo<input name="name" autocomplete="off" maxlength="120" required placeholder="Digite seu nome completo"></label><label class="field">Série e turma<input name="grade" autocomplete="off" maxlength="60" required placeholder="Ex.: 8º ano A"></label><div class="notice">Seu nome registra a sua participação. O sistema guarda apenas a soma dos votos, sem associar sua escolha à sua identificação.</div><button class="btn primary block" type="submit">Ir para a urna ${icon('arrow')}</button></form>`);
}
function ballot() {
  state.route='ballot';
  $('#app').innerHTML=`<main class="ballot-page"><header class="ballot-top">${brand()}<div><h2>Eleitor(a) identificado(a)</h2><p>Agora, faça sua escolha com tranquilidade.</p></div></header><section class="urna-wrap"><div class="urna"><div class="urna-screen" id="ballot-screen" aria-live="polite"></div><div class="keypad"><div class="keypad-label">${icon('urn')} Eleição do grêmio</div><div class="number-keys">${[1,2,3,4,5,6,7,8,9,0].map(n=>`<button class="key ${n===0?'zero':''}" data-action="digit" data-value="${n}" aria-label="Número ${n}">${n}</button>`).join('')}</div><div class="action-keys"><button class="action-key branco" data-action="blank">BRANCO</button><button class="action-key corrige" data-action="correct">CORRIGE</button><button class="action-key confirma" data-action="confirm">CONFIRMA</button></div></div></div><div class="ballot-note"><span>${icon('lock')} Seu voto será salvo após apertar CONFIRMA.</span><button class="text-btn" data-action="cancel-vote">${icon('back')} Cancelar identificação</button></div></section></main>`;
  screen();
  window.scrollTo(0,0);
}
function choice() { return state.blank?'blank':state.digits.length===2?(state.data.candidates.find(c=>c.number===state.digits)?.id||'nullVote'):null; }
function screen() {
  const selected=choice(),c=state.data.candidates.find(x=>x.id===selected);
  const digits=`<div class="digit-row"><span>Número:</span>${[0,1].map(i=>`<div class="digit ${state.digits.length===i?'cursor':''}">${state.digits[i]||''}</div>`).join('')}</div>`;
  let content='';
  if (state.blank) content='<div class="blank-title">VOTO EM BRANCO</div><p class="choice-info">Você não escolheu nenhuma chapa.</p>';
  else {
    content=digits;
    if(c) content=`<div class="ballot-choice"><div class="choice-info">${digits}<span>Chapa escolhida</span><strong>${esc(c.name)}</strong>${c.representativeName?`<span class="representative-label">${esc(c.representativeName)}</span>`:''}<p class="vote-hint">Confira o número e o grupo antes de confirmar.</p></div><div class="ballot-photo-frame">${photo(c)}</div></div>`;
    else if(selected==='nullVote')content+='<div class="blank-title">VOTO NULO</div><p class="choice-info">Número não cadastrado. Para trocar, aperte CORRIGE.</p>';
    else content+='<p class="screen-message">Use o teclado ao lado para digitar os <b>2 dígitos</b> da sua chapa.<br><br>Você também pode votar em branco.</p>';
  }
  $('#ballot-screen').innerHTML=`<div class="screen-eyebrow">SEU VOTO PARA</div><h2 class="vote-office">${esc(state.data.electionTitle)}</h2>${content}<div class="screen-bottom">${state.saving?'<b>Gravando seu voto… Aguarde.</b>':selected?'<b>CONFIRMA</b> para registrar seu voto.<br><b>CORRIGE</b> para escolher novamente.':'O voto é sigiloso.<br>Confira sua escolha antes de confirmar.'}</div>`;
  document.querySelectorAll('.key,.action-key').forEach(b=>b.disabled=state.saving);
  $('.confirma').disabled=state.saving || !selected;
}
function beep() {
  try { const ac=new(window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.setValueAtTime(680,ac.currentTime);o.frequency.setValueAtTime(880,ac.currentTime+.12);g.gain.setValueAtTime(.1,ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.45);o.start();o.stop(ac.currentTime+.45);o.onended=()=>ac.close(); }catch(_){}
}
async function confirmVote() {
  if(state.saving||!choice()||!state.voter)return;
  state.saving=true;screen();
  try {
    await api('vote',{voterToken:state.voter,choice:choice()});
    state.voter=null;state.digits='';state.blank=false;state.route='success';beep();
    $('#app').innerHTML=`<main class="success-page"><div><div class="success-icon">${icon('check')}</div><h1>FIM</h1><h2>Seu voto foi registrado.</h2><p>Obrigado por participar do futuro da nossa escola.</p><button class="btn lime" data-action="home">Voltar ao início ${icon('arrow')}</button><small>A urna voltará ao início automaticamente.</small></div></main>`;
    window.scrollTo(0,0);
    state.finishTimer=setTimeout(()=>goHome(),4500);
  }catch(err){toast(err.message,true);screen();}
  finally{state.saving=false;if(state.route==='ballot')screen();}
}
async function goHome(){clearTimeout(state.finishTimer);try{await refresh();}catch(err){toast(err.message,true);}home();}
async function accessResults(next='results') {
  const access=await api('admin/access',{});state.admin=access.adminToken;
  await openAdmin(next);
}
async function openAdmin(tab='results') {
  state.adminData=await api('admin/state',undefined,true);state.adminTab=tab==='close'?'results':tab;
  renderAdmin();
  if(tab==='close' && state.adminData.status==='open')closePrompt();
}
function renderAdmin() {
  const d=state.adminData;
  dialog('Resultados da urna',`${esc(d.urnName)} · ${d.status==='open'?'Votação em andamento':'Votação encerrada'}`,
    `<nav class="admin-tabs"><button class="tab ${state.adminTab==='results'?'active':''}" data-action="admin-tab" data-value="results">Apuração</button><button class="tab ${state.adminTab==='merge'?'active':''}" data-action="admin-tab" data-value="merge">Somar urnas</button></nav><div class="dialog-body" id="admin-content">${state.adminTab==='merge'?mergeBody():resultsBody(d)}</div>`,true);
}
function resultsTable(d) {
  const counts=d.counts||{},sum=total(counts);
  const rows=(d.candidates||state.data.candidates).map(c=>({label:`${c.number} · ${c.name}`,count:Number(counts[c.id]||0)}));
  rows.push({label:'Votos em branco',count:Number(counts.blank||0)},{label:'Votos nulos',count:Number(counts.nullVote||0)});
  return `<table class="result-table"><thead><tr><th>Chapa / tipo de voto</th><th>Votos</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.count}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total de votos registrados</td><td>${sum}</td></tr></tfoot></table>`;
}
function resultsBody(d) {
  const t=total(d.counts),p=Array.isArray(d.participants)?d.participants.length:Number(d.total||0);
  if(d.status==='open')return `<div class="metric-row"><div class="metric"><span>Participações nesta urna</span><strong>${p}</strong></div><div class="metric"><span>Situação</span><strong style="font-size:22px">Em votação</strong></div></div><div class="notice">O resultado por chapa aparece após o encerramento. Finalize somente quando todos os alunos destinados a esta urna tiverem votado.</div><button class="btn danger" data-action="close-prompt">${icon('lock')} Finalizar votação</button>`;
  return `<div class="closed-banner">Votação encerrada. Esta urna não recebe novos votos.</div><div class="metric-row"><div class="metric"><span>Votos registrados</span><strong>${t}</strong></div><div class="metric"><span>Alunos na lista de presença</span><strong>${p}</strong></div><div class="metric"><span>Conferência da apuração</span><strong style="font-size:22px">${p===t?'Tudo certo':'Divergência'}</strong></div></div>${resultsTable(d)}<div class="form-actions"><button class="btn primary" data-action="export-csv">${icon('download')} Baixar resultado (Excel)</button><button class="btn secondary" data-action="export-json">${icon('download')} Baixar arquivo da urna (JSON)</button><button class="btn secondary" data-action="print">${icon('print')} Imprimir / PDF</button></div><div class="form-actions"><button class="text-btn" data-action="export-participants">Baixar lista de presença ${icon('download')}</button></div>${nativePlatform?'<div class="form-actions"><button class="btn secondary" data-action="new-election-prompt">'+icon('plus')+' Preparar nova eleição</button></div>':''}<p class="small-text mt">Guarde o arquivo JSON de cada aparelho para somar as urnas. O resultado e a lista de presença são arquivos separados; nenhum deles informa a escolha de um aluno.</p>`;
}
function mergeBody() {
  return `<div class="notice">Selecione o arquivo JSON de <b>cada aparelho</b> após finalizar todas as urnas. O sistema confere a eleição, os totais, as urnas repetidas e alunos que aparecem em mais de uma urna.</div><label class="file-drop">${icon('urn')}<br>Arquivos das urnas encerradas<input type="file" id="batch-files" accept=".json,application/json" multiple></label><div id="batch-list" class="import-list">${state.batches.map(b=>esc(b.urnName||'Arquivo de urna')).join('<br>')}</div><div class="form-actions"><button class="btn primary" data-action="merge" ${state.batches.length?'':'disabled'}>Conferir e somar urnas ${icon('arrow')}</button></div><div id="merged-result">${state.merged?mergedResult():''}</div><p class="small-text mt">Sem internet, o controle entre aparelhos depende dos responsáveis pela votação. Divida as turmas entre urnas para que cada aluno vote em apenas um aparelho. Se houver duplicidade, o sistema aponta a ocorrência; os responsáveis precisam resolver a situação antes de concluir a apuração.</p>`;
}
function mergedResult(){const d=state.merged;return `<h3 class="report-title mt">Apuração geral</h3><div class="notice">${(d.urns||[]).length || state.batches.length} urnas conferidas · ${total(d.counts)} votos · sem alunos repetidos entre as urnas.</div>${resultsTable(d)}<div class="form-actions"><button class="btn primary" data-action="merged-csv">${icon('download')} Baixar resultado geral (Excel)</button><button class="btn secondary" data-action="merged-json">${icon('download')} Guardar apuração geral</button><button class="btn secondary" data-action="merged-print">${icon('print')} Imprimir / PDF</button></div>`;}
function closePrompt() {
  $('#admin-content').innerHTML=`<h3 class="report-title">Finalizar votação desta urna?</h3><div class="notice warning mt">O encerramento é definitivo. Esta urna deixará de receber votos e a apuração ficará disponível para exportação.</div><label class="check-line"><input id="close-confirm" type="checkbox"> Confirmo que todos os alunos previstos para esta urna já tiveram oportunidade de votar.</label><div class="form-actions"><button class="btn secondary" data-action="dismiss">Continuar votação</button><button class="btn danger" data-action="close-election">Finalizar e ver resultado</button></div>`;
}
function safeName(name){return String(name||'urna').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,80);}
async function download(data,filename,type) {
  const blob=data instanceof Blob?data:new Blob([data],{type:type||'application/octet-stream'});
  if(nativePlatform){
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Não foi possível preparar o arquivo.'));reader.readAsDataURL(blob);});
    await nativeCall('saveFile',filename,type||blob.type||'application/octet-stream',encoded);return;
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function serverDownload(path,filename) {
  if(nativePlatform){
    const reply=await nativeRequest('admin/'+path,undefined,true);
    await download(typeof reply.data==='string'?reply.data:JSON.stringify(reply.data,null,2),filename,reply.contentType||'application/json');
    toast('Arquivo salvo no local escolhido.');return;
  }
  const r=await fetch('/api/admin/'+path,{headers:{'X-Admin-Token':state.admin},cache:'no-store'});
  if(!r.ok){const e=await r.json();throw new Error(e.error||'Falha ao gerar arquivo.');}
  await download(await r.blob(),filename);toast('Arquivo gerado. Confira a pasta de downloads.');
}
function csvCell(value){let s=String(value==null?'':value);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function mergedCsv(d) {
  const rows=[['APURAÇÃO GERAL DO GRÊMIO ESTUDANTIL'],['Escola',d.school||state.data.school],['Eleição',d.electionTitle||state.data.electionTitle],['Urnas',state.batches.length],[],['Número','Chapa / tipo','Votos']];
  (d.candidates||state.data.candidates).forEach(c=>rows.push(["'"+c.number,c.name,d.counts[c.id]||0]));
  rows.push(['','Votos em branco',d.counts.blank||0],['','Votos nulos',d.counts.nullVote||0],['','TOTAL',total(d.counts)],[],['Presenças conferidas',(d.participants||[]).length]);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
function printReport(d,merged=false) {
  $('#print-root').innerHTML=`<h1>${merged?'Apuração geral':'Boletim de urna'}<br>Grêmio estudantil</h1><p><b>${esc(d.school||state.data.school)}</b><br>${esc(d.electionTitle||state.data.electionTitle)}<br>${merged?`${state.batches.length} urnas consolidadas`:esc(d.urnName)}<br>Emitido em ${esc(new Date().toLocaleString('pt-BR'))}</p>${resultsTable(d)}<p>Presenças conferidas: ${(d.participants||[]).length}. Total de votos: ${total(d.counts)}.<br>Votos nominais + brancos + nulos = total de votos registrados.</p>${merged?`<p>Urnas: ${state.batches.map(b=>esc(b.urnName)).join(', ')}.</p>`:`<p>Identificador da urna: ${esc(d.urnId||'')}</p>`}<p>A identificação dos alunos é registrada separadamente da apuração. Este boletim não revela a escolha de nenhum estudante.</p><div class="print-signatures"><div>Responsável pela urna</div><div>Responsável pela conferência</div></div>`;
  $('#print-root').insertAdjacentHTML('afterbegin',institutionalLogos());
  if(nativePlatform)window.UrnaAndroid.printDocument();else window.print();
}
async function handleForm(form) {
  if(form.dataset.form!=='identify')return;
  const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
  const values=new FormData(form);
  try {
    const r=await api('identify',{name:values.get('name').trim(),grade:values.get('grade').trim()});
    state.voter=r.voterToken;$('#modal-root').innerHTML='';ballot();
  }catch(err){toast(err.message,true);}
  finally{submit.disabled=false;}
}
async function action(name,button) {
  if(['setup-step','setup-back','setup-next','save-config','select-candidate','edit-review','add-candidate','remove-candidate','confirm-remove-candidate','remove-school-logo','remove-candidate-photo','export-config','open-election'].includes(name)){if(state.route!=='setup')return;await configAction(name,button);return;}
  if(name==='brand-home'){if(state.route==='ballot'||state.route==='success')return;if(state.route==='setup'){window.scrollTo(0,0);return;}await goHome();return;}
  if(name==='reload'){location.reload();return;}
  if(name==='new-election-prompt'){
    if(!nativePlatform||state.adminData?.status!=='closed')return;
    $('#admin-content').innerHTML='<h3 class="report-title">Preparar uma nova eleição?</h3><div class="notice">Exporte os resultados, o arquivo JSON e a lista de presença antes de continuar. A eleição encerrada será arquivada na área privada deste aplicativo e uma nova urna será criada em branco.</div><label class="check-line"><input id="new-election-confirm" type="checkbox"> Já salvei os arquivos da eleição encerrada e quero preparar uma nova eleição.</label><div class="form-actions"><button class="btn secondary" data-action="admin-tab" data-value="results">Voltar aos resultados</button><button class="btn primary" data-action="new-election">Criar nova eleição</button></div>';return;
  }
  if(name==='new-election'){
    if(!nativePlatform||!$('#new-election-confirm')?.checked)throw new Error('Confirme que os arquivos da eleição anterior foram salvos.');
    button.disabled=true;
    try{await api('admin/new',{confirmed:true},true);dismiss();state.admin=null;state.draft=null;state.step=0;state.selected=0;state.dirty=false;state.batches=[];state.merged=null;await refresh();home();toast('Nova eleição criada. Revise e personalize antes de abrir a votação.');}finally{button.disabled=false;}return;
  }
  if(name==='fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();return;}
  if(name==='dismiss'){dismiss();return;}
  if(name==='identify'){identify();return;}
  if(name==='candidate-details'){candidateDetails(button.dataset.value);return;}
  if(name==='enlarge-photo'){enlargePhoto(button.dataset.value);return;}
  if(name==='home'){await goHome();return;}
  if(name==='finish'){await accessResults('close');return;}
  if(name==='digit'){if(!state.saving&&!state.blank&&state.digits.length<2){state.digits+=button.dataset.value;screen();}return;}
  if(name==='blank'){if(!state.saving){state.blank=true;state.digits='';screen();}return;}
  if(name==='correct'){if(!state.saving){state.blank=false;state.digits='';screen();}return;}
  if(name==='confirm'){await confirmVote();return;}
  if(name==='cancel-vote'){if(!state.saving)await goHome();return;}
  if(name==='admin-tab'){state.adminTab=button.dataset.value;state.adminData=await api('admin/state',undefined,true);renderAdmin();return;}
  if(name==='close-prompt'){closePrompt();return;}
  if(name==='close-election'){
    if(!$('#close-confirm')?.checked)throw new Error('Marque a confirmação para finalizar a votação.');
    button.disabled=true;try{await api('admin/close',{},true);await refresh();home();await openAdmin('results');toast('Votação encerrada. O resultado será baixado. Guarde também o arquivo JSON.');try{await serverDownload('report',safeName(state.adminData.urnName)+'-resultado.csv');}catch(err){toast('Urna encerrada e votos preservados. Use Baixar resultado para tentar o download novamente.',true);}}finally{button.disabled=false;}return;
  }
  const fileBase=safeName((state.adminData||{}).urnName);
  if(name==='export-csv'){await serverDownload('report',fileBase+'-resultado.csv');return;}
  if(name==='export-json'){await serverDownload('export',fileBase+'-urna.json');return;}
  if(name==='export-participants'){await serverDownload('participants',fileBase+'-presenca.csv');return;}
  if(name==='print'){printReport(state.adminData);return;}
  if(name==='merge'){
    if(!state.batches.length)throw new Error('Selecione os arquivos JSON das urnas.');
    const leanBatches=state.batches.map(b=>({...b,candidates:Array.isArray(b.candidates)?b.candidates.map(c=>({id:c.id,name:c.name,number:c.number})):b.candidates}));
    button.disabled=true;try{state.merged=await api('admin/consolidate',{batches:leanBatches},true);$('#merged-result').innerHTML=mergedResult();toast('Urnas conferidas. A apuração geral está pronta.');}catch(err){state.merged=null;$('#merged-result').innerHTML=`<div class="notice error mt">${esc(err.message)}</div>`;throw err;}finally{button.disabled=false;}return;
  }
  if(name==='merged-csv'){await download(mergedCsv(state.merged),'apuracao-geral-gremio.csv','text/csv;charset=utf-8');return;}
  if(name==='merged-json'){await download(JSON.stringify(state.merged,null,2),'apuracao-geral-gremio.json','application/json;charset=utf-8');return;}
  if(name==='merged-print'){printReport(state.merged,true);return;}
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button||button.disabled)return;event.preventDefault();Promise.resolve(action(button.dataset.action,button)).catch(err=>toast(err.message,true));});
document.addEventListener('submit',event=>{if(event.target.matches('[data-form]')){event.preventDefault();handleForm(event.target);}});
document.addEventListener('change',async event=>{
  try{
    if(event.target.id==='school-photo'){await uploadPhoto(event.target.files[0],true);return;}
    if(event.target.id==='candidate-photo'){await uploadPhoto(event.target.files[0]);return;}
    if(event.target.id==='import-config'){await importConfiguration(event.target.files[0]);return;}
    if(event.target.id==='batch-files'){
      const files=Array.from(event.target.files);state.batches=[];state.merged=null;$('#merged-result').innerHTML='';
      if(files.length>100)throw new Error('Selecione até 100 arquivos de urna por vez.');
      const batches=[];
      for(const file of files){if(file.size>20*1024*1024)throw new Error('O arquivo '+file.name+' é grande demais.');try{batches.push(JSON.parse(await file.text()));}catch(_){throw new Error('O arquivo '+file.name+' não é um JSON válido.');}}
      state.batches=batches;$('#batch-list').innerHTML=files.map(f=>esc(f.name)).join('<br>');$('[data-action=merge]').disabled=!files.length;
    }
  }catch(err){toast(err.message,true);if(event.target.id==='batch-files'){$('[data-action=merge]').disabled=true;$('#batch-list').textContent='Seleção inválida. Escolha novamente os arquivos.';}}
});
document.addEventListener('input',configInput);
window.addEventListener('beforeunload',event=>{if(state.route==='setup'&&state.dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{
  const modal=$('.dialog');
  if(modal){
    if(event.key==='Escape'){dismiss();return;}
    if(event.key==='Tab'){const nodes=Array.from(modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href]')).filter(n=>n.offsetParent!==null);const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    return;
  }
  if(state.route!=='ballot'||state.saving||$('#modal-root').hasChildNodes())return;
  let a=null;
  if(/^\d$/.test(event.key)){event.preventDefault();action('digit',{dataset:{value:event.key}});return;}
  if(event.key==='Enter')a='confirm';
  if(event.key==='Backspace'||event.key==='Delete')a='correct';
  if(event.key.toLowerCase()==='b')a='blank';
  if(a){event.preventDefault();Promise.resolve(action(a)).catch(err=>toast(err.message,true));}
});
async function init(){
  try {await refresh();home();}
  catch(err){
    if(nativePlatform){$('#app').innerHTML=`<main class="offline-error">${brand()}<h2 class="mt">Não foi possível abrir a urna.</h2><p>${esc(err.message)}</p><p>Feche e reabra o aplicativo. Se o problema continuar, preserve os dados e procure a equipe responsável.</p><button class="btn primary" data-action="reload">Tentar novamente</button></main>`;return;}
    $('#app').innerHTML=`<main class="offline-error">${brand()}<h2 class="mt">A urna não está conectada ao aplicativo.</h2><p>Abra <b>UrnaEstudantil.exe</b> para iniciar. A página precisa ser aberta pelo endereço local fornecido pelo aplicativo.</p><p>Se o programa já estiver aberto, recarregue esta página. Os dados ficam na pasta <b>Dados</b>, ao lado do executável.</p><button class="btn primary" onclick="location.reload()">Tentar novamente</button></main>`;}
}
init();
