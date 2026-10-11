'use strict';
let ledger=[],migration=null,legacyArchive=null,pendingImport=null,db=null,revision=0;
let saveQueue=Promise.resolve(),storageFailed=false,savePending=0;
const stateKeys=['inventory','sales','expenses','ledger','channels','suppliers','cards','cardCharges','cardPayments','taxPayments','business','taxProfile','taxAdjustments','inputVat','migration','legacyArchive'];
function emptyWorkspace(){
  inventory=[];sales=[];expenses=[];channels=[{id:'channel-default',name:'Toko',fee:0,color:'#187457',active:true}];suppliers=[];cards=[];cardCharges=[];cardPayments=[];taxPayments=[];ledger=[];cardGroups=[];
  business={name:'Cornetto Shop',owner:'Pemilik',categories:['Handphone','Elektronik'],conditions:['Baru','Bekas'],warranties:['Resmi','Distributor','Tanpa garansi']};
  taxProfile={type:'person',eligible:false,pkp:false,inclusive:true,rate:0.5,verified:false};taxAdjustments={};inputVat={};syncFees();
}
function snapshot(){return {app:'cornetto-workspace',version:4,exportedAt:new Date().toISOString(),inventory,sales,expenses,ledger,channels,suppliers,cards,cardCharges,cardPayments,taxPayments,business,taxProfile,taxAdjustments,inputVat,migration,legacyArchive,cardGroups};}
function applyState(d){({inventory,sales,expenses,ledger,channels,suppliers,cards,cardCharges,cardPayments,taxPayments,business,taxProfile,taxAdjustments,inputVat,migration,legacyArchive}=d);cardGroups=d.cardGroups||[];inventory.forEach(p=>{if(p.date)p.age=Math.max(0,Math.floor((Date.parse(TODAY+'T12:00:00Z')-Date.parse(p.date+'T12:00:00Z'))/86400000));});syncFees();}
function openDatabase(){return new Promise((resolve,reject)=>{const r=indexedDB.open('cornetto-workspace-private-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Tutup tab workspace lainnya lalu muat ulang.'));});}
function readStored(key){return new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function persist(d,recovery=false,syncOverride){return new Promise((resolve,reject)=>{
  d={...d,version:4,cardGroups:d.cardGroups||[]};
  const expectedRevision=revision,tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace'),r=store.get('current');let next;
  r.onsuccess=()=>{const prev=r.result;if((prev?.revision||0)!==expectedRevision){tx.abort();return;}next=expectedRevision+1;if(recovery&&prev)store.put(prev,'before-import');const sync=syncOverride!==undefined?syncOverride:prev?.sync?{...prev.sync,dirty:true}:null;store.put({revision:next,data:d,sync},'current');};
  tx.oncomplete=()=>{revision=next;window.dispatchEvent(new Event('cornetto:saved'));resolve();};tx.onerror=()=>reject(tx.error||Error('Penyimpanan gagal.'));tx.onabort=()=>reject(Error('Data berubah di tab lain atau penyimpanan gagal. Unduh backup lalu muat ulang.'));
});}
function saveDemo(){
  const data=structuredClone(snapshot());savePending++;updateStorageBadge();
  saveQueue=saveQueue.then(()=>persist(data)).then(()=>{storageFailed=false;}).catch(err=>{storageFailed=true;toast(err.message);}).finally(()=>{savePending--;updateStorageBadge();});
  return saveQueue;
}
function restoreDemo(){}
function updateStorageBadge(){
  if(!el('saveStatus'))return;
  el('saveStatus').textContent=storageFailed?'GAGAL DISIMPAN - unduh backup sebelum menutup':savePending?'Menyimpan...':'Tersimpan di perangkat ini';
  el('saveStatus').classList.toggle('red-text',storageFailed);
  
  const cloud=window.cornettoCloudStatus?.();
  if(cloud){if(!storageFailed&&!savePending)el('saveStatus').textContent=cloud.message;el('cloudBadge').textContent=cloud.label;el('cloudSummary').textContent=cloud.summary;}
}
const periodOptions=[['today','Hari ini'],['yesterday','Kemarin'],['week','7 hari terakhir'],['30days','30 hari terakhir'],['month','Bulan ini'],['lastMonth','Bulan lalu'],['year','Tahun ini'],['all','Semua tanggal']];
function periodRange(key=period,today=TODAY){
  const d=new Date(today+'T12:00:00Z'),iso=()=>d.toISOString().slice(0,10);
  let start=today,end=today;
  if(key==='all')start='0001-01-01';
  else if(key==='yesterday'){d.setUTCDate(d.getUTCDate()-1);start=end=iso();}
  else if(key==='week'||key==='30days'){d.setUTCDate(d.getUTCDate()-(key==='week'?6:29));start=iso();}
  else if(key==='month')start=today.slice(0,7)+'-01';
  else if(key==='lastMonth'){d.setUTCDate(0);end=iso();start=end.slice(0,7)+'-01';}
  else if(key==='year')start=today.slice(0,4)+'-01-01';
  return {start,end};
}
function periodStart(){return periodRange().start;}
function periodEnd(){return periodRange().end;}
function periodLabel(){return period==='all'?'Seluruh riwayat':(periodOptions.find(([key])=>key===period)?.[1]||'')+' / '+date(periodStart())+(periodStart()===periodEnd()?'':' - '+date(periodEnd()));}
function reportYears(){return [...new Set([Number(TODAY.slice(0,4)),...sales.map(s=>Number(s.date.slice(0,4)))])].sort((a,b)=>b-a);}
const formatDate=date;
// Unknown imported dates and settlement statuses are deliberately not inferred.
statusHtml=function(status){return `<span class="badge ${status==='paid'?'':status==='pending'?'pending':'neutral'}">${status==='paid'?'Lunas':status==='pending'?'Belum cair':'Belum diketahui'}</span>`;};
const baseCardName=cardName;
cardName=function(id){return id==='unknown'?'Belum diketahui':baseCardName(id);};
const baseCreditTile=creditTile;
creditTile=function(c){return baseCreditTile(c).replace('Invalid Date','Belum diisi');};
function dataView(){const warnings=migration?.warnings||[];return `<section><div class="section-heading"><div><h2>Backup & impor</h2><p>${inventory.length} barang / ${sales.length} penjualan / ${cards.length} kartu kredit</p></div><button class="button" data-work="backup">${icon('download')}Backup lengkap</button></div><div class="storage-notice"><strong>Penyimpanan lokal</strong><p>Cloud belum tersambung. Data di perangkat ini belum tersedia di perangkat lain.</p></div><label class="form-field import-field"><span>File backup (.json)</span><input id="backupFile" type="file" accept=".json,application/json"></label><div id="importPreview" role="status"></div>${migration?`<div class="section-heading"><h2>Hasil impor</h2><span>${new Date(migration.importedAt).toLocaleString('id-ID')}</span></div><div class="book-grid"><section>${bookLine('Total omzet historis',sum(sales,revenue))}${bookLine('Nilai stok positif',sum(inventory,p=>Math.max(0,p.qty)*p.cost))}${bookLine('Beban tercatat',sum(expenses,e=>e.amount))}</section><section><p>${ledger.length} catatan modal/pinjaman</p><p>${cardPayments.length} pembayaran kartu</p><p>${[...inventory,...sales].filter(r=>r.invoice).length} lampiran invoice</p></section></div><h3 class="drawer-section-title">Perlu pemeriksaan</h3><ul class="migration-warnings">${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}<div class="backup-actions"><button class="button" data-work="recovery">${icon('download')}Backup sebelum impor</button>${legacyArchive?`<button class="button" data-work="legacy">${icon('download')}Arsip backup asli</button>`:''}</div></section>`;}
moduleViews.data=dataView;
const baseBusinessSettings=businessSettings;
businessSettings=function(){return baseBusinessSettings().replace('data-action="demo-backup"','data-work="backup"');};
const baseRender=render;
render=function(){baseRender();if(['dashboard','sales','books'].includes(view)&&sales.some(s=>s.status==='unknown'))el('main').insertAdjacentHTML('afterbegin',`<div class="storage-notice"><strong>${sales.filter(s=>s.status==='unknown').length} status pencairan belum diketahui</strong><p>Angka dana diterima dan belum cair belum mencakup transaksi tersebut.</p></div>`);if(view==='stock'&&inventory.some(p=>p.qty<0))el('main').insertAdjacentHTML('afterbegin','<div class="storage-notice red-text">Ada stok minus dari backup lama. Jumlah minus tetap ditampilkan; nilai persediaan hanya menghitung stok positif.</div>');if(view==='tax'&&!taxProfile.verified)el('main').insertAdjacentHTML('afterbegin','<div class="storage-notice">Profil pajak belum diverifikasi. Aktifkan asumsi hanya setelah memastikan kelayakan dan kelengkapan omzet.</div>');refreshIcons();};
function ledgerView(){return `<section class="book-credit-position"><div class="section-heading"><h2>Modal & pinjaman</h2><button class="button" data-work="add-ledger">${icon('plus')}Catat mutasi</button></div><div class="table-scroll"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th class="numeric">Nominal</th></tr></thead><tbody>${ledger.filter(r=>inPeriod(r.date)).map(r=>`<tr><td>${date(r.date)}</td><td>${esc(({modal:'Setoran modal',prive:'Prive',aset:'Pembelian aset',pinjam:'Penerimaan pinjaman',bayar:'Pembayaran pinjaman'})[r.type]||r.type)}</td><td>${esc(r.note)}</td><td class="numeric">${money(r.amount)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Belum ada mutasi dalam periode ini.</td></tr>'}</tbody></table></div></section>`;}
const baseDetail=detail;
detail=function(kind,id){baseDetail(kind,id);const record=kind==='stock'?productById(id):sales.find(s=>s.id===id);el('drawerBody').insertAdjacentHTML('beforeend',`<div class="detail-extra">${record.legacyId?`<p>ID lama: ${esc(record.legacyId)}</p>`:''}${record.imei?`<p>IMEI: ${esc(record.imei)}</p>`:''}${record.notes?`<p>${esc(record.notes)}</p>`:''}${record.invoice?`<button class="button" data-work="invoice" data-kind="${kind}" data-id="${id}">${icon('file-image')}Invoice</button>`:''}</div>`);refreshIcons();};
drawChart=function(){
  const c=el('chart');if(!c)return;const rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=rect.width,h=rect.height;c.width=w*dpr;c.height=h*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
  const buckets=new Map();if(period==='all'){for(const s of periodSales())buckets.set(s.date.slice(0,7),0);}else{const d=new Date(periodStart()+'T12:00:00Z');while(d.toISOString().slice(0,10)<=periodEnd()){buckets.set(d.toISOString().slice(0,10),0);d.setUTCDate(d.getUTCDate()+1);}}
  if(!buckets.size)buckets.set(TODAY,0);
  for(const s of periodSales()){const key=period==='all'?s.date.slice(0,7):s.date;buckets.set(key,(buckets.get(key)||0)+(graphMetric==='revenue'?revenue(s):profit(s))/1e6);}
  const entries=[...buckets].sort((a,b)=>a[0].localeCompare(b[0])),values=entries.map(r=>r[1]);const hi=Math.max(1,...values),lo=Math.min(0,...values),X=i=>40+i/Math.max(1,values.length-1)*(w-58),Y=v=>h-32-(v-lo)/(hi-lo)*(h-48);
  ctx.font='10px Segoe UI';ctx.fillStyle='#768079';ctx.strokeStyle='#e5ece6';for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3,y=Y(v);ctx.fillText(v.toFixed(0),0,y);ctx.beginPath();ctx.moveTo(35,y);ctx.lineTo(w-8,y);ctx.stroke();}
  ctx.beginPath();ctx.strokeStyle='#267c5e';ctx.lineWidth=2;values.forEach((v,i)=>i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));ctx.stroke();ctx.fillStyle='#267c5e';values.forEach((v,i)=>{ctx.beginPath();ctx.arc(X(i),Y(v),2,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#768079';ctx.textAlign='center';const step=Math.max(1,Math.ceil(entries.length/(w<450?4:7)));entries.forEach(([d],i)=>{if(i%step===0)ctx.fillText(period==='all'?d.slice(2):date(d),X(i),h-9);});
  c.onmousemove=e=>{const i=Math.max(0,Math.min(entries.length-1,Math.round((e.offsetX-40)/(w-58)*(entries.length-1))));el('chartTooltip').hidden=false;el('chartTooltip').textContent=entries[i][0]+' / '+money(values[i]*1e6);};c.onmouseleave=()=>{el('chartTooltip').hidden=true;};
};
function validateSnapshot(d){
  if(d?.app!=='cornetto-workspace'||![1,2,3,4].includes(d.version))throw Error('Format backup workspace tidak dikenali.');
  for(const k of stateKeys.slice(0,10))if(!Array.isArray(d[k]))throw Error('Daftar '+k+' tidak valid.');
  for(const k of ['business','taxProfile','taxAdjustments','inputVat'])if(!d[k]||typeof d[k]!=='object')throw Error('Data '+k+' tidak lengkap.');
  for(const k of ['inventory','sales','ledger','channels','suppliers','cards','cardCharges','cardPayments','taxPayments']){const ids=new Set();for(const r of d[k]){if(!/^[a-zA-Z0-9_-]+$/.test(r.id)||ids.has(r.id))throw Error('ID tidak valid/duplikat di '+k);ids.add(r.id);if(r.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))))throw Error('Tanggal tidak valid.');}}
  for(const p of d.inventory){if(!Number.isInteger(p.qty)||!Number.isInteger(p.purchasedQty)||!validAmount(p.cost)||!validAmount(p.price))throw Error('Angka inventori tidak valid.');for(const key of ['name','variant','brand','supplier','sku'])if(typeof p[key]!=='string')throw Error('Barang tidak lengkap.');}
  for(const p of d.inventory)if(p.deletedAt&&(typeof p.deletedAt!=='string'||!Number.isFinite(Date.parse(p.deletedAt))||p.qty!==0))throw Error('Arsip barang tidak valid.');
  for(const s of d.sales)if(!d.inventory.some(p=>p.id===s.productId)||!Number.isInteger(s.qty)||s.qty<1||![s.price,s.cost,s.fee,s.shipping].every(validAmount)||!['paid','pending','unknown'].includes(s.status)||typeof s.channel!=='string'||typeof s.buyer!=='string')throw Error('Penjualan tidak valid.');
  for(const k of ['expenses','ledger','cardCharges','cardPayments','taxPayments'])for(const r of d[k])if(!validAmount(r.amount))throw Error('Nominal tidak valid.');
  for(const c of [...d.channels,...d.cards])if(!/^#[a-f0-9]{6}$/i.test(c.color))throw Error('Warna tidak valid.');
  for(const c of d.channels)if(!validAmount(c.fee)||c.fee>100||typeof c.name!=='string'||(c.logo&&!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(c.logo)))throw Error('Channel tidak valid.');
  for(const c of d.cards)if(!validAmount(c.limit)||typeof c.name!=='string'||typeof c.due!=='string')throw Error('Kartu tidak valid.');
  for(const c of d.cards)if((c.dueMode!==undefined&&!['manual','cycle'].includes(c.dueMode))||(c.dueMode==='cycle'&&!CardSchedule.validRule(c)))throw Error('Aturan jatuh tempo kartu tidak valid.');
  if(d.version>=2&&!Array.isArray(d.cardGroups))throw Error('Daftar grup limit tidak lengkap.');
  const groups=d.cardGroups??[],groupIds=new Set();
  if(!Array.isArray(groups))throw Error('Grup limit tidak valid.');
  for(const g of groups){if(!/^[a-zA-Z0-9_-]+$/.test(g.id)||groupIds.has(g.id)||typeof g.name!=='string'||!g.name.trim()||!validAmount(g.limit)||g.limit<=0)throw Error('Grup limit tidak valid.');groupIds.add(g.id);}
  for(const c of d.cards)if((c.groupId&&!groupIds.has(c.groupId))||(c.legacyAllocation&&(!c.groupId||c.active)))throw Error('Keanggotaan grup kartu tidak valid.');
  for(const key of ['name','owner'])if(typeof d.business[key]!=='string')throw Error('Identitas toko tidak lengkap.');
  for(const key of ['categories','conditions','warranties'])if(!Array.isArray(d.business[key])||!d.business[key].every(x=>typeof x==='string'))throw Error('Pilihan produk tidak valid.');
  if(!validAmount(d.taxProfile.rate)||d.taxProfile.rate>100)throw Error('Tarif tidak valid.');
  if(d.migration&&(!Array.isArray(d.migration.warnings)||!d.migration.warnings.every(w=>typeof w==='string')))throw Error('Laporan impor tidak valid.');
  const batch=d.migration?.installmentImport;
  if(batch){
    if(d.version<4||typeof batch!=='object'||!CardSchedule.validDate(batch.asOf)||batch.asOf>TODAY||!Array.isArray(batch.rows)||batch.rows.length>1000||typeof batch.fingerprint!=='string'||!/^[a-f0-9]{64}$/i.test(batch.fingerprint))throw Error('Daftar impor cicilan tidak valid.');
    const ids=new Set(),numbers=new Set();
    for(const r of batch.rows){
      if(!r||!/^[a-zA-Z0-9_-]+$/.test(r.id)||ids.has(r.id)||!Number.isInteger(r.row)||r.row<1||numbers.has(r.row)||typeof r.description!=='string'||r.description.length>200||typeof r.cardLabel!=='string'||r.cardLabel.length>120||!CardSchedule.validDate(r.date)||r.date>TODAY||r.asOf!==batch.asOf||!installmentMoney(r.principal)||r.principal<=0||!Number.isInteger(r.months)||r.months<1||r.months>36||!Number.isInteger(r.paidMonths)||r.paidMonths<0||r.paidMonths>r.months||!installmentMoney(r.rate)||r.rate>100||!['pending','active'].includes(r.status))throw Error('Baris impor cicilan tidak valid.');
      ids.add(r.id);numbers.add(r.row);
      if(r.status==='active'){
        const charge=d.cardCharges.find(c=>c.id===r.chargeId&&c.importRowId===r.id&&c.cardId===r.cardId&&c.installment?.opening?.asOf===batch.asOf);
        if(!charge||!['stock','loan'].includes(r.kind)||(r.kind==='stock'&&!d.inventory.some(p=>p.id===r.productId))||(r.kind==='loan'&&!d.ledger.some(x=>x.chargeId===charge.id&&x.type==='pinjam')))throw Error('Hasil pencocokan cicilan tidak lengkap.');
      }
    }
  }
  if(d.business.expenseCorrections!==undefined){
    const keys=new Set();
    if(!Array.isArray(d.business.expenseCorrections))throw Error('Koreksi beban tidak valid.');
    for(const r of d.business.expenseCorrections){
      const key=r.chargeId+':'+r.number;
      if(keys.has(key)||!d.cardCharges.some(c=>c.id===r.chargeId&&c.installment?.schedule.some(row=>row.number===r.number))||(!r.deleted&&(!CardSchedule.validDate(r.date)||r.date>TODAY||!installmentMoney(r.amount)||typeof r.name!=='string'||typeof r.category!=='string')))throw Error('Koreksi beban tidak valid.');
      keys.add(key);
    }
  }
  validateInstallments(d);
  return d;
}
async function previewBackup(file){
  pendingImport=null;if(!file)return;if(file.size>50*1024*1024)throw Error('Ukuran file melebihi 50 MB.');
  const raw=await file.text(),b=JSON.parse(raw),fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(migration?.fingerprint===fingerprint)throw Error('Backup ini sudah diimpor. Tidak ditambahkan ulang.');
  const d=b.app==='stock-tracker'?CornettoMigration.convert(b,TODAY):validateSnapshot(b);
  d.migration??={warnings:[],importedAt:new Date().toISOString()};d.migration.fingerprint=fingerprint;
  pendingImport=d;el('importPreview').innerHTML=`<div class="storage-notice"><strong>${esc(file.name)}</strong><p>${d.inventory.length} barang / ${d.sales.length} penjualan / ${d.expenses.length} beban / ${d.cards.length} kartu</p><p>${d.migration.warnings.length} catatan pemeriksaan. Data workspace ini akan diganti; salinan sebelumnya disimpan.</p><button class="button primary" data-work="confirm-import">${icon('check')}Impor backup</button></div>`;refreshIcons();
}
document.addEventListener('change',e=>{if(e.target.id==='backupFile')previewBackup(e.target.files[0]).catch(err=>{el('importPreview').textContent=err.message;});});
document.addEventListener('click',async e=>{
 const a=e.target.closest('[data-work]');if(!a)return;
 try{
  if(a.dataset.work==='backup')downloadData('cornetto-workspace_'+TODAY+'.json',JSON.stringify(snapshot()),'application/json');
  if(a.dataset.work==='legacy')downloadData('arsip-backup-asli.json',JSON.stringify(legacyArchive),'application/json');
  if(a.dataset.work==='recovery'){const r=await readStored('before-import');if(!r)toast('Belum ada backup sebelum impor.');else downloadData('cornetto-sebelum-impor.json',JSON.stringify(r.data),'application/json');}
  if(a.dataset.work==='confirm-import'){
    if(!pendingImport)return;const next=structuredClone(pendingImport);a.disabled=true;await saveQueue;if(storageFailed)throw Error('Selesaikan masalah penyimpanan sebelum impor.');await persist(next,true);applyState(next);pendingImport=null;period='all';go('data');toast('Impor selesai dan tersimpan di perangkat ini.');
  }
  if(a.dataset.work==='invoice'){const r=a.dataset.kind==='stock'?productById(a.dataset.id):sales.find(s=>s.id===a.dataset.id),attachment=r.invoice;const data=typeof attachment==='string'?attachment:attachment?.data;if(!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[a-z0-9+/=]+$/i.test(data||''))throw Error('Format lampiran tidak didukung. File asli tetap ada di backup.');const mime=data.slice(5,data.indexOf(';')),bytes=Uint8Array.from(atob(data.split(',')[1]),x=>x.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:mime})),link=document.createElement('a');link.href=url;link.download=attachment?.name||'invoice';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(a.dataset.work==='add-ledger')openDrawer('Catat modal & pinjaman',`<form id="ledgerForm">${selectField('Jenis','type','<option value="modal">Setoran modal</option><option value="prive">Prive</option><option value="pinjam">Penerimaan pinjaman</option><option value="bayar">Pembayaran pinjaman</option><option value="aset">Pembelian aset</option>')}${field('Tanggal','date','date',TODAY,`required max="${TODAY}"`)}${field('Nominal (Rp)','amount','number','','required min="1" step="1"')}${field('Keterangan','note','text','','required maxlength="200"')}${formFooter('Simpan mutasi')}</form>`,'PEMBUKUAN');
 }catch(err){toast(err.message);if(a.isConnected)a.disabled=false;}
});
document.addEventListener('submit',e=>{if(e.target.id!=='ledgerForm')return;e.preventDefault();const d=Object.fromEntries(new FormData(e.target)),amount=Number(d.amount);if(!validAmount(amount)||amount<=0)return formError('Nominal harus positif.');ledger.push({id:nextId('ledger'),date:d.date,type:d.type,amount,note:d.note.trim()});finishModule('Mutasi dicatat.');});
window.addEventListener('beforeunload',e=>{if(savePending||storageFailed){e.preventDefault();e.returnValue='';}});
async function startWorkspace(){
  document.body.inert=true;emptyWorkspace();el('todayLabel').textContent=new Date(TODAY+'T12:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
  try{db=await openDatabase();const stored=await readStored('current');if(stored){validateSnapshot(stored.data);applyState(stored.data);revision=stored.revision;}view=stored?(labels[location.hash.slice(1)]?location.hash.slice(1):'dashboard'):'data';render();}
  catch(err){storageFailed=true;el('main').textContent='Data tidak dapat dibuka: '+err.message;updateStorageBadge();}
  finally{document.body.inert=false;window.cornettoReady=true;window.dispatchEvent(new Event('cornetto:ready'));}
}
