'use strict';
(function(){
  const TABLE='cornetto_workspace_v1', OUTBOX='cloud-outbox-v1';
  let client,user=null,localSync=null,mode='local',message='Tersimpan di perangkat ini',busy=false,timer,remoteChoice=null,booted=false,sessionVersion=0;
  const dialog=document.createElement('dialog');dialog.id='cloudDialog';dialog.setAttribute('aria-label','Akun dan sinkronisasi cloud');document.body.append(dialog);
  const hasData=d=>!!d&&(d.inventory.length+d.sales.length+d.expenses.length+d.ledger.length+d.cards.length>0);
  const locked=()=>!!localSync?.ownerId&&user?.id!==localSync.ownerId;
  function status(next,text){mode=next;message=text;updateStorageBadge();document.querySelectorAll('[id="cloudInlineStatus"]').forEach(node=>{node.textContent=text;});}
  window.cornettoCloudStatus=()=>({message,summary:mode==='synced'?'Cloud tersinkron':mode==='saving'?'Menyimpan ke cloud':mode==='conflict'?'Konflik / salinan lokal aman':localSync?.ownerId?'Cloud / '+message:'Cloud belum diaktifkan',label:mode==='synced'?'CLOUD':mode==='saving'?'SINKRON':localSync?.ownerId?'PERIKSA':'LOKAL'});
  function refresh(){document.body.classList.toggle('cloud-locked',locked());updateStorageBadge();}
  function close(){if(!locked())dialog.close();}
  dialog.addEventListener('cancel',e=>{if(locked())e.preventDefault();});
  function showAccount(){
    const signed=!!user;
    dialog.innerHTML=`<div class="cloud-head"><h2>${signed?'Akun cloud':'Masuk ke cloud'}</h2>${!locked()?'<button type="button" class="icon-button" data-cloud="close" title="Tutup" aria-label="Tutup akun cloud">'+icon('x')+'</button>':''}</div><p id="cloudInlineStatus" role="status">${esc(message)}</p>`+(signed?`<p>${esc(user.email||'Akun terhubung')}</p>${locked()?'<p>Akun ini berbeda dari pemilik data lokal. Keluar lalu masuk dengan akun pemilik.</p>':''}<div class="backup-actions"><button class="button" data-cloud="check">${icon('refresh-cw')}Periksa sinkron</button>${!localSync?.ownerId?`<button class="button primary" data-cloud="activate">${icon('cloud-upload')}Aktifkan cloud</button>`:''}${mode==='conflict'||remoteChoice?`<button class="button" data-cloud="use-remote">${icon('cloud-download')}Gunakan data cloud</button><button class="button" data-cloud="export-local">${icon('download')}Backup lokal</button>`:''}<button class="button" data-cloud="logout">${icon('log-out')}Keluar</button></div>`:`<form id="cloudLoginForm">${field('Email akun website lama','email','email','','required autocomplete="username"')}${field('Password akun website lama','password','password','','required autocomplete="current-password"')}<p id="cloudLoginError" class="form-error" role="alert"></p><button class="button primary" type="submit">${icon('log-in')}Masuk</button></form><p class="form-hint">Gunakan akun login tracker, bukan password dashboard Supabase.</p>`);
    if(!dialog.open)dialog.showModal();refreshIcons();
  }
  const originalDataView=moduleViews.data;
  moduleViews.data=function(){return `<section class="cloud-panel"><div class="section-heading"><div><h2>Sinkronisasi cloud</h2><p id="cloudInlineStatus">${esc(message)}</p></div><button class="button primary" data-cloud="account">${icon('cloud')}${user?'Akun cloud':'Masuk ke cloud'}</button></div></section>`+originalDataView().replace('<strong>Penyimpanan lokal</strong><p>Cloud belum tersambung. Data di perangkat ini belum tersedia di perangkat lain.</p>',localSync?.ownerId?'<strong>Salinan perangkat + cloud</strong><p>Status sinkron ditampilkan di atas. Perubahan yang belum terkirim tetap disimpan lokal.</p>':'<strong>Penyimpanan lokal</strong><p>Masuk dan aktifkan cloud untuk menyimpan data di akun toko.</p>');};
  function transaction(task){return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace');let value;tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(tx.error||Error('Transaksi penyimpanan lokal gagal.'));try{task(store,tx,v=>{value=v;});}catch(e){tx.abort();reject(e);}});}
  async function stageJob(){return transaction((store,tx,done)=>{
    const read=store.get('current');read.onsuccess=()=>{const current=read.result;if(!current?.sync||current.sync.ownerId!==user?.id)return done(null);const queued=store.get(OUTBOX);queued.onsuccess=()=>{if(queued.result){if(queued.result.ownerId!==user.id){tx.abort();return;}return done(queued.result);}if(!current.sync.dirty)return done(null);const job={ownerId:user.id,expected:current.sync.baseRevision,operation:crypto.randomUUID(),localRevision:current.revision,data:current.data};store.put(job,OUTBOX);done(job);};};
  });}
  async function acknowledge(job,result){return transaction((store,tx,done)=>{
    const q=store.get(OUTBOX);q.onsuccess=()=>{if(q.result?.operation!==job.operation)return done(false);const r=store.get('current');r.onsuccess=()=>{const current=r.result;if(current?.sync?.ownerId!==job.ownerId){tx.abort();return;}current.sync={...current.sync,baseRevision:result.revision,dirty:current.revision!==job.localRevision,lastSynced:result.updated_at};store.put(current,'current');store.delete(OUTBOX);done(current.sync);};};
  });}
  async function getRemote(metadata=false){
    const response=await client.from(TABLE).select(metadata?'revision,updated_at':'revision,data,updated_at').eq('user_id',user.id).maybeSingle();
    if(response.error)throw response.error;return response.data;
  }
  async function acceptRemote(remote,explicit=false){
    validateSnapshot(remote.data);await saveQueue;if(storageFailed)throw Error('Penyimpanan lokal bermasalah. Unduh backup sebelum melanjutkan.');
    const current=await readStored('current');if((current?.revision||0)!==revision)throw Error('Data berubah di tab lain. Muat ulang sebelum melanjutkan.');
    if(current?.sync?.baseRevision>remote.revision)throw Error('Versi cloud berubah. Periksa sinkron kembali.');
    if(!explicit&&(savePending||current?.sync?.dirty||el('drawer').open))return;
    if(explicit&&current?.data)downloadData('cornetto-sebelum-cloud_'+TODAY+'.json',JSON.stringify(current.data),'application/json');
    const newSync={ownerId:user.id,baseRevision:remote.revision,dirty:false,lastSynced:remote.updated_at},expectedRevision=revision,wasInert=document.body.inert;
    // Explicit replacement also discards an obsolete queue, retaining the local recovery copy.
    document.body.inert=true;
    try{
      await transaction((store,tx,done)=>{const r=store.get('current');r.onsuccess=()=>{if((r.result?.revision||0)!==expectedRevision||r.result?.sync?.baseRevision!==current?.sync?.baseRevision||savePending||storageFailed||(!explicit&&r.result?.sync?.dirty)){tx.abort();return;}if(r.result)store.put(r.result,'before-import');store.put({revision:expectedRevision+1,data:remote.data,sync:newSync},'current');store.delete(OUTBOX);done(true);};});
      revision=expectedRevision+1;applyState(remote.data);localSync=newSync;remoteChoice=null;status('synced','Tersimpan di cloud');refresh();render();
    }finally{document.body.inert=wasInert;}
  }
  async function flushUnlocked(){
    if(busy||!user||locked()||mode==='conflict'||storageFailed)return;busy=true;
    try{
      await saveQueue;
      for(let i=0;i<4;i++){
        const job=await stageJob();if(!job)break;if(job.ownerId!==user?.id)break;
        status('saving','Mengirim perubahan ke cloud...');
        const response=await client.rpc('cornetto_save_workspace_v1',{p_expected_revision:job.expected,p_operation:job.operation,p_data:job.data});
        if(response.error)throw response.error;
        if(!Number.isSafeInteger(response.data?.revision)||response.data.revision<1)throw Error('Jawaban cloud tidak valid.');
        const ack=await acknowledge(job,response.data);if(ack)localSync=ack;
      }
      const stored=await readStored('current');localSync=stored?.sync||null;
      if(localSync?.dirty)status('pending','Tersimpan lokal, menunggu sinkron');else if(localSync?.ownerId)status('synced','Tersimpan di cloud'+(localSync.lastSynced?' / '+new Date(localSync.lastSynced).toLocaleTimeString('id-ID'):''));
    }catch(err){if(err.code==='40001'||String(err.message).includes('CLOUD_CONFLICT')||String(err.message).includes('UPGRADE_REQUIRED')){status('conflict','Ada perubahan dari perangkat lain. Data lokal tidak ditimpa.');showAccount();}else status('pending','Belum tersinkron. Data lokal aman; coba Periksa sinkron.');}
    finally{busy=false;refresh();}
  }
  async function flush(){
    if(navigator.locks)return navigator.locks.request('cornetto-cloud-write-v1',{ifAvailable:true},lock=>lock?flushUnlocked():undefined);
    return flushUnlocked();
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{flush().catch(()=>status('pending','Sinkron tertunda; data tetap lokal.'));},700);}
  async function check(){
    if(!user||busy||locked())return;
    await saveQueue;const current=await readStored('current');localSync=current?.sync||null;
    if(localSync?.ownerId!==user.id){await connect();return;}
    if(current.revision!==revision){if(savePending||storageFailed||el('drawer').open)return;validateSnapshot(current.data);revision=current.revision;applyState(current.data);render();}
    if(mode==='conflict')return;
    if(current.sync.dirty||await readStored(OUTBOX)){await flush();return;}
    try{const remote=await getRemote(true);if(!remote){status('conflict','Data cloud akun ini tidak ditemukan. Salinan lokal dipertahankan.');return;}if(remote.revision!==current.sync.baseRevision){if(el('drawer').open)return;await acceptRemote(await getRemote());}else status('synced','Tersimpan di cloud / '+new Date(remote.updated_at).toLocaleTimeString('id-ID'));}
    catch{status('pending','Cloud belum terjangkau; salinan lokal tetap tersedia.');}
  }
  async function connect(){
    const version=sessionVersion;
    const stored=await readStored('current');localSync=stored?.sync||null;refresh();
    if(!user){status('local',localSync?.ownerId?'Masuk untuk membuka workspace cloud':'Tersimpan lokal / belum masuk cloud');if(locked())showAccount();return;}
    if(locked()){status('account','Akun berbeda dari pemilik data di perangkat ini.');showAccount();return;}
    try{
      status('loading','Memeriksa data cloud...');const remote=await getRemote();if(version!==sessionVersion)return;
      if(localSync?.ownerId){
        if(stored.sync.dirty||await readStored(OUTBOX)){status('pending','Memeriksa antrean lokal');await flush();}
        else if(remote?.revision===stored.sync.baseRevision)status('synced','Tersimpan di cloud');
        else if(remote)await acceptRemote(remote);
        else status('conflict','Data cloud belum ditemukan. Salinan lokal dipertahankan.');
      }else if(remote){
        if(!hasData(stored?.data)){await acceptRemote(remote);close();}
        else{remoteChoice=remote;status('choose','Akun ini sudah memiliki data cloud. Pilih Gunakan data cloud; salinan lokal akan dicadangkan.');showAccount();}
      }else{status('ready','Cloud akun ini masih kosong. Aktifkan untuk mengunggah data perangkat ini.');showAccount();}
    }catch(err){status('pending','Koneksi cloud belum berhasil. Periksa koneksi lalu coba lagi.');}
    refresh();
  }
  async function activate(){
    if(!user||locked())return;
    const remote=await getRemote();if(remote){remoteChoice=remote;status('choose','Data cloud sudah ada. Gunakan data cloud agar tidak tertimpa.');showAccount();return;}
    await saveQueue;if(storageFailed)throw Error('Penyimpanan lokal belum berhasil.');
    const newSync={ownerId:user.id,baseRevision:0,dirty:true,lastSynced:null};
    await persist(snapshot(),true,newSync);localSync=newSync;status('pending','Data lokal siap dikirim ke cloud');refresh();await flush();if(mode==='synced'){close();render();}else showAccount();
  }
  document.addEventListener('click',async e=>{
    const a=e.target.closest('[data-cloud]');if(!a)return;
    try{
      const action=a.dataset.cloud;
      if(action==='account')showAccount();
      if(action==='close')close();
      if(action==='check'){a.disabled=true;await check();showAccount();}
      if(action==='activate'){a.disabled=true;await activate();}
      if(action==='use-remote'){
        a.disabled=true;if(!user||locked())return;const remote=await getRemote();if(!remote)throw Error('Data cloud tidak ditemukan.');await acceptRemote(remote,true);close();
      }
      if(action==='export-local')downloadData('cornetto-salinan-lokal_'+TODAY+'.json',JSON.stringify(snapshot()),'application/json');
      if(action==='logout'){
        await saveQueue;const current=await readStored('current');
        if(savePending||busy||current?.sync?.dirty||await readStored(OUTBOX))throw Error('Masih ada perubahan belum tersinkron. Periksa sinkron sebelum keluar.');
        const result=await client.auth.signOut({scope:'local'});if(result.error)throw result.error;
        user=null;sessionVersion++;refresh();status('local','Keluar dari cloud. Masuk untuk membuka data.');showAccount();
      }
    }catch(err){toast(err.message||'Proses cloud belum berhasil.');}finally{if(a.isConnected)a.disabled=false;}
  });
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='cloudLoginForm')return;e.preventDefault();const f=e.target,b=f.querySelector('button[type=submit]');b.disabled=true;
    try{const result=await client.auth.signInWithPassword({email:f.elements.email.value.trim(),password:f.elements.password.value});f.elements.password.value='';if(result.error)throw result.error;user=result.data.user;sessionVersion++;await connect();if(mode==='synced'){close();render();}}
    catch{const error=document.getElementById('cloudLoginError');if(error)error.textContent='Login gagal. Periksa email/password akun tracker dan koneksi internet.';}
    finally{if(b.isConnected)b.disabled=false;}
  });
  window.addEventListener('cornetto:saved',()=>{if(booted)schedule();});
  window.addEventListener('online',()=>{if(booted)check().catch(()=>{});});
  window.addEventListener('focus',()=>{if(booted)check().catch(()=>{});});
  window.addEventListener('beforeunload',e=>{if(localSync?.dirty||busy){e.preventDefault();e.returnValue='';}});
  async function start(){
    if(booted||!db||storageFailed)return;booted=true;
    const config=window.CORNETTO_CLOUD;
    client=window.supabase.createClient(config.url,config.publishableKey,{auth:{storageKey:'cornetto-workspace-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:options?.signal||AbortSignal.timeout(25000)})}});
    client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){setTimeout(()=>{user=null;sessionVersion++;refresh();status('local','Sesi berakhir. Masuk kembali.');if(locked())showAccount();},0);}else if(event==='TOKEN_REFRESHED')user=session?.user||null;});
    const {data,error}=await client.auth.getSession();user=error?null:data.session?.user||null;await connect();
    setInterval(()=>{if(!document.hidden)check().catch(()=>{});},30000);
  }
  if(window.cornettoReady)start().catch(()=>status('pending','Cloud belum dapat dimuat.'));else window.addEventListener('cornetto:ready',()=>start().catch(()=>status('pending','Cloud belum dapat dimuat.')),{once:true});
})();

