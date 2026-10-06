'use strict';
function stockLinks(state,id){
  const references=row=>row.productId===id||row.productIds?.includes(id);
  return {
    sales:state.sales.filter(references),
    charges:state.cardCharges.filter(references),
    ledger:state.ledger.filter(references),
    imports:(state.migration?.installmentImport?.rows||[]).filter(references)
  };
}
function stockBaseline(state,id){return JSON.stringify({product:state.inventory.find(p=>p.id===id),links:stockLinks(state,id)});}
function stockFundingLocked(product,links){
  return !!(links.charges.length||links.ledger.length||links.imports.length||(product.payMethod&&!['cash','unknown'].includes(product.payMethod)));
}
function stockDeleteReason(state,id){
  const p=state.inventory.find(p=>p.id===id);if(!p)return 'Barang tidak ditemukan.';
  const links=stockLinks(state,id);
  if(links.sales.length)return `Barang ini terkait ${links.sales.length} penjualan. Penghapusan diblokir agar riwayat penjualan tetap utuh.`;
  if(stockFundingLocked(p,links))return 'Barang ini terkait pembiayaan kartu, cicilan, atau pembukuan. Penghapusan diblokir agar catatan utang tetap utuh.';
  if(p.qty!==p.purchasedQty)return 'Ada perubahan stok historis pada barang ini. Periksa riwayatnya sebelum menghapus.';
  return '';
}
function prepareStockEdit(state,id,d,baseline){
  const p=state.inventory.find(p=>p.id===id);
  if(!p||stockBaseline(state,id)!==baseline)throw Error('Data barang atau transaksi terkait berubah. Buka ulang edit inventori.');
  const links=stockLinks(state,id),locked=stockFundingLocked(p,links);
  const qty=Number(d.qty),cost=Number(d.cost),price=Number(d.price),dateValue=d.date;
  const textLimits={name:200,variant:200,brand:80,category:100,condition:100,warranty:100,imei:100,notes:4000};
  for(const [key,max] of Object.entries(textLimits))if(typeof d[key]!=='string'||d[key].trim().length>max)throw Error('Periksa kelengkapan dan panjang isian barang.');
  if(!d.name.trim()||d.qty===''||d.cost===''||d.price===''||!Number.isSafeInteger(qty)||!validAmount(cost)||!validAmount(price))throw Error('Periksa nama, sisa stok, HPP, dan harga jual.');
  if(qty!==p.qty&&qty<0)throw Error('Sisa stok baru tidak boleh negatif.');
  const purchasedQty=p.purchasedQty+qty-p.qty;
  if(!Number.isSafeInteger(purchasedQty)||purchasedQty<0||!validAmount(cost*purchasedQty))throw Error('Jumlah pembelian atau nilai stok tidak valid.');
  if(locked&&(qty!==p.qty||cost!==p.cost||dateValue!==(p.date||'')))throw Error('Tanggal, HPP, dan jumlah stok terkunci karena terhubung ke pembiayaan. Catatan utang tidak diubah dari inventori.');
  if(dateValue!==(p.date||'')&&(!CardSchedule.validDate(dateValue)||dateValue<'2000-01-01'||dateValue>TODAY||links.sales.some(s=>s.date<dateValue)))throw Error('Tanggal masuk harus valid, tidak di masa depan, dan tidak setelah penjualan terkait.');
  const supplier=state.suppliers.find(s=>s.id===d.supplierId&&(s.active||s.id===p.supplierId));
  const keepSupplier=d.supplierId===(p.supplierId||'');
  if(!supplier&&!keepSupplier)throw Error('Pilih supplier aktif.');
  const next=structuredClone(state),target=next.inventory.find(row=>row.id===id);
  // Historical sale costs and purchase funding are separate records, never rewritten here.
  Object.assign(target,Object.fromEntries(Object.keys(textLimits).map(key=>[key,d[key].trim()])),{
    qty,purchasedQty,cost,price,date:dateValue,
    age:dateValue?Math.max(0,Math.floor((Date.parse(TODAY+'T12:00:00Z')-Date.parse(dateValue+'T12:00:00Z'))/86400000)):p.age,
    supplierId:supplier?.id||p.supplierId,supplier:supplier?.name||p.supplier
  });
  return next;
}
function prepareStockDelete(state,id,baseline){
  if(stockBaseline(state,id)!==baseline)throw Error('Data barang atau transaksi terkait berubah. Buka ulang konfirmasi hapus.');
  const reason=stockDeleteReason(state,id);if(reason)throw Error(reason);
  const next=structuredClone(state);next.inventory=next.inventory.filter(p=>p.id!==id);return next;
}
function stockDetailActions(p){return `<div class="stock-detail-actions"><button class="button" data-action="edit-stock" data-id="${p.id}">${icon('pencil')}Edit barang</button><button class="button stock-delete" data-action="delete-stock" data-id="${p.id}">${icon('trash-2')}Hapus barang</button></div>`;}
function stockEditOptions(values,current){return [...new Set([current||'',...values])].map(value=>`<option value="${esc(value)}" ${value===(current||'')?'selected':''}>${esc(value)||'Belum diisi'}</option>`).join('');}
function editStockForm(id){
  const state=snapshot(),p=productById(id);if(!p)return;
  const links=stockLinks(state,id),locked=stockFundingLocked(p,links),readonly=locked?' readonly':'';
  const supplierOptions=activeOptions(suppliers,p.supplierId);
  openDrawer('Edit inventori',`<form id="stockEditForm" data-id="${esc(id)}">
    ${locked?'<p class="stock-edit-note">Terhubung ke pembiayaan. Tanggal masuk, HPP, dan jumlah stok dikunci; utang serta jadwal cicilan tetap.</p>':''}
    ${links.sales.length?`<p class="stock-edit-note">${links.sales.length} penjualan terkait. HPP dan laba penjualan yang sudah tercatat tetap.</p>`:''}
    ${field('Tanggal masuk','date','date',p.date||'',`min="2000-01-01" max="${TODAY}"${p.date?' required':''}${readonly}`)}
    ${field('Nama produk','name','text',p.name,'required maxlength="200"')}
    ${field('Varian / kapasitas / warna','variant','text',p.variant,'maxlength="200"')}
    <div class="field-pair">${selectField('Merek','brand',stockEditOptions(['Apple','Samsung','Google','Xiaomi','Lainnya'],p.brand))}${field('Sisa stok (unit)','qty','number',p.qty,`required step="1" min="${Math.min(0,p.qty)}"${readonly}`)}</div>
    <div class="field-pair">${field('HPP per unit (Rp)','cost','number',p.cost,`required min="0" step="0.01"${readonly}`)}${field('Harga jual per unit (Rp)','price','number',p.price,'required min="0" step="0.01"')}</div>
    ${selectField('Supplier','supplierId',(suppliers.some(s=>s.id===p.supplierId)?'':`<option value="${esc(p.supplierId||'')}">${esc(p.supplier||'Belum diketahui')}</option>`)+supplierOptions)}
    <div class="field-pair">${selectField('Kategori','category',stockEditOptions(business.categories,p.category))}${selectField('Kondisi','condition',stockEditOptions(business.conditions,p.condition))}</div>
    ${selectField('Garansi','warranty',stockEditOptions(business.warranties,p.warranty))}
    ${field('IMEI / nomor seri','imei','text',p.imei||'','maxlength="100"')}
    <label class="form-field"><span>Catatan</span><textarea name="notes" maxlength="4000">${esc(p.notes||'')}</textarea></label>
    ${formFooter('Simpan perubahan')}</form>`,'INVENTORI');
  el('stockEditForm').dataset.baseline=stockBaseline(state,id);
}
function deleteStockForm(id){
  const state=snapshot(),p=productById(id);if(!p)return;
  const reason=stockDeleteReason(state,id);
  openDrawer(reason?'Barang tidak dapat dihapus':'Hapus barang?',`<form id="stockDeleteForm" data-id="${esc(id)}"><div class="stock-delete-summary"><strong>${esc(p.name)}</strong><p>${esc(p.variant)}${p.imei?' / IMEI '+esc(p.imei):''}</p></div>
    ${reason?`<p class="stock-edit-note" role="status">${esc(reason)}</p><div class="form-footer"><button type="button" class="button" data-action="cancel">Tutup</button><button type="button" class="button" data-action="edit-stock" data-id="${p.id}">${icon('pencil')}Edit barang</button></div>`:`<div class="detail-lines">${bookLine('Nilai stok yang dihapus',p.cost*Math.max(0,p.qty))}<div class="book-line"><span>Sisa stok</span><strong>${p.qty} unit</strong></div></div><p class="stock-edit-note">Barang beserta lampiran invoice-nya akan dihapus dari inventori dan disinkronkan ke cloud jika aktif. Tindakan ini tidak dapat dibatalkan.</p><p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-action="cancel">Batal</button><button type="submit" class="button danger">${icon('trash-2')}Hapus barang</button></div>`}</form>`,'INVENTORI');
  el('stockDeleteForm').dataset.baseline=stockBaseline(state,id);
}
document.addEventListener('submit',async e=>{
  const f=e.target;if(!['stockEditForm','stockDeleteForm'].includes(f.id))return;
  e.preventDefault();if(f.dataset.saving)return;
  const button=f.querySelector('button[type="submit"]');if(!button)return;
  f.dataset.saving='true';button.disabled=true;
  let saving=false;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap. Backup data sebelum mencoba lagi.');
    const state=snapshot(),next=f.id==='stockEditForm'?prepareStockEdit(state,f.dataset.id,Object.fromEntries(new FormData(f)),f.dataset.baseline):prepareStockDelete(state,f.dataset.id,f.dataset.baseline);
    validateSnapshot(next);savePending++;saving=true;updateStorageBadge();
    await persist(next);applyState(next);closeDrawer();render();toast(f.id==='stockEditForm'?'Inventori diperbarui.':'Barang dihapus.');
  }catch(err){formError(err.message);}
  finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
