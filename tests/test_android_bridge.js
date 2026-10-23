'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/web/app.js','utf8').replace(/init\(\);\s*$/,'');
function harness(android){
  const calls=[],timers=[],toast={className:'',textContent:''};
  const document={documentElement:{classList:{add(){} }},querySelector(selector){if(selector==='meta[name=urna-token]')return {content:'page-token'};if(selector==='#toast')return toast;return null;},addEventListener(){}};
  const window={addEventListener(){}};
  if(android)window.UrnaAndroid={request(...args){calls.push({method:'request',args});},saveFile(...args){calls.push({method:'saveFile',args});}};
  const context=vm.createContext({window,document,console,Blob,TextDecoder,Uint8Array,Map,URL,atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},fetch:async(url,options)=>{calls.push({method:'fetch',url,options});return {ok:true,headers:{get(){return 'application/json';}},async json(){return {status:'setup'};}};},FileReader:class{readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:'+blob.type+';base64,'+Buffer.from(b).toString('base64');this.onload();});}}});
  vm.runInContext(source,context);
  function reply(id,data,status=200,contentType='application/json'){window.__urnaAndroidReply(id,Buffer.from(JSON.stringify({status,data,contentType}),'utf8').toString('base64'));}
  return {calls,context,reply,toast};
}
(async()=>{
  let h=harness(true);
  const pending=vm.runInContext("api('state')",h.context);
  let call=h.calls.shift();assert.equal(call.method,'request');
  const payload=JSON.parse(call.args[1]);assert.equal(payload.method,'GET');assert.equal(payload.path,'state');assert.equal(payload.csrf,'page-token');
  h.reply(call.args[0],{school:'Escola Fictícia — inclusão',total:0});assert.equal((await pending).school,'Escola Fictícia — inclusão');
  const bad=vm.runInContext("api('vote',{choice:'c1'})",h.context);const rejected=assert.rejects(bad,/Voto já registrado/);call=h.calls.shift();h.reply(call.args[0],{error:'Voto já registrado'},409);await rejected;
  const malformed=vm.runInContext("api('state')",h.context);const malformedRejection=assert.rejects(malformed);call=h.calls.shift();h.context.window.__urnaAndroidReply(call.args[0],'bad payload');await malformedRejection;
  const save=vm.runInContext("download('Nome;Votos\\nExemplo;1','resultado.csv','text/csv;charset=utf-8')",h.context);let saved=false;save.then(()=>saved=true);
  await new Promise(resolve=>setImmediate(resolve));call=h.calls.shift();assert.equal(call.method,'saveFile');assert.equal(call.args[1],'resultado.csv');assert.equal(Buffer.from(call.args[3],'base64').toString('utf8'),'Nome;Votos\nExemplo;1');assert.equal(saved,false,'Must wait for actual document save');h.reply(call.args[0],{saved:true});await save;assert.equal(saved,true);
  const canceled=vm.runInContext("download('x','teste.json','application/json')",h.context);const cancelRejection=assert.rejects(canceled,/cancelado/);await new Promise(resolve=>setImmediate(resolve));call=h.calls.shift();h.reply(call.args[0],{error:'Salvamento cancelado'},409);await cancelRejection;
  h=harness(false);await vm.runInContext("state.admin='local-session';api('admin/config',{school:'Fictícia'},true)",h.context);call=h.calls.shift();assert.equal(call.method,'fetch');assert.equal(call.url,'/api/admin/config');assert.equal(call.options.method,'POST');assert.equal(call.options.headers['X-Urna-Token'],'page-token');assert.equal(call.options.headers['X-Admin-Token'],'local-session');assert.equal(JSON.parse(call.options.body).school,'Fictícia');
  console.log('ANDROID BRIDGE CHECKS PASSED: native routing, UTF-8, errors, malformed replies, durable-save acknowledgement, cancellation and Windows fetch fallback.');
})().catch(err=>{console.error(err);process.exitCode=1;});