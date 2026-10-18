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
function stockInstallmentDeletion(state,id){
  const linked=stockLinks(state,id).charges.filter(c=>c.installment);
  const productIds=c=>[...new Set([c.productId,...(c.productIds||[])].filter(Boolean))];
  const shared=linked.filter(c=>productIds(c).some(pid=>pid!==id&&!state.inventory.find(p=>p.id===pid)?.deletedAt));
  const charges=linked.filter(c=>!shared.includes(c)),ids=new Set(charges.map(c=>c.id));
  const payments=state.cardPayments.filter(p=>ids.has(p.installmentChargeId)||ids.has(p.purchaseChargeId));
  const paymentIds=new Set(payments.map(p=>p.id));
  return {charges,shared,payments,
    ledger:state.ledger.filter(r=>ids.has(r.chargeId)||paymentIds.has(r.paymentId)||payments.some(p=>r.id==='ledger-'+p.id)),
    corrections:(state.business.expenseCorrections||[]).filter(r=>ids.has(r.chargeId)),
    imports:(state.migration?.installmentImport?.rows||[]).filter(r=>ids.has(r.chargeId)||charges.some(c=>c.importRowId===r.id)),
    products:state.inventory.filter(p=>linked.some(c=>productIds(c).includes(p.id)))
  };
}
function stockBaseline(state,id){return JSON.stringify({product:state.inventory.find(p=>p.id===id),links:stockLinks(state,id),installments:stockInstallmentDeletion(state,id)});}
function deletedInstallmentProduct(c){
  return [c.productId,...(c.productIds||[])].filter(Boolean).find(id=>productById(id)?.deletedAt&&stockInstallmentDeletion(snapshot(),id).charges.some(row=>row.id===c.id));
}
function stockFundingLocked(product,links){
  return !!(links.charges.length||links.ledger.length||links.imports.length||(product.payMethod&&!['cash','unknown'].includes(product.payMethod)));
}
function stockDeleteReason(state,id){
  const p=state.inventory.find(p=>p.id===id);if(!p)return 'Barang tidak ditemukan.';
  if(p.deletedAt&&!stockInstallmentDeletion(state,id).charges.length)return 'Barang sudah dihapus dari inventori.';
  return '';
}
function prepareStockEdit(state,id,d,baseline){
  const p=state.inventory.find(p=>p.id===id);
  if(!p||stockBaseline(state,id)!==baseline)throw Error('Data barang atau transaksi terkait berubah. Buka ulang edit inventori.');
  if(p.deletedAt)throw Error('Barang sudah dihapus dari inventori.');
  const links=stockLinks(state,id);
  const qty=Number(d.qty),cost=Number(d.cost),price=Number(d.price),dateValue=d.date;
  const textLimits={name:200,variant:200,brand:80,category:100,condition:100,warranty:100,imei:100,notes:4000};
  for(const [key,max] of Object.entries(textLimits))if(typeof d[key]!=='string'||d[key].trim().length>max)throw Error('Periksa kelengkapan dan panjang isian barang.');
  if(!d.name.trim()||d.qty===''||d.cost===''||d.price===''||!Number.isSafeInteger(qty)||!validAmount(cost)||!validAmount(price))throw Error('Periksa nama, sisa stok, HPP, dan harga jual.');
  if(qty!==p.qty&&qty<0)throw Error('Sisa stok baru tidak boleh negatif.');
  const purchasedQty=p.purchasedQty+qty-p.qty;
  if(!Number.isSafeInteger(purchasedQty)||purchasedQty<0||!validAmount(cost*purchasedQty))throw Error('Jumlah pembelian atau nilai stok tidak valid.');
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
function prepareStockDelete(state,id,baseline,confirmPayments=false){
  if(stockBaseline(state,id)!==baseline)throw Error('Data barang atau transaksi terkait berubah. Buka ulang konfirmasi hapus.');
  const reason=stockDeleteReason(state,id);if(reason)throw Error(reason);
  const next=structuredClone(state),p=next.inventory.find(p=>p.id===id),links=stockLinks(next,id);
  const removal=stockInstallmentDeletion(next,id);
  if(removal.payments.length&&!confirmPayments)throw Error('Konfirmasi penghapusan catatan pembayaran cicilan terkait terlebih dahulu.');
  if(removal.charges.length){
    // Preserve a recoverable copy outside live balances and automatic posting.
    p.cancelledInstallments??=[];
    const {products,shared,...records}=removal;
    p.cancelledInstallments.push({deletedAt:new Date().toISOString(),...structuredClone(records)});
    const chargeIds=new Set(removal.charges.map(c=>c.id)),paymentIds=new Set(removal.payments.map(r=>r.id)),ledgerIds=new Set(removal.ledger.map(r=>r.id));
    next.cardCharges=next.cardCharges.filter(c=>!chargeIds.has(c.id));
    next.cardPayments=next.cardPayments.filter(r=>!paymentIds.has(r.id));
    next.ledger=next.ledger.filter(r=>!ledgerIds.has(r.id));
    next.business.expenseCorrections=(next.business.expenseCorrections||[]).filter(r=>!chargeIds.has(r.chargeId));
    for(const row of removal.imports){row.status='pending';row.dismissed=true;row.reason='Dibatalkan bersama penghapusan barang inventori.';delete row.chargeId;delete row.activatedAt;delete row.kind;delete row.productId;}
  }
  // Sales retain their original cost and product reference after stock deletion.
  if(links.sales.length||stockFundingLocked(p,links)||p.qty!==p.purchasedQty){
    if(!p.deletedAt){p.deletedAt=new Date().toISOString();p.deletedStockQty=p.qty;}p.qty=0;
  }else next.inventory=next.inventory.filter(p=>p.id!==id);
  return next;
}
function stockDetailActions(p){return `<div class="stock-detail-actions"><button class="button" data-action="edit-stock" data-id="${p.id}">${icon('pencil')}Edit barang</button><button class="button stock-delete" data-action="delete-stock" data-id="${p.id}">${icon('trash-2')}Hapus barang</button></div>`;}
function stockEditOptions(values,current){return [...new Set([current||'',...values])].map(value=>`<option value="${esc(value)}" ${value===(current||'')?'selected':''}>${esc(value)||'Belum diisi'}</option>`).join('');}
function editStockForm(id){
  const state=snapshot(),p=productById(id);if(!p||p.deletedAt)return;
  const links=stockLinks(state,id),funded=stockFundingLocked(p,links);
  const supplierOptions=activeOptions(suppliers,p.supplierId);
  openDrawer('Edit inventori',`<form id="stockEditForm" data-id="${esc(id)}">
    ${funded?'<p class="stock-edit-note">Terhubung ke pembiayaan. Perubahan inventori tidak mengubah nominal utang, pembayaran, atau jadwal cicilan.</p>':''}
    ${links.sales.length?`<p class="stock-edit-note">${links.sales.length} penjualan terkait. HPP dan laba penjualan yang sudah tercatat tetap.</p>`:''}
    ${field('Tanggal masuk','date','date',p.date||'',`min="2000-01-01" max="${TODAY}"${p.date?' required':''}`)}
    ${field('Nama produk','name','text',p.name,'required maxlength="200"')}
    ${field('Varian / kapasitas / warna','variant','text',p.variant,'maxlength="200"')}
    <div class="field-pair">${selectField('Merek','brand',stockEditOptions(['Apple','Samsung','Google','Xiaomi','Lainnya'],p.brand))}${field('Sisa stok (unit)','qty','number',p.qty,`required step="1" min="${Math.min(0,p.qty)}"`)}</div>
    <div class="field-pair">${field('HPP per unit (Rp)','cost','number',p.cost,'required min="0" step="0.01"')}${field('Harga jual per unit (Rp)','price','number',p.price,'required min="0" step="0.01"')}</div>
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
  const links=stockLinks(state,id),archive=links.sales.length||stockFundingLocked(p,links)||p.qty!==p.purchasedQty;
  const removal=stockInstallmentDeletion(state,id),cleanup=!!p.deletedAt;
  const message=removal.charges.length?'Barang dan cicilan terkait dihapus dari catatan aktif, termasuk pokok utang, jadwal, bunga/admin, dan pembayaran yang khusus terhubung. Pencatatan otomatis berhenti. Riwayat penjualan tetap; salinan catatan yang dibatalkan disimpan dalam backup barang. Ini tidak membatalkan transaksi di bank.':archive?'Barang dihapus dari daftar inventori dan sisa stok menjadi nol. Riwayat penjualan serta tagihan biasa tetap tersimpan.':'Barang beserta lampiran invoice-nya akan dihapus dari inventori. Tindakan ini tidak dapat dibatalkan.';
  const financeSummary=removal.charges.length?`${bookLine('Pokok cicilan yang dibatalkan',sum(removal.charges,c=>c.amount))}${bookLine('Catatan pembayaran yang ikut dihapus',sum(removal.payments,r=>r.amount))}`:'';
  const paymentConfirmation=removal.payments.length?`<label class="purchase-finance-option"><input type="checkbox" name="confirmPayments" required><span>Saya setuju menghapus ${removal.payments.length} catatan pembayaran cicilan terkait beserta mutasi pembukuannya.</span></label>`:'';
  const sharedNotice=removal.shared.length?'<p class="stock-edit-note">Ada cicilan gabungan dengan barang lain yang belum dihapus. Cicilan gabungan tersebut tetap tersimpan agar tagihan barang lain tidak ikut hilang.</p>':'';
  openDrawer(reason?'Barang tidak dapat dihapus':cleanup?'Hapus cicilan barang terhapus?':'Hapus barang?',`<form id="stockDeleteForm" data-id="${esc(id)}"><div class="stock-delete-summary"><strong>${esc(p.name)}</strong><p>${esc(p.variant)}${p.imei?' / IMEI '+esc(p.imei):''}</p></div>
    ${reason?`<p class="stock-edit-note" role="status">${esc(reason)}</p><div class="form-footer"><button type="button" class="button" data-action="cancel">Tutup</button></div>`:`<div class="detail-lines">${bookLine('Nilai stok yang dihapus',p.cost*Math.max(0,p.qty))}<div class="book-line"><span>Sisa stok</span><strong>${p.qty} unit</strong></div>${financeSummary}</div><p class="stock-edit-note">${message} Perubahan disinkronkan ke cloud jika aktif.</p>${sharedNotice}${paymentConfirmation}<p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-action="cancel">Batal</button><button type="submit" class="button danger">${icon('trash-2')}${cleanup?'Hapus cicilan':removal.charges.length?'Hapus barang & cicilan':'Hapus barang'}</button></div>`}</form>`,'INVENTORI');
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
    const state=snapshot(),next=f.id==='stockEditForm'?prepareStockEdit(state,f.dataset.id,Object.fromEntries(new FormData(f)),f.dataset.baseline):prepareStockDelete(state,f.dataset.id,f.dataset.baseline,f.elements.confirmPayments?.checked===true);
    validateSnapshot(next);savePending++;saving=true;updateStorageBadge();
    await persist(next);applyState(next);closeDrawer();render();toast(f.id==='stockEditForm'?'Inventori diperbarui.':stockInstallmentDeletion(state,f.dataset.id).charges.length?'Barang dan cicilan terkait sudah dihapus.':'Barang dihapus.');
  }catch(err){formError(err.message);}
  finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
