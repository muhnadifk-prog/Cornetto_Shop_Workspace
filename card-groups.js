'use strict';
let cardGroups=[];
function cardGroup(c){return cardGroups.find(g=>g.id===c.groupId);}
function groupBalance(id){return sum(cards.filter(c=>c.groupId===id),c=>cardBalance(c.id));}
function nearestCardDueLabel(active){
  const name=c=>c.bank+' / '+c.name+(c.last4?' / '+c.last4:'');
  const reminders=active.filter(c=>cardDue(c)&&ordinaryCardBalance(c.id)>0).map(c=>({date:cardDue(c),name:name(c)}));
  for(const {charge,row} of installmentUpcoming()){const c=cards.find(c=>c.id===charge.cardId);if(c)reminders.push({date:row.dueDate,name:name(c)+' / cicilan '+row.number+'/'+charge.installment.months});}
  reminders.sort((a,b)=>a.date.localeCompare(b.date));
  if(!reminders.length)return 'Jatuh tempo terdekat <strong>-</strong>';
  const due=reminders[0].date,names=[...new Set(reminders.filter(r=>r.date===due).map(r=>r.name))];
  return `${due<TODAY?'Lewat jatuh tempo':'Jatuh tempo terdekat'} <strong>${cardDate(due)}</strong><span class="due-card-names">${names.map(esc).join(' &middot; ')}</span>`;
}
function cardLimit(c){return cardGroup(c)?.limit??c.limit;}
function availableCardLimit(c){const g=cardGroup(c);return g?g.limit-groupBalance(g.id):c.limit-cardBalance(c.id);}
function totalAvailableCardLimit(){return sum(cards.filter(c=>c.active&&!c.groupId),c=>Math.max(0,availableCardLimit(c)))+sum(cardGroups.filter(g=>cards.some(c=>c.groupId===g.id&&c.active)),g=>Math.max(0,g.limit-groupBalance(g.id)));}
function cardLimitFields(c){
  const shared=!!c?.groupId,newGroup=shared&&!cardGroups.length;
  return `<fieldset class="limit-choice"><legend>Jenis limit</legend><label><input type="radio" name="limitMode" value="own" ${shared?'':'checked'}>Limit sendiri</label><label><input type="radio" name="limitMode" value="shared" ${shared?'checked':''}>Limit gabungan</label></fieldset>
    <div data-own-limit ${shared?'hidden':''}>${field('Limit kartu (Rp)','limit','number',c?.limit||'',shared?'disabled':'required min="1" step="1"')}</div>
    <div data-shared-limit ${shared?'':'hidden'}>
      ${selectField('Grup limit','groupId','<option value="">Pilih grup</option>'+cardGroups.map(g=>`<option value="${g.id}" ${c?.groupId===g.id?'selected':''}>${esc(g.name)} / ${money(g.limit)}</option>`).join('')+`<option value="__new" ${newGroup?'selected':''}>+ Grup limit baru</option>`)}
      <div data-new-group ${newGroup?'':'hidden'}>${field('Nama grup / bank','groupName','text','','disabled required maxlength="60"')}${field('Limit gabungan (Rp)','groupLimit','number','','disabled required min="1" step="1"')}</div>
    </div>`;
}
function updateCardLimitForm(f){
  const shared=f.elements.limitMode.value==='shared',fresh=shared&&f.elements.groupId.value==='__new';
  f.querySelector('[data-own-limit]').hidden=shared;f.elements.limit.disabled=shared;f.elements.limit.required=!shared;
  f.querySelector('[data-shared-limit]').hidden=!shared;f.elements.groupId.disabled=!shared;f.elements.groupId.required=shared;
  f.querySelector('[data-new-group]').hidden=!fresh;
  for(const name of ['groupName','groupLimit'])f.elements[name].disabled=!fresh;
}
function commitCardSettings(id,d){
  const existing=cards.find(c=>c.id===id),name=(d.name||'').trim(),bank=(d.bank||'').trim();
  const shared=d.limitMode==='shared',fresh=shared&&d.groupId==='__new',group=shared?cardGroups.find(g=>g.id===d.groupId):null;
  const limit=shared?0:Number(d.limit),groupName=(d.groupName||'').trim(),groupLimit=Number(d.groupLimit);
  const schedule={dueMode:d.dueMode,statementDay:Number(d.statementDay),dueAfterDays:Number(d.dueAfterDays)};
  if((id&&!existing)||!['own','shared'].includes(d.limitMode)||!name||name.length>60||!bank||bank.length>40||!/^([0-9]{4})?$/.test(d.last4||'')||!/^#[0-9a-f]{6}$/i.test(d.color||'')||cards.some(c=>c.id!==id&&c.name.toLowerCase()===name.toLowerCase()&&c.bank.toLowerCase()===bank.toLowerCase()))throw Error('Periksa nama kartu, bank, 4 digit terakhir, dan warna. Nama kartu pada bank yang sama harus unik.');
  if(shared&&!fresh&&!group)throw Error('Pilih grup limit atau buat grup baru.');
  if(!shared&&(!validAmount(limit)||limit<=0||limit<cardBalance(id)))throw Error('Limit kartu tidak boleh kurang dari utang berjalan.');
  if(fresh&&(!groupName||groupName.length>60||cardGroups.some(g=>g.name.toLowerCase()===groupName.toLowerCase())||!validAmount(groupLimit)||groupLimit<=0||groupLimit<cardBalance(id)))throw Error('Nama grup harus unik dan limit gabungan tidak boleh kurang dari utang kartu.');
  if(group&&existing?.groupId!==group.id&&cardBalance(id)>Math.max(0,group.limit-groupBalance(group.id)))throw Error('Sisa limit grup tidak cukup untuk utang kartu ini.');
  if(!['manual','cycle'].includes(d.dueMode)||(d.dueMode==='cycle'&&!CardSchedule.validRule(schedule))||(d.dueMode==='manual'&&d.due&&!CardSchedule.validDate(d.due)))throw Error('Isi tanggal cetak 1-31 dan H+ 1-60 hari, atau tanggal manual yang valid.');
  // Commit both records only after validating the entire form.
  const groupId=fresh?nextId('group'):group?.id||'';
  if(fresh)cardGroups.push({id:groupId,name:groupName,limit:groupLimit});
  const c=existing||{id:nextId('card'),active:true};
  Object.assign(c,{name,bank,last4:d.last4||'',limit,groupId,due:d.dueMode==='cycle'?CardSchedule.due(schedule,cardToday()):(d.due||''),dueMode:d.dueMode,statementDay:d.dueMode==='cycle'?schedule.statementDay:null,dueAfterDays:d.dueMode==='cycle'?schedule.dueAfterDays:null,color:d.color});
  if(!existing)cards.push(c);
}
const expandedCardSections=new Set();
function cardSection(key,title,body){return `<details class="card-collapse" data-card-section="${esc(key)}" ${expandedCardSections.has(key)?'open':''}><summary><span>${title}</span>${icon('chevron-down')}</summary><div class="card-collapse-body">${body}</div></details>`;}
document.addEventListener('toggle',e=>{const key=e.target.dataset?.cardSection;if(key){if(e.target.open)expandedCardSections.add(key);else expandedCardSections.delete(key);}},true);
function sharedCardsView(){
  const ungrouped=cards.filter(c=>!c.groupId);
  const grouped=cardGroups.map(g=>{
    const members=cards.filter(c=>c.groupId===g.id),legacy=members.filter(c=>c.legacyAllocation),balance=groupBalance(g.id);
    return `<section class="shared-limit-group"><div class="section-heading"><div><h2>${esc(g.name)}</h2><p>${members.filter(c=>!c.legacyAllocation).length} kartu / limit gabungan</p></div><button class="icon-button" data-group-action="edit" data-id="${g.id}" title="Edit limit ${esc(g.name)}" aria-label="Edit limit ${esc(g.name)}">${icon('pencil')}</button></div><div class="shared-limit-totals"><div><span>Limit bersama</span><strong>${money(g.limit)}</strong></div><div><span>Total utang grup</span><strong>${money(balance)}</strong></div><div><span>Sisa limit bersama</span><strong class="${balance>g.limit?'red-text':''}">${money(g.limit-balance)}</strong></div></div>${cardSection(g.id,'Rincian '+members.filter(c=>!c.legacyAllocation).length+' kartu',`${legacy.map(c=>`<div class="shared-legacy"><div><strong>Transaksi lama: kartu belum ditentukan</strong><p>${esc(g.name)} / utang ${money(cardBalance(c.id))} / tetap termasuk total grup</p></div><button class="button" data-action="card-detail" data-id="${c.id}">Rincian ${icon('arrow-up-right')}</button></div>`).join('')}<div class="credit-grid">${members.filter(c=>!c.legacyAllocation).map(creditTile).join('')}</div>`)}</section>`;
  }).join('');
  return `<div class="section-heading"><h2>Fasilitas kartu</h2><button class="button" data-group-action="manage">${icon('settings-2')}Grup limit</button></div>`+cardSection('shared','Kartu dengan limit gabungan / '+cardGroups.length+' grup',grouped||emptyState('Belum ada grup limit.'))+cardSection('independent','Kartu dengan limit sendiri / '+ungrouped.length,`<div class="credit-grid">${ungrouped.map(creditTile).join('')}</div>`);
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
  if(!['groupId','limitMode'].includes(e.target.name)||e.target.form?.id!=='cardForm')return;
  updateCardLimitForm(e.target.form);
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

