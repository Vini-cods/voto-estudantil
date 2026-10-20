'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  urn:'<path d="M5 10h14v11H5z"/><path d="m8 7 3-5 8 5-3 5M9 15h6"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  group:'<circle cx="12" cy="8" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M5 5a3 3 0 0 0 0 6m14-6a3 3 0 0 1 0 6M1 20v-3a4 4 0 0 1 3-4m19 7v-3a4 4 0 0 0-3-4"/>',
  user:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  print:'<path d="M7 7V2h10v5M7 17H3V8h18v9h-4M7 14h10v8H7zM17 11h1"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  back:'<path d="M20 12H5m6-6-6 6 6 6"/>',
  shield:'<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5z"/><path d="m8 11 3 3 5-6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const state = {data:null,admin:null,adminData:null,adminTab:'config',csrf:$('meta[name=urna-token]').content,route:'home',voter:null,digits:'',blank:false,saving:false,photos:{},uploading:0,configDirty:false,batches:[],merged:null,toastTimer:null,finishTimer:null};
function configuredPhoto(c,kind){const key=c.id+'_'+kind;return Object.prototype.hasOwnProperty.call(state.photos,key)?state.photos[key]:(c[kind]||'');}
const defaults = [
  {id:'c1',name:'Chapa Conexão',number:'01',groupPhoto:''},
  {id:'c2',name:'Liderança Jovem',number:'07',groupPhoto:''},
  {id:'c3',name:'Renascer',number:'10',groupPhoto:''}
];
async function api(path, body, admin = false) {
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
function institutionalLogos(){return '<div class="institutional-logos" aria-label="Símbolos institucionais"><img class="logo-gresp" src="/assets/gresp.png" alt="GRESP — Grêmio Estudantil Paulista"><img class="logo-institucional" src="/assets/simbolo-institucional.png" alt="Símbolo institucional enviado pela escola"></div>';}
function brand() { return `<div class="brand"><span class="brand-icon">${icon('urn')}</span><div class="brand-text"><strong>Voz da Escola</strong><small>Urna estudantil</small></div>${institutionalLogos()}</div>`; }
function photo(candidate) {
  const src=candidate.groupPhoto;
  if(src && /^data:image\/(png|jpeg|webp);base64,/.test(src)) return `<img src="${esc(src)}" alt="Grupo da ${esc(candidate.name)}">`;
  return `<div class="photo-placeholder">${icon('group')}<span>Foto do grupo em breve</span></div>`;
}
function total(counts) { return ['c1','c2','c3','blank','nullVote'].reduce((sum,k)=>sum+Number((counts||{})[k]||0),0); }
function countPublic() { return Number(state.data.total == null ? (state.data.participantCount||0) : state.data.total); }
function home() {
  state.route='home';state.voter=null;state.digits='';state.blank=false;
  const d=state.data,candidates=d.candidates || defaults,open=d.status==='open',closed=d.status==='closed';
  $('#app').innerHTML=`<main class="shell">
    <header class="topbar">${brand()}<div class="top-actions"><span class="status">Funciona sem internet</span><button class="text-btn" data-action="fullscreen" aria-label="Tela cheia">${icon('expand')} Tela cheia</button></div></header>
    <section class="hero"><div><div class="eyebrow">${esc(d.school||'Araci Zebral Teixeira')}</div><h1>Sua voz.<br><em>O futuro da escola.</em></h1><p>Escolha quem vai representar os estudantes.<br>Conheça as chapas, identifique-se e faça seu voto valer.</p></div>
    <aside class="intro-card">${icon('urn').replace('<svg','<svg class="stamp"')}<h3>Participar é simples.</h3><ol class="steps"><li><span class="step-num">01</span> Informe seu nome completo e sua turma.</li><li><span class="step-num">02</span> Digite o número da chapa na urna.</li><li><span class="step-num">03</span> Confira as fotos e confirme seu voto.</li></ol></aside></section>
    <div class="section-line"><h2>As chapas desta eleição</h2><span>Grêmio estudantil · 2026</span></div>
    <section class="candidates" aria-label="Chapas candidatas">${candidates.map((c,i)=>`<article class="candidate-card"><button class="group-photo photo-button" type="button" data-action="enlarge-photo" data-value="${esc(c.id)}" aria-label="Ampliar foto da ${esc(c.name)}">${photo(c)}<span class="photo-zoom-label">${icon('expand')} Ampliar foto</span></button><div class="candidate-meta"><div><small>Chapa ${esc(c.number||'—')}</small><h3>${esc(c.name||'Nome a definir')}</h3><button class="candidate-link" data-action="candidate-details" data-value="${esc(c.id)}" aria-label="Conhecer ${esc(c.name)}">Conhecer a chapa ${icon('arrow')}</button></div><span class="number-badge" aria-label="Número ${esc(c.number)}">${esc(c.number||'—')}</span></div></article>`).join('')}</section>
    <section class="start-panel"><div><h2>${closed?'A votação foi encerrada.':open?'Tudo pronto para o seu voto?':'Uma escola melhor começa com você.'}</h2><p>${closed?'A comissão já pode exportar a apuração desta urna.':open?'Tenha seu nome completo e sua série/turma em mãos.':'A comissão está preparando a urna. Aguarde a abertura da votação.'}</p></div><button class="btn lime" data-action="identify" ${open?'':'disabled'}>${icon('user')} Identificar e votar ${icon('arrow')}</button></section>
    <footer class="footer"><span class="footer-info">${icon('shield')} Voto sigiloso · identificação separada da apuração</span><div class="footer-actions"><span>${esc(d.urnName||'Urna 01')}</span><button class="text-btn" data-action="admin">${icon('lock')} Comissão</button><button class="text-btn" data-action="finish">Finalizar votação ${icon('arrow')}</button></div></footer>
  </main>`;
  window.scrollTo(0,0);
}
function dialog(title,description,body,wide=false) {
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="dialog ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${description?`<p>${description}</p>`:''}</div><button class="icon-btn" data-action="dismiss" aria-label="Fechar">${icon('close')}</button></header>${body}</section></div>`;
  setTimeout(()=>$('.dialog input:not([type=file]):not([readonly])')?.focus(),70);
}
function candidateDetails(id) {
  const c=state.data.candidates.find(candidate=>candidate.id===id);if(!c)return;
  const proposals=String(c.proposals||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const members=String(c.members||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  dialog(esc(c.name),`Chapa ${esc(c.number)} · Conheça a equipe e as propostas`,
    `<div class="dialog-body candidate-details"><div class="candidate-detail-layout"><figure class="details-group"><button class="detail-photo-button" data-action="enlarge-photo" data-value="${esc(c.id)}" aria-label="Ampliar foto da ${esc(c.name)}">${photo(c)}<span class="photo-zoom-label">${icon('expand')} Ampliar foto</span></button><figcaption>Representante: ${esc(c.representativeName||'Nome a definir')}</figcaption></figure><div class="details-copy"><h3>Principais propostas</h3>${proposals.length?`<ul class="proposal-list">${proposals.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:'<p class="small-text mt">As propostas desta chapa ainda não foram informadas.</p>'}${members.length?`<section class="team-section"><h3>Integrantes da chapa</h3><ul class="member-list">${members.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></section>`:''}</div></div><div class="form-actions"><button class="btn primary" data-action="dismiss">Voltar às chapas ${icon('back')}</button></div></div>`,true);
}
function enlargePhoto(id){
  const c=state.data.candidates.find(candidate=>candidate.id===id);if(!c)return;
  dialog(esc(c.name),`Chapa ${esc(c.number)} · Foto do grupo`, `<div class="dialog-body photo-viewer">${photo(c)}<div class="form-actions"><button class="btn primary" data-action="candidate-details" data-value="${esc(c.id)}">Voltar à chapa ${icon('back')}</button></div></div>`,true);
}
function dismiss() { $('#modal-root').innerHTML='';if(state.admin){state.admin=null;state.adminData=null;state.photos={};} }
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
  $('#ballot-screen').innerHTML=`<div class="screen-eyebrow">SEU VOTO PARA</div><h2 class="vote-office">Grêmio estudantil</h2>${content}<div class="screen-bottom">${state.saving?'<b>Gravando seu voto… Aguarde.</b>':selected?'<b>CONFIRMA</b> para registrar seu voto.<br><b>CORRIGE</b> para escolher novamente.':'O voto é sigiloso.<br>Confira sua escolha antes de confirmar.'}</div>`;
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
function pinLogin(next='config') {
  if(!state.data.configured) {state.adminData=state.data;state.adminTab='config';renderAdmin(true);return;}
  if(state.admin){openAdmin(next);return;}
  dialog('Área da comissão','Use a senha definida para esta urna.',`<form class="dialog-body" data-form="login" data-next="${esc(next)}"><label class="field">Senha da comissão<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6,}" autocomplete="off" required placeholder="Senha numérica de 6 ou mais dígitos"></label><div class="notice">Somente a comissão deve configurar, finalizar a votação e exportar os arquivos desta urna.</div><button class="btn primary block" type="submit">Entrar ${icon('arrow')}</button></form>`);
}
async function openAdmin(tab='config') {
  state.adminData=await api('admin/state',undefined,true);state.adminTab=tab==='close'?'results':tab;
  state.photos={};renderAdmin(false);
  if(tab==='close' && state.adminData.status==='open')closePrompt();
}
function renderAdmin(initial=false) {
  const d=state.adminData || state.data;
  state.configDirty=false;
  dialog(initial?'Preparar a urna':'Comissão eleitoral',`${esc(d.urnName||'Urna 01')} · ${d.status==='open'?'Votação em andamento':d.status==='closed'?'Votação encerrada':'Configuração inicial'}`,
    `${initial?'':`<nav class="admin-tabs"><button class="tab ${state.adminTab==='config'?'active':''}" data-action="admin-tab" data-value="config">Configuração</button><button class="tab ${state.adminTab==='results'?'active':''}" data-action="admin-tab" data-value="results">Apuração</button><button class="tab ${state.adminTab==='merge'?'active':''}" data-action="admin-tab" data-value="merge">Somar urnas</button></nav>`}<div class="dialog-body" id="admin-content">${state.adminTab==='config'?configBody(d,initial):state.adminTab==='merge'?mergeBody():resultsBody(d)}</div>`,true);
  if(state.adminTab==='config' && d.status==='setup') {
    $('#admin-content').insertAdjacentHTML('afterbegin','<div class="switch-compact" style="margin-bottom:18px"><span class="small-text">Leve as mesmas fotos e chapas aos outros notebooks.</span><div class="form-actions" style="margin:0"><button class="text-btn" data-action="export-config">Exportar configuração '+icon('download')+'</button><label class="btn secondary" style="cursor:pointer">Importar configuração<input id="config-file" type="file" accept=".json" style="display:none"></label></div></div>');
    document.querySelectorAll('input[name=pin]').forEach(input=>input.maxLength=20);
    if(initial) $('input[name=pin]').closest('label').insertAdjacentHTML('afterend','<label class="field">Repita a senha da comissão<input name="pinConfirm" type="password" inputmode="numeric" minlength="6" maxlength="20" pattern="[0-9]{6,20}" autocomplete="new-password" required></label>');
  }
  if(state.adminTab==='config') {
    d.candidates.forEach(c=>{
      const card=$(`input[name="name_${c.id}"]`).closest('.config-card');
      card.insertAdjacentHTML('beforeend',`<label class="field">Nome da representante<input name="representativeName_${c.id}" maxlength="120" ${d.status==='setup'?'':'readonly'} value="${esc(c.representativeName||'')}" placeholder="Nome e turma da representante"></label><label class="field">Propostas principais<textarea name="proposals_${c.id}" maxlength="4000" rows="5" ${d.status==='setup'?'':'readonly'} placeholder="Uma proposta por linha">${esc(c.proposals||'')}</textarea></label><label class="field">Integrantes e turmas<textarea name="members_${c.id}" maxlength="4000" rows="5" ${d.status==='setup'?'':'readonly'} placeholder="Nome e turma, um integrante por linha">${esc(c.members||'')}</textarea></label>`);
    });
  }
}
function configBody(d,initial) {
  const locked=d.status!=='setup',candidates=d.candidates||defaults;
  return `<form data-form="config" data-initial="${initial?'yes':'no'}"><div class="notice ${locked?'warning':''}">${locked?'A configuração está bloqueada porque esta urna já foi aberta.':`Confira os dados e adicione as fotos. Em cada notebook, use um nome de urna diferente. ${initial?'Depois de salvar, abra a votação.':''}`}</div><div class="admin-grid"><label class="field">Escola<input name="school" maxlength="160" value="${esc(d.school||'Araci Zebral Teixeira')}" required ${locked?'readonly':''}></label><label class="field">Nome desta urna<input name="urnName" maxlength="60" value="${esc(d.urnName||'Urna 01')}" required ${locked?'readonly':''}><small>Ex.: Urna 01 · Biblioteca. Use um nome diferente em cada notebook.</small></label><label class="field">Título da eleição<input name="electionTitle" maxlength="160" value="${esc(d.electionTitle||'Eleição do Grêmio Estudantil 2026')}" required ${locked?'readonly':''}></label>${initial?'<label class="field">Crie a senha da comissão<input name="pin" type="password" inputmode="numeric" minlength="6" maxlength="64" pattern="[0-9]{6,}" autocomplete="new-password" required><small>Use 6 ou mais números. Guarde a senha com a comissão.</small></label>':''}</div><div class="admin-candidates">${candidates.map((c,i)=>`<section class="config-card"><h3>Chapa ${esc(c.number||'—')}</h3><label class="field">Nome da chapa<input name="name_${c.id}" maxlength="100" required value="${esc(c.name)}" ${locked?'readonly':''}></label><label class="field">Número · 2 dígitos<input name="number_${c.id}" inputmode="numeric" pattern="[0-9]{2}" minlength="2" maxlength="2" required value="${esc(c.number)}" ${locked?'readonly':''}></label>${['groupPhoto'].map(kind=>`<label class="field">Foto do grupo${locked?'':`<input type="file" accept="image/png,image/jpeg,image/webp" data-photo="${c.id}" data-kind="${kind}">`}<span id="preview_${c.id}_${kind}">${c[kind]?`<img src="${esc(c[kind])}" alt="Foto cadastrada">`:'<small>Foto ainda não cadastrada.</small>'}</span></label>`).join('')}</section>`).join('')}</div>${locked?'':`<div class="form-actions"><button class="btn primary" type="submit">${icon('check')} Salvar configuração</button>${initial?'':'<button class="btn secondary" type="button" data-action="open-prompt">Abrir votação '+icon('arrow')+'</button>'}</div>`}</form>`;
}
function resultsTable(d) {
  const counts=d.counts||{},sum=total(counts);
  const rows=(d.candidates||state.data.candidates).map(c=>({label:`${c.number} · ${c.name}`,count:Number(counts[c.id]||0)}));
  rows.push({label:'Votos em branco',count:Number(counts.blank||0)},{label:'Votos nulos',count:Number(counts.nullVote||0)});
  return `<table class="result-table"><thead><tr><th>Chapa / tipo de voto</th><th>Votos</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.count}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total de votos registrados</td><td>${sum}</td></tr></tfoot></table>`;
}
function resultsBody(d) {
  const t=total(d.counts),p=Array.isArray(d.participants)?d.participants.length:Number(d.total||0);
  if(d.status==='setup')return `<div class="notice">Esta urna ainda está em preparação. Salve a configuração e abra a votação para receber os alunos.</div><button class="btn primary" data-action="admin-tab" data-value="config">Voltar à configuração</button>`;
  if(d.status==='open')return `<div class="metric-row"><div class="metric"><span>Participações nesta urna</span><strong>${p}</strong></div><div class="metric"><span>Situação</span><strong style="font-size:22px">Em votação</strong></div></div><div class="notice">O resultado por chapa aparece após o encerramento. Finalize somente quando todos os alunos destinados a esta urna tiverem votado.</div><button class="btn danger" data-action="close-prompt">${icon('lock')} Finalizar votação</button>`;
  return `<div class="closed-banner">Votação encerrada. Esta urna não recebe novos votos.</div><div class="metric-row"><div class="metric"><span>Votos registrados</span><strong>${t}</strong></div><div class="metric"><span>Alunos na lista de presença</span><strong>${p}</strong></div><div class="metric"><span>Conferência da apuração</span><strong style="font-size:22px">${p===t?'Tudo certo':'Divergência'}</strong></div></div>${resultsTable(d)}<div class="form-actions"><button class="btn primary" data-action="export-csv">${icon('download')} Baixar resultado (Excel)</button><button class="btn secondary" data-action="export-json">${icon('download')} Baixar arquivo da urna (JSON)</button><button class="btn secondary" data-action="print">${icon('print')} Imprimir / PDF</button></div><div class="form-actions"><button class="text-btn" data-action="export-participants">Baixar lista de presença ${icon('download')}</button></div><p class="small-text mt">Guarde o arquivo JSON de cada notebook para somar as urnas. O resultado e a lista de presença são arquivos separados; nenhum deles informa a escolha de um aluno.</p>`;
}
function mergeBody() {
  return `<div class="notice">Selecione o arquivo JSON de <b>cada notebook</b> após finalizar todas as urnas. O sistema confere a eleição, os totais, as urnas repetidas e alunos que aparecem em mais de uma urna.</div><label class="file-drop">${icon('urn')}<br>Arquivos das urnas encerradas<input type="file" id="batch-files" accept=".json,application/json" multiple></label><div id="batch-list" class="import-list">${state.batches.map(b=>esc(b.urnName||'Arquivo de urna')).join('<br>')}</div><div class="form-actions"><button class="btn primary" data-action="merge" ${state.batches.length?'':'disabled'}>Conferir e somar urnas ${icon('arrow')}</button></div><div id="merged-result">${state.merged?mergedResult():''}</div><p class="small-text mt">Sem internet, o controle entre notebooks depende da comissão. Divida as turmas entre urnas para que cada aluno vote em apenas um notebook. Se houver duplicidade, o sistema aponta a ocorrência; a comissão precisa resolver a situação antes de concluir a apuração.</p>`;
}
function mergedResult(){const d=state.merged;return `<h3 class="report-title mt">Apuração geral</h3><div class="notice">${(d.urns||[]).length || state.batches.length} urnas conferidas · ${total(d.counts)} votos · sem alunos repetidos entre as urnas.</div>${resultsTable(d)}<div class="form-actions"><button class="btn primary" data-action="merged-csv">${icon('download')} Baixar resultado geral (Excel)</button><button class="btn secondary" data-action="merged-json">${icon('download')} Guardar apuração geral</button><button class="btn secondary" data-action="merged-print">${icon('print')} Imprimir / PDF</button></div>`;}
function openPrompt() {
  const d=state.adminData;
  $('#admin-content').innerHTML=`<h3 class="report-title">Abrir esta urna para votação?</h3><div class="notice mt">Após abrir, nomes, números e fotos ficam bloqueados. Confira a configuração e o nome desta urna antes de continuar.</div><p class="small-text">${esc(d.school)}<br><b>${esc(d.urnName)}</b><br>${d.candidates.map(c=>`${esc(c.number)} · ${esc(c.name)}`).join('<br>')}</p>${d.candidates.some(c=>!c.groupPhoto)?'<div class="notice warning mt">Há fotos pendentes. Volte à configuração para incluir as imagens antes da abertura.</div>':''}<label class="check-line"><input id="open-confirm" type="checkbox"> Conferi os dados, preparei a lista de alunos desta urna e estou pronto para iniciar.</label><div class="form-actions"><button class="btn secondary" data-action="admin-tab" data-value="config">Voltar à configuração</button><button class="btn primary" data-action="open-election">Abrir votação</button></div>`;
}
function closePrompt() {
  $('#admin-content').innerHTML=`<h3 class="report-title">Finalizar votação desta urna?</h3><div class="notice warning mt">O encerramento é definitivo. Esta urna deixará de receber votos e a apuração ficará disponível para exportação.</div><label class="check-line"><input id="close-confirm" type="checkbox"> A comissão confirma que todos os alunos previstos para esta urna já tiveram oportunidade de votar.</label><div class="form-actions"><button class="btn secondary" data-action="admin-tab" data-value="results">Continuar votação</button><button class="btn danger" data-action="close-election">Finalizar e ver resultado</button></div>`;
}
function safeName(name){return String(name||'urna').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,80);}
function download(data,filename,type) {
  const blob=data instanceof Blob?data:new Blob([data],{type:type||'application/octet-stream'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function serverDownload(path,filename) {
  const r=await fetch('/api/admin/'+path,{headers:{'X-Admin-Token':state.admin},cache:'no-store'});
  if(!r.ok){const e=await r.json();throw new Error(e.error||'Falha ao gerar arquivo.');}
  download(await r.blob(),filename);toast('Arquivo gerado. Confira a pasta de downloads.');
}
function csvCell(value){let s=String(value==null?'':value);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function mergedCsv(d) {
  const rows=[['APURAÇÃO GERAL DO GRÊMIO ESTUDANTIL'],['Escola',d.school||state.data.school],['Eleição',d.electionTitle||state.data.electionTitle],['Urnas',state.batches.length],[],['Número','Chapa / tipo','Votos']];
  (d.candidates||state.data.candidates).forEach(c=>rows.push(["'"+c.number,c.name,d.counts[c.id]||0]));
  rows.push(['','Votos em branco',d.counts.blank||0],['','Votos nulos',d.counts.nullVote||0],['','TOTAL',total(d.counts)],[],['Presenças conferidas',(d.participants||[]).length]);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
function printReport(d,merged=false) {
  // The same original institutional images are also printed on the ballot report.
  $('#print-root').innerHTML=`<h1>${merged?'Apuração geral':'Boletim de urna'}<br>Grêmio estudantil</h1><p><b>${esc(d.school||state.data.school)}</b><br>${esc(d.electionTitle||state.data.electionTitle)}<br>${merged?`${state.batches.length} urnas consolidadas`:esc(d.urnName)}<br>Emitido em ${esc(new Date().toLocaleString('pt-BR'))}</p>${resultsTable(d)}<p>Presenças conferidas: ${(d.participants||[]).length}. Total de votos: ${total(d.counts)}.<br>Votos nominais + brancos + nulos = total de votos registrados.</p>${merged?`<p>Urnas: ${state.batches.map(b=>esc(b.urnName)).join(', ')}.</p>`:`<p>Identificador da urna: ${esc(d.urnId||'')}</p>`}<p>A identificação dos alunos é registrada separadamente da apuração. Este boletim não revela a escolha de nenhum estudante.</p><div class="print-signatures"><div>Comissão eleitoral</div><div>Responsável pela conferência</div></div>`;
  $('#print-root').insertAdjacentHTML('afterbegin',institutionalLogos());
  window.print();
}
async function uploadPhoto(input) {
  const f=input.files[0];if(!f)return;
  if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>12*1024*1024){input.value='';throw new Error('Escolha uma foto JPG, PNG ou WebP de até 12 MB.');}
  const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Não foi possível ler a foto.'));r.readAsDataURL(f);});
  const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('A foto não pôde ser aberta.'));i.src=src;});
  const scale=Math.min(1,1100/image.width,900/image.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',.86),id=input.dataset.photo,kind=input.dataset.kind;
  state.photos[id+'_'+kind]=data;$('#preview_'+id+'_'+kind).innerHTML=`<img src="${data}" alt="Foto selecionada">`;
}
async function handleForm(form) {
  const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
  const values=new FormData(form);
  try {
    if(form.dataset.form==='identify') {
      const r=await api('identify',{name:values.get('name').trim(),grade:values.get('grade').trim()});state.voter=r.voterToken;$('#modal-root').innerHTML='';ballot();
    }else if(form.dataset.form==='login'){
      const r=await api('admin/login',{pin:values.get('pin')});state.admin=r.adminToken;await openAdmin(form.dataset.next);
    }else if(form.dataset.form==='config'){
      if(state.uploading)throw new Error('Aguarde o processamento das fotos antes de salvar.');
      const initial=form.dataset.initial==='yes';
      const config={school:values.get('school').trim(),urnName:values.get('urnName').trim(),electionTitle:values.get('electionTitle').trim(),candidates:(state.adminData.candidates||defaults).map(c=>({id:c.id,name:values.get('name_'+c.id).trim(),number:values.get('number_'+c.id),groupPhoto:configuredPhoto(c,'groupPhoto'),proposals:String(values.get('proposals_'+c.id)||'').trim(),members:String(values.get('members_'+c.id)||'').trim(),representativeName:String(values.get('representativeName_'+c.id)||'').trim()}))};
      if(new Set(config.candidates.map(c=>c.number)).size!==3)throw new Error('Cada chapa precisa de um número diferente.');
      if(initial) {if(values.get('pin')!==values.get('pinConfirm'))throw new Error('As duas senhas precisam ser iguais. Confira e tente novamente.');config.pin=values.get('pin');const r=await api('admin/setup',config);state.admin=r.adminToken;}
      else await api('admin/config',config,true);
      await refresh();home();await openAdmin('config');toast('Configuração salva. Confira os dados e abra a votação quando estiver pronto.');
    }
  }catch(err){toast(err.message,true);}
  finally{submit.disabled=false;}
}
async function action(name,button) {
  if(name==='fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();return;}
  if(name==='dismiss'){dismiss();return;}
  if(name==='identify'){identify();return;}
  if(name==='candidate-details'){candidateDetails(button.dataset.value);return;}
  if(name==='enlarge-photo'){enlargePhoto(button.dataset.value);return;}
  if(name==='home'){await goHome();return;}
  if(name==='admin'||name==='finish'){pinLogin(name==='finish'?'close':'config');return;}
  if(name==='digit'){if(!state.saving&&!state.blank&&state.digits.length<2){state.digits+=button.dataset.value;screen();}return;}
  if(name==='blank'){if(!state.saving){state.blank=true;state.digits='';screen();}return;}
  if(name==='correct'){if(!state.saving){state.blank=false;state.digits='';screen();}return;}
  if(name==='confirm'){await confirmVote();return;}
  if(name==='cancel-vote'){if(!state.saving)await goHome();return;}
  if(name==='admin-tab'){state.adminTab=button.dataset.value;state.adminData=await api('admin/state',undefined,true);state.photos={};renderAdmin(false);return;}
  if(name==='export-config'){
    if(state.uploading)throw new Error('Aguarde o processamento das fotos antes de exportar.');
    const form=$('[data-form=config]'),values=new FormData(form),d=state.adminData;
    const config={format:'urna-estudantil-config-v1',school:values.get('school').trim(),electionTitle:values.get('electionTitle').trim(),candidates:d.candidates.map(c=>({id:c.id,name:values.get('name_'+c.id).trim(),number:values.get('number_'+c.id),groupPhoto:configuredPhoto(c,'groupPhoto'),proposals:String(values.get('proposals_'+c.id)||'').trim(),members:String(values.get('members_'+c.id)||'').trim(),representativeName:String(values.get('representativeName_'+c.id)||'').trim()}))};
    download(JSON.stringify(config,null,2),'configuracao-chapas.json','application/json;charset=utf-8');toast('Configuração exportada com as fotos. Cada notebook manterá seu nome de urna e sua própria senha.');return;
  }
  if(name==='open-prompt'){if(state.uploading)throw new Error('Aguarde o processamento das fotos.');if(state.configDirty)throw new Error('Salve as alterações da configuração antes de abrir a votação.');openPrompt();return;}
  if(name==='open-election'){
    if(!$('#open-confirm')?.checked)throw new Error('Marque a confirmação da comissão para abrir a votação.');
    button.disabled=true;try{await api('admin/open',{},true);await refresh();home();dismiss();toast('Votação aberta. A urna está pronta para os alunos.');}finally{button.disabled=false;}return;
  }
  if(name==='close-prompt'){closePrompt();return;}
  if(name==='close-election'){
    if(!$('#close-confirm')?.checked)throw new Error('Marque a confirmação da comissão para finalizar a votação.');
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
  if(name==='merged-csv'){download(mergedCsv(state.merged),'apuracao-geral-gremio.csv','text/csv;charset=utf-8');return;}
  if(name==='merged-json'){download(JSON.stringify(state.merged,null,2),'apuracao-geral-gremio.json','application/json;charset=utf-8');return;}
  if(name==='merged-print'){printReport(state.merged,true);return;}
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button||button.disabled)return;event.preventDefault();Promise.resolve(action(button.dataset.action,button)).catch(err=>toast(err.message,true));});
document.addEventListener('submit',event=>{if(event.target.matches('[data-form]')){event.preventDefault();handleForm(event.target);}});
document.addEventListener('input',event=>{if(event.target.closest('[data-form=config]'))state.configDirty=true;});
document.addEventListener('change',async event=>{
  try{
    if(event.target.matches('[data-photo]')){state.uploading++;state.configDirty=true;try{await uploadPhoto(event.target);}finally{state.uploading--;}}
    if(event.target.id==='config-file'){
      const file=event.target.files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('O arquivo de configuração deve ter até 8 MB.');
      let c;try{c=JSON.parse(await file.text());}catch(_){throw new Error('Este arquivo de configuração não é um JSON válido.');}
      if(c.format!=='urna-estudantil-config-v1'||!Array.isArray(c.candidates)||c.candidates.length!==3||typeof c.school!=='string'||typeof c.electionTitle!=='string')throw new Error('Selecione o arquivo configuracao-chapas.json exportado pela urna.');
      const keys=new Set();c.candidates.forEach((x,i)=>{if(x.id!=='c'+(i+1)||typeof x.name!=='string'||!/^\d{2}$/.test(x.number)||keys.has(x.number))throw new Error('As chapas ou os números deste arquivo são inválidos.');keys.add(x.number);['groupPhoto'].forEach(k=>{if(x[k]&&!/^data:image\/(jpeg|png|webp);base64,/.test(x[k]))throw new Error('Foto inválida na configuração.');});});
      const form=$('[data-form=config]');form.elements.namedItem('school').value=c.school;form.elements.namedItem('electionTitle').value=c.electionTitle;
      c.candidates.forEach(x=>{form.elements.namedItem('name_'+x.id).value=x.name;form.elements.namedItem('number_'+x.id).value=x.number;form.elements.namedItem('proposals_'+x.id).value=typeof x.proposals==='string'?x.proposals:'';form.elements.namedItem('members_'+x.id).value=typeof x.members==='string'?x.members:'';form.elements.namedItem('representativeName_'+x.id).value=typeof x.representativeName==='string'?x.representativeName:'';['groupPhoto'].forEach(k=>{state.photos[x.id+'_'+k]=x[k]||'';$('#preview_'+x.id+'_'+k).innerHTML=x[k]?`<img src="${esc(x[k])}" alt="Foto importada">`:'<small>Foto ainda não cadastrada.</small>';});});
      state.configDirty=true;
      toast('Configuração importada. Defina o nome desta urna e salve antes de abrir a votação.');
    }
    if(event.target.id==='batch-files'){
      const files=Array.from(event.target.files);state.batches=[];state.merged=null;$('#merged-result').innerHTML='';
      if(files.length>100)throw new Error('Selecione até 100 arquivos de urna por vez.');
      const batches=[];
      for(const file of files){if(file.size>20*1024*1024)throw new Error('O arquivo '+file.name+' é grande demais.');try{batches.push(JSON.parse(await file.text()));}catch(_){throw new Error('O arquivo '+file.name+' não é um JSON válido.');}}
      state.batches=batches;$('#batch-list').innerHTML=files.map(f=>esc(f.name)).join('<br>');$('[data-action=merge]').disabled=!files.length;
    }
  }catch(err){toast(err.message,true);if(event.target.id==='batch-files'){$('[data-action=merge]').disabled=true;$('#batch-list').textContent='Seleção inválida. Escolha novamente os arquivos.';}}
});
document.addEventListener('keydown',event=>{
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
  catch(err){$('#app').innerHTML=`<main class="offline-error">${brand()}<h2 class="mt">A urna não está conectada ao aplicativo.</h2><p>Abra <b>UrnaEstudantil.exe</b> para iniciar. A página precisa ser aberta pelo endereço local fornecido pelo aplicativo.</p><p>Se o programa já estiver aberto, recarregue esta página. Os dados ficam na pasta <b>Dados</b>, ao lado do executável.</p><button class="btn primary" onclick="location.reload()">Tentar novamente</button></main>`;}
}
init();
