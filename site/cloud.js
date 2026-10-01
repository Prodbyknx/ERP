/* 144 Lab: autenticação, lotes atômicos, recuperação e sincronização. */
(() => {
  'use strict';
  const collections = ['config','products','sales','quotes','printers','filaments','clients','crm_logs','services','expenses','stock_snapshots','prod_log','consignments','consig_history','est_cfg','meta'];
  const single = new Set(['config','est_cfg','meta']);
  const copy = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const equal = (a,b) => stable(a) === stable(b);
  function stable(x) {
    if (Array.isArray(x)) return '['+x.map(stable).join(',')+']';
    if (x && typeof x==='object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
    return JSON.stringify(x);
  }
  const el = id => document.getElementById(id);
  let client, baseline = {}, live = {}, dirty = new Set(), timer, started = false;
  let pending = null, sending = false, refreshing = null, lastToast = null, startup = false;
  let cursor='0', lastReconcile=0, realtimeTimer, busyTimer, reconcileRequested=false;
  // Servidor com a proteção por perfil (seguranca/protecao-servidor.sql): o banco
  // filtra o que cada um recebe, o tempo real só avisa "mudou algo" e os usuários
  // vêm de uma função. Sem ela, o site segue do jeito antigo.
  let protegido=false;
  const rowVersions=new Map(), rowOrder=new Map(), incoming=new Map();
  const RECONCILE_MS=5*60*1000;
  const pendingKey = '144erp_pending_v1';
  const status = document.createElement('div');
  status.id='cloud-status'; status.style.cssText='position:fixed;bottom:8px;left:8px;z-index:20000;background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:8px;padding:5px 10px;font:12px system-ui';
  status.textContent='Conectando…'; document.body.appendChild(status);
  const barrier = document.createElement('div'); barrier.id='cloud-barrier';
  barrier.style.cssText='display:none;position:fixed;inset:0;background:#0f172a88;z-index:30000;align-items:center;justify-content:center;font:15px system-ui';
  const card=document.createElement('div');card.style.cssText='background:white;color:#111827;padding:24px;border-radius:12px;width:min(90vw,540px)';
  const message=document.createElement('p');card.appendChild(message);
  const buttons=document.createElement('div');card.appendChild(buttons);barrier.appendChild(card);document.body.appendChild(barrier);
  function block(text, actions=[]) {
    el('app-wrapper').inert=true;
    barrier.style.display='flex'; message.textContent=text; buttons.replaceChildren();
    actions.forEach(([label, fn])=>{const b=document.createElement('button');b.textContent=label;b.className='btn';b.style.margin='4px';b.onclick=fn;buttons.appendChild(b);});
  }
  function busy(text){
    el('app-wrapper').inert=true;notice(text);
    // Evita piscar um modal em gravações rápidas, mantendo a proteção do lote.
    if(!busyTimer)busyTimer=setTimeout(()=>{busyTimer=null;block(text);},600);
  }
  function unblock(){clearTimeout(busyTimer);busyTimer=null;barrier.style.display='none';el('app-wrapper').inert=false;}
  function notice(msg){status.textContent=msg;}
  function download(data,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function records(c,v){
    if(single.has(c)) return v == null ? new Map() : new Map([['_',v]]);
    const m=new Map();
    for(const r of v || []){
      if(!r || typeof r!=='object' || Array.isArray(r)) throw Error('Registro inválido em '+c);
      if(r.id == null) r.id=c==='stock_snapshots' && r.mesAno ? r.mesAno : crypto.randomUUID();
      const id=String(r.id);if(m.has(id))throw Error('ID duplicado em '+c+': '+id);m.set(id,r);
    }
    return m;
  }
  function diff(c,b,a){
    const before=records(c,b), after=records(c,a), result=[];
    for(const id of new Set([...before.keys(),...after.keys()])){
      const old=before.get(id)??null, next=after.get(id)??null;
      if(!equal(old,next))result.push({collection:c,id,before:copy(old),after:copy(next)});
    }
    return result;
  }
  // Toda chamada ao banco vai com a sessão do usuário. Sem sessão válida (encerrada,
  // ou o login não respondeu ao renovar o token), o cliente do Supabase mandaria a
  // chamada como ANÔNIMA e o banco responderia 401: aqui ela não sai, e o motivo aparece.
  async function rpc(name,args){
    const {data:{session}}=await client.auth.getSession();
    if(!session){const e=Error(sessionEnded?'Sessão encerrada. Entre novamente.':'Não foi possível confirmar sua sessão agora. Tentando de novo…');e.noSession=true;throw e;}
    const {data,error,status}=await client.rpc(name,args);if(error){error.status=status;throw error;}return data;
  }
  function keyOf(r){return JSON.stringify([r.collection,String(r.id)]);}
  function enqueue(r,deleted=false){
    if(!r||!collections.includes(r.collection)||r.id==null||r.sync_revision==null)return false;
    if(!deleted&&(!r.data||typeof r.data!=='object'))return false;
    let rev;try{rev=BigInt(r.sync_revision);}catch{return false;}
    const key=keyOf(r),previous=incoming.get(key);
    if(rev<=(rowVersions.get(key)||0n)||rev<=(previous?.rev||0n))return true;
    incoming.set(key,{row:copy(r),deleted,rev});return true;
  }
  function receive(packet){
    for(const row of packet.rows||[])if(!enqueue(row))throw Error('Resposta de sincronização inválida');
    for(const row of packet.deleted||[])if(!enqueue(row,true))throw Error('Exclusão sem revisão');
  }
  function applyIncoming(force=false){
    if(!force&&(!started||pending||dirty.size||sending))return;
    const affected=new Set();
    for(const [key,{row:r,deleted,rev}] of incoming){
      if(rev<=(rowVersions.get(key)||0n))continue;
      rowVersions.set(key,rev);affected.add(r.collection);
      if(single.has(r.collection))baseline[r.collection]=deleted?null:copy(r.data);
      else{
        const list=baseline[r.collection]||[],index=list.findIndex(x=>String(x.id)===String(r.id));
        if(deleted){if(index>=0)list.splice(index,1);rowOrder.delete(key);}
        else{if(index<0)list.push(copy(r.data));else list[index]=copy(r.data);rowOrder.set(key,BigInt(r.insertion_order||0));}
        baseline[r.collection]=list;
      }
    }
    incoming.clear();
    for(const c of affected)if(!single.has(c))baseline[c].sort((a,b)=>{
      const x=rowOrder.get(keyOf({collection:c,id:a.id}))||0n,y=rowOrder.get(keyOf({collection:c,id:b.id}))||0n;
      return x<y?-1:x>y?1:0;
    });
    if(affected.size||force){live=copy(baseline);window.ERP_APP?.replace(copy(live));}
  }
  async function refresh(force=false){
    if(refreshing){await refreshing;if(force)applyIncoming(true);return;}
    if(!force&&(pending||dirty.size||sending)){reconcileRequested=true;return;}
    refreshing=(async()=>{
      const packet=await rpc('erp_changes',{since_revision:cursor});
      if(packet.reset_required)throw Error('O banco foi restaurado. Recarregue a página antes de continuar.');
      if(packet.protegido)protegido=true;
      receive(packet);
      // Cursor avança só após TODAS as linhas/exclusões entrarem na fila local.
      cursor=String(packet.cursor);lastReconcile=Date.now();reconcileRequested=false;
      applyIncoming(force);notice('Nuvem sincronizada');
    })();
    try{await refreshing;}catch(e){reconcileRequested=true;notice('Sem sincronização — '+(e.message||e));throw e;}
    finally{refreshing=null;}
  }
  function realtime(payload){
    if(payload.eventType==='DELETE')return; // DELETE de erp_records vem pela lápide.
    const valid=!payload.errors?.length&&enqueue(payload.new,payload.table==='erp_deleted');
    if(!valid)reconcileRequested=true; // Payload truncado: recupera apenas o delta.
    clearTimeout(realtimeTimer);realtimeTimer=setTimeout(()=>{
      applyIncoming();
      if(reconcileRequested&&Date.now()-lastReconcile>5000)refresh().catch(()=>{});
    },50);
  }
  // Servidor protegido: o tempo real só avisa que algo mudou; os dados vêm pela
  // função, já filtrados para esta conta. Um aviso que chega no meio de uma
  // busca gera outra busca logo depois (senão a mudança ficaria para trás).
  function signal(){
    reconcileRequested=true;
    clearTimeout(realtimeTimer);realtimeTimer=setTimeout(async()=>{
      if(refreshing){try{await refreshing;}catch{}}
      refresh().catch(()=>{});
    },120);
  }
  async function showFailure(error){
    sending=false;notice('Alteração ainda não confirmada');
    clearTimeout(busyTimer);busyTimer=null;
    // Falta de sessão ou token recusado não é o servidor recusando a alteração: não oferece descartar.
    const authError=!!error.noSession||error.status===401||/^PGRST30/.test(error.code||'');
    const rejected=!pending.confirmed&&!!error.code&&!authError&& !['','PGRST000','PGRST001','PGRST002','PGRST003'].includes(error.code);
    pending.rejected=rejected;await persist().catch(()=>{});
    const actions=[['Verificar / tentar novamente',()=>send()],['Baixar alteração pendente',()=>download(pending,'144lab-alteracao-pendente.json')]];
    // Sessão encerrada: a alteração já está guardada nesta aba e volta depois de entrar de novo.
    if(error.noSession&&sessionEnded)actions.unshift(['Entrar novamente',()=>location.reload()]);
    if(rejected)actions.push(['Descartar e atualizar',async()=>{try{await refresh(true);await clearPending();dirty.clear();lastToast=null;applyIncoming(true);unblock();}catch(e){showFailure(e);}}]);
    block('A gravação não foi confirmada. '+(error.message||String(error))+' Seus dados pendentes foram preservados nesta aba.',actions);
  }
  // IndexedDB comporta backups com fotos; sessionStorage guarda apenas o ID.
  function recoveryStore(action,id,value){return new Promise((resolve,reject)=>{
    const open=indexedDB.open('144erp-recovery',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('operations');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('operations',action==='get'?'readonly':'readwrite'),store=tx.objectStore('operations');
      const req=action==='put'?store.put(value,id):action==='delete'?store.delete(id):store.get(id);
      let result;req.onsuccess=()=>{result=req.result;};
      tx.oncomplete=()=>{db.close();resolve(result);};
      tx.onabort=()=>{db.close();reject(tx.error||Error('Armazenamento de recuperação indisponível'));};
      tx.onerror=()=>{};
    };
  });}
  async function persist(){await recoveryStore('put',pending.id,pending);sessionStorage.setItem(pendingKey,JSON.stringify({id:pending.id,actor:pending.actor}));}
  async function clearPending(){const id=pending?.id;if(id)await recoveryStore('delete',id);pending=null;sessionStorage.removeItem(pendingKey);}
  async function send(){
    if(!pending||sending)return;
    sending=true;busy('Confirmando gravação na nuvem…');
    try{
      const receipt=await rpc('erp_commit_sync',{operation_id:pending.id,changes:pending.changes,restore:!!pending.restore});
      pending.confirmed=true;
      receive(receipt);applyIncoming(true);
      await clearPending();dirty.clear();sending=false;unblock();
      if(lastToast){window.ERP_APP?.notify(...lastToast);lastToast=null;}
      notice('Salvo na nuvem');
      if(reconcileRequested)refresh().catch(()=>{});
    }catch(e){await showFailure(e);}
  }
  async function flush(){
    timer=null;if(!dirty.size||pending)return;
    try{
      const changes=[...dirty].flatMap(c=>diff(c,baseline[c],live[c]));
      if(!changes.length){dirty.clear();unblock();lastToast=null;return;}
      pending={id:crypto.randomUUID(),actor:Cloud.user.id,changes};await persist();send();
    }catch(e){if(pending){showFailure(e);}else block('Não foi possível preparar a gravação: '+e.message,[['Voltar',()=>{dirty.clear();refresh(true).then(unblock);}]]);}
  }
  const Cloud=window.Cloud={
    user:null,users:[],collections,
    load(k,fb){const c=k.replace(/^knx3d_/,'');return copy(live[c]??fb);},
    save(k,v){
      const c=k.replace(/^knx3d_/,'');if(!collections.includes(c))throw Error('Coleção não migrável: '+c);
      records(c,v);live[c]=copy(v);
      if(!started)return;
      dirty.add(c);busy('Salvando na nuvem…');
      if(!timer)timer=setTimeout(flush,0);
    },
    deferToast(msg,type){if(started&&(dirty.size||pending||sending)&&type!=='warn'){lastToast=[msg,type];return true;}return false;},
    local:{getItem(k){return live.meta?.[k]??null;},setItem(k,v){const meta={...(live.meta||{}),[k]:String(v)};Cloud.save('knx3d_meta',meta);}},
    async logout(){if(pending||dirty.size)return;const {error}=await client.auth.signOut();if(error){notice(error.message);return;}location.reload();},
    async usersAction(body){
      if(Cloud.user.perfil!=='ADMIN')throw Error('Requer ADMIN');
      block('Atualizando usuário…');
      try{
        const {data,error}=await client.functions.invoke('erp-users',{body});
        if(error){let detail='';try{detail=(await error.context.json()).error||'';}catch{}throw Error(detail||error.message);}
        if(data?.error)throw Error(data.error);
        await Cloud.loadUsers();window.ERP_APP?.setUsers(Cloud.users);return data;
      }finally{unblock();}
    },
    async loadUsers(){
      if(protegido){const r=await rpc('erp_usuarios',{});Cloud.users=r.usuarios||[];return;}
      const {data,error}=await client.from('profiles').select('id,nome,login,perfil').order('nome');if(error)throw error;Cloud.users=data;
    },
    // Histórico gravado pelo banco em toda alteração (só ADMIN, só com a proteção).
    async historico(antes){if(!protegido)return null;return rpc('erp_historico',{limite:200,antes_de:antes??null});},
    // Com senha, o arquivo sai cifrado (AES-256-GCM, chave derivada da senha com
    // PBKDF2-SHA256): sem a senha ninguém lê os dados, nem quem achar o arquivo.
    async exportBackup(senha){
      const dados={...copy(window.ERP_APP.values()),meta:copy(live.meta||{}),formato:'144lab-completo-v1',exportado:new Date().toISOString()};
      const dia=new Date().toISOString().slice(0,10);
      if(!senha){download(dados,'144lab-backup-completo-'+dia+'.json');return;}
      download(await cifrar(dados,senha),'144lab-backup-protegido-'+dia+'.json');
    },
    async importBackup(file,pedirSenha){
      if(Cloud.user.perfil!=='ADMIN')throw Error('Importação requer ADMIN');
      let data=JSON.parse(await file.text());
      if(data&&data.formato===CIFRADO){
        const senha=pedirSenha?await pedirSenha():null;if(!senha)throw Error('Backup protegido: informe a senha');
        data=await decifrar(data,senha);
      }
      const values=validateBackup(data);
      block('Preparando importação completa…');
      try{
        await refresh(true);const before=copy(baseline);
        const changes=collections.flatMap(c=>diff(c,before[c],values[c]));
        if(!changes.length){unblock();notice('Este backup já está no banco');return;}
        pending={id:crypto.randomUUID(),actor:Cloud.user.id,changes,restore:true};await persist();lastToast=['Backup importado e confirmado na nuvem','ok'];await send();
      }catch(e){if(pending)await showFailure(e);else unblock();throw e;}
    },
    // Exposto para a validação automatizada do adaptador e dos backups.
    _test:{diff,validateBackup,realtime,signal,refresh,applyIncoming,cifrar,decifrar,protegido:()=>protegido,
      state:()=>({cursor,pending:!!pending,sending,dirty:dirty.size,queued:incoming.size,refreshing:!!refreshing})}
  };
  const CIFRADO='144lab-cifrado-v1', ITERACOES=600000;
  const b64=u=>{let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s);};
  const deB64=t=>Uint8Array.from(atob(t),c=>c.charCodeAt(0));
  async function chaveDe(senha,sal,iter){
    const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(senha),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:sal,iterations:iter},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function cifrar(obj,senha){
    if(String(senha).length<8)throw Error('A senha do backup precisa de pelo menos 8 caracteres');
    const sal=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const dados=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await chaveDe(senha,sal,ITERACOES),new TextEncoder().encode(JSON.stringify(obj))));
    return {formato:CIFRADO,cifra:'AES-256-GCM',kdf:'PBKDF2-SHA256',iteracoes:ITERACOES,sal:b64(sal),iv:b64(iv),dados:b64(dados),exportado:new Date().toISOString()};
  }
  async function decifrar(pacote,senha){
    const iter=Number(pacote.iteracoes);
    if(pacote.formato!==CIFRADO||!(iter>=100000&&iter<=10000000))throw Error('Backup protegido inválido');
    try{
      const txt=await crypto.subtle.decrypt({name:'AES-GCM',iv:deB64(pacote.iv)},await chaveDe(senha,deB64(pacote.sal),iter),deB64(pacote.dados));
      return JSON.parse(new TextDecoder().decode(txt));
    }catch{throw Error('Senha errada (ou arquivo corrompido)');}
  }
  function validateBackup(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Backup inválido');
    const aliases={crm_logs:'crmLogs',stock_snapshots:'stockSnapshots',prod_log:'prodLog',consig_history:'consigHistory',est_cfg:'estCfg'};
    const values={};
    for(const c of collections){
      let v=input[c]??input['knx3d_'+c]??input[aliases[c]];
      if(c==='meta')v=v||{};
      if(v==null)throw Error('Backup incompleto: falta '+c+'. Use o exportador completo no computador de casa.');
      if(single.has(c) ? (typeof v!=='object'||Array.isArray(v)) : !Array.isArray(v))throw Error('Formato inválido em '+c);
      values[c]=copy(v);records(c,values[c]);
    }
    const num=v=>{let s=String(v??'').replace(/\s/g,'').replace(/[^\d.,-]/g,'');if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');return parseFloat(s)||0;};
    for(const p of values.products){
      for(const k of ['custo','preco','gramas','estoque'])p[k]=num(p[k]);
      if(!p.locais||typeof p.locais!=='object'||Array.isArray(p.locais)){const dest=p.local==='ML Full'?'ml':['Shopee','Shopee Full'].includes(p.local)?'shopee':'oficina';p.locais={oficina:0,ml:0,shopee:0};p.locais[dest]=p.estoque;}
      for(const loc of ['oficina','ml','shopee']){p.locais[loc]=num(p.locais[loc]);if(p.locais[loc]<0)throw Error('Estoque negativo no backup: '+p.nome);}
      p.estoque=p.locais.oficina+p.locais.ml+p.locais.shopee;
    }
    for(const s of values.sales){s.precoUnit=num(s.precoUnit);s.custoUnit=num(s.custoUnit);s.qtd=num(s.qtd)||1;}
    for(const e of values.expenses)e.valor=num(e.valor);
    values.meta.knx3d_mig_seed='1';
    // Senhas e usuários legados nunca entram no payload da nuvem.
    return values;
  }
  // Sincronização em segundo plano: um timer, três ouvintes e o canal do tempo real.
  // Liga uma vez depois do login e desliga quando a sessão acaba (sem sessão, tudo
  // isso só geraria chamadas recusadas e reconexões inúteis).
  let syncTimer=null, channel=null, sessionEnded=false, realtimeGen=0;
  const resume=()=>{if(reconcileRequested||Date.now()-lastReconcile>=RECONCILE_MS)refresh().catch(()=>{});};
  const onVisible=()=>{if(document.visibilityState==='visible')resume();};
  const onOnline=()=>{reconcileRequested=true;refresh().catch(()=>{});};
  async function subscribeRealtime(){
    const gen=++realtimeGen;
    // O token do usuário precisa estar no Realtime ANTES de entrar no canal: a biblioteca
    // monta o pedido de entrada antes de o token chegar e, sem isto, o canal entra como
    // anônimo e (com RLS) não recebe nenhuma mudança.
    await client.realtime.setAuth().catch(()=>{});
    if(gen!==realtimeGen)return; // saiu da página ou a sessão acabou enquanto esperava
    channel=client.channel('144erp');
    if(protegido)channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'erp_sinal'},signal);
    else channel
      .on('postgres_changes',{event:'*',schema:'public',table:'erp_records'},realtime)
      .on('postgres_changes',{event:'*',schema:'public',table:'erp_deleted'},realtime);
    channel.subscribe(state=>{
      if(state==='SUBSCRIBED'){
        // Fecha a janela entre o bootstrap e a inscrição, e recupera reconexões.
        reconcileRequested=true;refresh().catch(()=>{});notice('Nuvem conectada');
      }else if(state==='CHANNEL_ERROR'||state==='TIMED_OUT')notice('Reconectando sincronização…');
    });
  }
  // Sair da página com o WebSocket aberto impede o BFCache (a página recarrega ao
  // voltar) ou faz o navegador derrubar a conexão ("Page entered Back-Forward Cache").
  // Fecha canal e socket ao sair; ao voltar do cache, reabre uma vez e sincroniza.
  function unsubscribeRealtime(){
    realtimeGen++;
    if(channel){const c=channel;channel=null;client.removeChannel(c).catch(()=>{});}
    client.realtime.disconnect();
  }
  const onPageHide=()=>unsubscribeRealtime();
  const onPageShow=e=>{if(e.persisted){reconcileRequested=true;subscribeRealtime();}};
  function startSync(){
    subscribeRealtime();
    syncTimer=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});},RECONCILE_MS);
    window.addEventListener('focus',resume);
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('online',onOnline);
    window.addEventListener('pagehide',onPageHide);
    window.addEventListener('pageshow',onPageShow);
  }
  function stopSync(){
    clearInterval(syncTimer);syncTimer=null;
    window.removeEventListener('focus',resume);
    document.removeEventListener('visibilitychange',onVisible);
    window.removeEventListener('online',onOnline);
    window.removeEventListener('pagehide',onPageHide);
    window.removeEventListener('pageshow',onPageShow);
    unsubscribeRealtime();
  }
  async function start(){
    if(started||startup)return;startup=true;el('btn_login').disabled=true;
    try{
      const {data:{user},error}=await client.auth.getUser();if(error||!user)throw error||Error('Entre com sua conta');
      // A 1ª sincronização diz se o servidor tem a proteção por perfil (marca
      // "protegido" na resposta). Com ela, "quem sou eu" e a lista de usuários vêm
      // de uma função (o vendedor só recebe o próprio perfil); sem ela, jeito antigo.
      for(const c of collections)baseline[c]=single.has(c)?null:[];
      await refresh(true);live=copy(baseline);
      Cloud.protegido=protegido;
      if(protegido){
        const sessao=await rpc('erp_usuarios',{});
        if(!sessao||!sessao.eu||sessao.eu.id!==user.id)throw Error('Perfil da conta não confere');
        Cloud.user=sessao.eu;Cloud.users=sessao.usuarios||[sessao.eu];
      }else{
        const {data:profile,error:profileError}=await client.from('profiles').select('id,nome,login,perfil').eq('id',user.id).single();
        if(profileError)throw profileError;Cloud.user=profile;
        await Cloud.loadUsers();
      }
      const marker=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
      const recovered=marker?await recoveryStore('get',marker.id):null;
      if(marker&&!recovered)sessionStorage.removeItem(pendingKey);
      if(recovered&&recovered.actor!==user.id)throw Error('Há uma alteração pendente de outra conta nesta aba. Entre com a conta que iniciou a operação.');
      const script=document.createElement('script');script.src='app.js';
      await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(Error('Não foi possível carregar app.js'));document.body.appendChild(script);});
      if(!window.ERP_APP)throw Error('O ERP não concluiu a inicialização');
      started=true;
      el('login_pass').value='';el('login-screen').classList.remove('active');el('login-screen').style.display='none';el('app-wrapper').style.display='block';
      if(recovered){pending=recovered;block('Existe uma gravação pendente desta aba. Verifique antes de continuar.',[['Verificar gravação',()=>send()],['Baixar alteração pendente',()=>download(pending,'144lab-alteracao-pendente.json')]]);}
      else window.ERP_APP.afterLogin();
      startSync();
      client.auth.onAuthStateChange(event=>{
        if(event==='SIGNED_OUT'){sessionEnded=true;stopSync();el('app-wrapper').style.display='none';block('Sessão encerrada. Entre novamente.',[['Entrar',()=>location.reload()]]);}
        // Token renovado depois de uma falha: recupera o que ficou para trás (fora do
        // callback, que o Supabase chama segurando a trava da sessão).
        else if(event==='TOKEN_REFRESHED'&&reconcileRequested)setTimeout(()=>refresh().catch(()=>{}),0);
      });
      notice('Nuvem conectada');
    }catch(e){notice(e.message||String(e));el('login_pass').value='';}
    finally{startup=false;el('btn_login').disabled=!!captcha&&!captcha.token;}
  }
  window.addEventListener('beforeunload',e=>{if(pending||dirty.size){e.preventDefault();e.returnValue='';}});
  window.addEventListener('offline',()=>notice('Sem internet — gravações exigem conexão'));
  const config=window.ERP_CONFIG||{};
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url||'')||!config.publicKey){
    notice('Configuração pendente');el('btn_login').disabled=true;
    const p=document.createElement('p');p.textContent='Preencha a URL e a chave pública do Supabase em config.js para iniciar.';p.style.cssText='font:14px system-ui;color:#9a3412';el('btn_login').after(p);return;
  }
  if(!window.supabase){notice('Biblioteca Supabase indisponível');return;}
  client=window.supabase.createClient(config.url,config.publicKey);
  el('login_user').type='email';el('login_user').placeholder='Seu e-mail';
  // CAPTCHA anti-robô no login (Cloudflare Turnstile), só se config.js tiver a
  // chave do SITE (pública) em "turnstile". O Supabase confere o token com a
  // chave secreta, que fica no painel dele (Authentication > Attack Protection).
  let captcha=null;
  if(typeof config.turnstile==='string'&&/^[0-9A-Za-z_-]{10,}$/.test(config.turnstile)){
    captcha={token:null,id:null};
    const caixa=document.createElement('div');caixa.id='login_captcha';caixa.style.cssText='margin:10px 0;min-height:65px;display:flex;justify-content:center';
    el('btn_login').before(caixa);el('btn_login').disabled=true;
    window.aoCarregarTurnstile=()=>{
      captcha.id=window.turnstile.render(caixa,{sitekey:config.turnstile,action:'login',language:'pt-br',
        callback:t=>{captcha.token=t;el('btn_login').disabled=false;},
        'expired-callback':()=>{captcha.token=null;el('btn_login').disabled=true;},
        'error-callback':()=>{captcha.token=null;el('btn_login').disabled=true;notice('A verificação anti-robô falhou. Recarregue a página.');}});
    };
    const sc=document.createElement('script');sc.async=true;
    sc.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=aoCarregarTurnstile';
    sc.onerror=()=>notice('Não carregou a verificação anti-robô (internet ou bloqueador?). Recarregue a página.');
    document.head.appendChild(sc);
  }
  const loginLiberado=()=>!captcha||!!captcha.token;
  el('btn_login').onclick=async()=>{
    if(!loginLiberado()){notice('Confirme a verificação anti-robô');return;}
    el('btn_login').disabled=true;notice('Entrando…');
    try{
      const {error}=await client.auth.signInWithPassword({email:el('login_user').value.trim(),password:el('login_pass').value,...(captcha?{options:{captchaToken:captcha.token}}:{})});
      if(error)throw error;await start();
    }catch(e){notice(e.message||String(e));}
    finally{
      // o token do CAPTCHA vale uma vez: depois de cada tentativa, pede outro
      if(captcha&&captcha.token){captcha.token=null;try{window.turnstile.reset(captcha.id);}catch{}}
      el('btn_login').disabled=!loginLiberado();
    }
  };
  el('login_pass').addEventListener('keydown',e=>{if(e.key==='Enter')el('btn_login').click();});
  client.auth.getSession().then(({data:{session}})=>{if(session)start();else notice('Entre para acessar a nuvem');});
})();
