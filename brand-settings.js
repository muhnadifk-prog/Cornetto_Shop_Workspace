'use strict';
function brandSettings(){
  const names=stockBrandList().slice(0,-1),counts=new Map();
  for(const p of inventory)if(!p.deletedAt){const key=stockBrandKey(p.brand);counts.set(key,(counts.get(key)||0)+1);}
  return `<section><div class="section-heading"><h2>Merek barang</h2><button class="button primary" data-brand-action="add">${icon('plus')}Tambah merek</button></div>
    <div class="entity-list">${names.map(name=>`<div class="option-row"><div><strong>${esc(name)}</strong><div class="product-sub">${counts.get(stockBrandKey(name))||0} catatan barang</div></div>
      <div class="entity-actions"><button class="icon-button" data-brand-action="rename" data-brand-name="${esc(name)}" title="Edit merek" aria-label="Edit merek ${esc(name)}">${icon('pencil')}</button><button class="icon-button stock-delete" data-brand-action="remove" data-brand-name="${esc(name)}" title="Hapus merek" aria-label="Hapus merek ${esc(name)}">${icon('trash-2')}</button></div></div>`).join('')||emptyState('Belum ada merek.')}</div></section>`;
}
function brandBaseline(state,old){
  return JSON.stringify([stockBrandList(state.business,state.inventory),old?state.inventory.filter(p=>stockBrandKey(p.brand)===stockBrandKey(old)).map(p=>p.id).sort():[]]);
}
function prepareBrandChange(state,action,old,input,baseline){
  if(brandBaseline(state,old)!==baseline)throw Error('Daftar merek atau barang terkait berubah. Buka ulang pengaturan merek.');
  const names=stockBrandList(state.business,state.inventory).slice(0,-1);
  if(!['add','rename','remove'].includes(action)||action!=='add'&&!names.includes(old))throw Error('Merek tidak ditemukan. Buka ulang pengaturan merek.');
  const name=(input||'').trim().replace(/\s+/g,' '),key=stockBrandKey(name);
  if(action!=='remove'){
    if(!name||name.length>80||['all','lainnya'].includes(key))throw Error('Masukkan nama merek lain, maksimal 80 karakter.');
    if(names.some(b=>stockBrandKey(b)===key&&(action==='add'||b!==old)))throw Error('Merek dengan nama tersebut sudah ada.');
  }
  const next=structuredClone(state);
  next.business.brands=action==='add'?[...names,name]:action==='rename'?names.map(b=>b===old?name:b):names.filter(b=>b!==old);
  if(action==='rename')for(const p of next.inventory)if(stockBrandKey(p.brand)===stockBrandKey(old))p.brand=name;
  return next;
}
function openBrandSettingsForm(action,old=''){
  const state=snapshot();
  if(action!=='add'&&!stockBrandList().slice(0,-1).includes(old))return;
  const removed=action==='remove',used=action==='add'?0:inventory.filter(p=>stockBrandKey(p.brand)===stockBrandKey(old)).length;
  openDrawer(removed?'Hapus merek?':action==='add'?'Tambah merek':'Edit merek',`<form id="brandSettingsForm" data-operation="${action}" data-original="${esc(old)}">
    ${removed?`<strong>${esc(old)}</strong><p class="stock-edit-note">Merek ini akan dihapus dari pilihan Barang masuk dan filter Inventori. Barang yang sudah tercatat tetap menyimpan merek semula.</p>`:field('Nama merek','name','text',old,'required maxlength="80"')}
    ${action==='rename'&&used?`<p class="stock-edit-note">Nama merek ikut diperbarui pada ${used} catatan barang.</p>`:''}
    ${removed?`<p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-action="cancel">Batal</button><button type="submit" class="button danger">${icon('trash-2')}Hapus merek</button></div>`:formFooter('Simpan merek')}</form>`,'PENGATURAN / MEREK');
  el('brandSettingsForm').dataset.baseline=brandBaseline(state,old);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-brand-action]');if(b)openBrandSettingsForm(b.dataset.brandAction,b.dataset.brandName);
});
document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id!=='brandSettingsForm')return;e.preventDefault();if(f.dataset.saving)return;
  const button=f.querySelector('[type="submit"]');f.dataset.saving='true';button.disabled=true;let saving=false;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap. Coba lagi setelah data tersimpan.');
    const {operation,original,baseline}=f.dataset,next=prepareBrandChange(snapshot(),operation,original,f.elements.namedItem('name')?.value,baseline);
    validateSnapshot(next);savePending++;saving=true;updateStorageBadge();
    await persist(next);applyState(next);closeDrawer();render();toast(operation==='remove'?'Merek dihapus dari pilihan.':'Merek tersimpan.');
  }catch(err){formError(err.message);}finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
