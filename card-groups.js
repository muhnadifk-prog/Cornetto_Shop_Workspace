'use strict';
let cardGroups=[];
function cardGroup(c){return cardGroups.find(g=>g.id===c.groupId);}
function groupBalance(id){return sum(cards.filter(c=>c.groupId===id),c=>cardBalance(c.id));}
function cardLimit(c){return cardGroup(c)?.limit??c.limit;}
function availableCardLimit(c){const g=cardGroup(c);return g?g.limit-groupBalance(g.id):c.limit-cardBalance(c.id);}
function totalAvailableCardLimit(){return sum(cards.filter(c=>c.active&&!c.groupId),c=>Math.max(0,availableCardLimit(c)))+sum(cardGroups.filter(g=>cards.some(c=>c.groupId===g.id&&c.active)),g=>Math.max(0,g.limit-groupBalance(g.id)));}
function cardLimitFields(c){return `${selectField('Fasilitas limit','groupId','<option value="">Limit sendiri</option>'+cardGroups.map(g=>`<option value="${g.id}" ${c?.groupId===g.id?'selected':''}>${esc(g.name)} / ${money(g.limit)}</option>`).join(''))}<div data-own-limit ${c?.groupId?'hidden':''}>${field('Limit sendiri (Rp)','limit','number',c?.limit||'',c?.groupId?'disabled':'required min="1" step="1"')}</div>`;}
function sharedCardsView(){
  const ungrouped=cards.filter(c=>!c.groupId);
  return `<div class="section-heading"><h2>Fasilitas kartu</h2><button class="button" data-group-action="manage">${icon('settings-2')}Grup limit</button></div>`+cardGroups.map(g=>{
    const members=cards.filter(c=>c.groupId===g.id),legacy=members.filter(c=>c.legacyAllocation),balance=groupBalance(g.id);
    return `<section class="shared-limit-group"><div class="section-heading"><div><h2>${esc(g.name)}</h2><p>${members.filter(c=>!c.legacyAllocation).length} kartu / limit gabungan</p></div><button class="icon-button" data-group-action="edit" data-id="${g.id}" title="Edit limit ${esc(g.name)}" aria-label="Edit limit ${esc(g.name)}">${icon('pencil')}</button></div><div class="shared-limit-totals"><div><span>Limit bersama</span><strong>${money(g.limit)}</strong></div><div><span>Total utang grup</span><strong>${money(balance)}</strong></div><div><span>Sisa limit bersama</span><strong class="${balance>g.limit?'red-text':''}">${money(g.limit-balance)}</strong></div></div>${legacy.map(c=>`<div class="shared-legacy"><div><strong>Transaksi lama: kartu belum ditentukan</strong><p>${esc(g.name)} / utang ${money(cardBalance(c.id))} / tetap termasuk total grup</p></div><button class="button" data-action="card-detail" data-id="${c.id}">Rincian ${icon('arrow-up-right')}</button></div>`).join('')}<div class="credit-grid">${members.filter(c=>!c.legacyAllocation).map(creditTile).join('')}</div></section>`;
  }).join('')+(ungrouped.length?`<section><h2 class="drawer-section-title">Kartu dengan limit sendiri</h2><div class="credit-grid">${ungrouped.map(creditTile).join('')}</div></section>`:'');
}
function sharedGroupManager(){
  const sources=cards.filter(c=>!c.groupId);
  openDrawer('Grup limit',`${cardGroups.map(g=>`<div class="expense-row"><div><strong>${esc(g.name)}</strong><p>${money(g.limit)}</p></div><button class="icon-button" data-group-action="edit" data-id="${g.id}" aria-label="Edit limit ${esc(g.name)}" title="Edit limit">${icon('pencil')}</button></div>`).join('')}${sources.length?`<div class="group-setup"><h3>Pisahkan catatan bank</h3><label class="form-field"><span>Catatan asal</span><select id="sharedBankSource">${sources.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button class="button" data-group-action="prepare">${icon('layers')}Siapkan pemisahan</button></div>`:''}<div class="form-footer"><button class="button" data-group-action="edit">${icon('plus')}Grup lain</button></div>`,'LIMIT BERSAMA');
}
function prepareSharedGroup(sourceId){
  const source=cards.find(c=>c.id===sourceId&&!c.groupId);if(!source)return;
  openDrawer('Siapkan '+source.name,`<form id="sharedSetupForm" data-source="${source.id}">${field('Nama grup / bank','name','text',source.name,'required maxlength="60"')}<label class="form-field"><span>Nama kartu (satu per baris)</span><textarea name="cardNames" rows="6" required maxlength="3000"></textarea></label>${field('Limit gabungan (Rp)','limit','number',source.limit,'required min="1" step="1"')}<div class="storage-notice"><strong>Utang lama ${money(cardBalance(source.id))}</strong><p>Transaksi lama tetap berada di catatan belum teralokasi dan dihitung sekali dalam grup. Kartu baru dimulai tanpa transaksi; jadwal tagihan belum diisi.</p></div>${formFooter('Buat grup dan kartu')}</form>`,'KONFIRMASI PEMISAHAN KARTU');
}
function createSharedGroup(bank,sourceId,limit,names){
  const source=cards.find(c=>c.id===sourceId);
  if(!source||source.groupId||!bank.trim()||bank.length>60||!Array.isArray(names)||!names.length||names.length>50||names.some(n=>!n.trim()||n.length>60)||new Set(names.map(n=>n.toLowerCase())).size!==names.length||!validAmount(limit)||limit<=0||cardGroups.some(g=>g.name.toLowerCase()===bank.toLowerCase()))throw Error('Grup sudah ada atau nama kartu/sumber/limit tidak valid.');
  if(names.some(name=>cards.some(c=>c.name.toLowerCase()===name.toLowerCase())))throw Error('Ada nama kartu yang sudah terdaftar. Periksa sebelum membuat grup.');
  const id=nextId('group');
  cardGroups.push({id,name:bank,limit});
  // Keep the original record and all transaction IDs; no balance is copied to child cards.
  Object.assign(source,{groupId:id,legacyAllocation:true,active:false});
  for(const name of names)cards.push({id:nextId('card'),name,bank,last4:'',limit:0,groupId:id,active:true,due:'',dueMode:'manual',color:source.color});
}
function sharedGroupForm(id){
  const g=cardGroups.find(g=>g.id===id);
  openDrawer(g?'Edit limit gabungan':'Tambah grup limit',`<form id="sharedGroupForm" data-id="${id||''}">${field('Nama grup / bank','name','text',g?.name||'','required maxlength="60"')}${field('Limit gabungan (Rp)','limit','number',g?.limit||'','required min="1" step="1"')}${g?`<p class="form-hint">Utang grup saat ini ${money(groupBalance(g.id))}</p>`:''}${formFooter('Simpan grup')}</form>`,'FASILITAS LIMIT');
}
document.addEventListener('change',e=>{
  if(e.target.name!=='groupId'||e.target.form?.id!=='cardForm')return;
  const f=e.target.form,shared=!!e.target.value;f.querySelector('[data-own-limit]').hidden=shared;f.elements.limit.disabled=shared;f.elements.limit.required=!shared;
});
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-group-action]');if(!a)return;
  if(a.dataset.groupAction==='manage')sharedGroupManager();
  if(a.dataset.groupAction==='prepare')prepareSharedGroup(el('sharedBankSource').value);
  if(a.dataset.groupAction==='edit')sharedGroupForm(a.dataset.id);
});
document.addEventListener('submit',async e=>{
  const f=e.target;if(!['sharedSetupForm','sharedGroupForm'].includes(f.id))return;e.preventDefault();
  const d=Object.fromEntries(new FormData(f)),button=f.querySelector('button[type="submit"]');button.disabled=true;
  try{
    if(f.id==='sharedSetupForm'){
      await saveQueue;if(storageFailed)throw Error('Selesaikan masalah penyimpanan sebelum membuat grup.');
      await persist(structuredClone(snapshot()),true);
      createSharedGroup(d.name.trim(),f.dataset.source,Number(d.limit),d.cardNames.split(/\r?\n/).map(n=>n.trim()).filter(Boolean));
    }else{
      const name=d.name.trim(),limit=Number(d.limit),id=f.dataset.id;
      if(!name||!validAmount(limit)||limit<=0||cardGroups.some(g=>g.id!==id&&g.name.toLowerCase()===name.toLowerCase()))throw Error('Nama grup harus unik dan limit harus positif.');
      const g=cardGroups.find(g=>g.id===id);if(g)Object.assign(g,{name,limit});else cardGroups.push({id:nextId('group'),name,limit});
    }
    finishModule('Grup limit tersimpan.');
  }catch(err){formError(err.message);}finally{if(button.isConnected)button.disabled=false;}
});

