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
function stockChargeProducts(c){return [...new Set([c.productId,...(c.productIds||[])].filter(Boolean))];}
function stockFundingDeletion(state,id){
  const linked=stockLinks(state,id).charges.filter(c=>c.source!=='cash-loan'&&!state.ledger.some(r=>r.type==='pinjam'&&r.chargeId===c.id));
  const shared=linked.filter(c=>stockChargeProducts(c).some(pid=>pid!==id&&!state.inventory.find(p=>p.id===pid)?.deletedAt));
  const charges=linked.filter(c=>!shared.includes(c));
  return {...chargeRemovalRecords(state,charges),shared,
    products:state.inventory.filter(p=>linked.some(c=>stockChargeProducts(c).includes(p.id)))
  };
}
function chargeRemovalRecords(state,charges){
  const ids=new Set(charges.map(c=>c.id));
  const payments=state.cardPayments.filter(p=>ids.has(p.installmentChargeId)||(p.source==='auto-sale'&&ids.has(p.purchaseChargeId)));
  const allocatedPayments=state.cardPayments.filter(p=>p.saleAllocations?.some(a=>ids.has(a.chargeId)));
  const paymentIds=new Set(payments.map(p=>p.id));
  return {charges,payments,allocatedPayments,
    ledger:state.ledger.filter(r=>paymentIds.has(r.paymentId)||payments.some(p=>r.id==='ledger-'+p.id)||(!r.paymentId&&ids.has(r.chargeId))),
    corrections:(state.business.expenseCorrections||[]).filter(r=>ids.has(r.chargeId)),
    imports:(state.migration?.installmentImport?.rows||[]).filter(r=>ids.has(r.chargeId)||charges.some(c=>c.importRowId===r.id))
  };
}
function stockBaseline(state,id){return JSON.stringify({product:state.inventory.find(p=>p.id===id),links:stockLinks(state,id),funding:stockFundingDeletion(state,id)});}
function deletedInstallmentProduct(c){
  return stockChargeProducts(c).find(id=>productById(id)?.deletedAt&&stockFundingDeletion(snapshot(),id).charges.some(row=>row.id===c.id));
}
function stockFundingLocked(product,links){
  return !!(links.charges.length||links.ledger.length||links.imports.length||(product.payMethod&&!['cash','unknown'].includes(product.payMethod)));
}
function stockDeleteReason(state,id){
  const p=state.inventory.find(p=>p.id===id);if(!p)return 'Barang tidak ditemukan.';
  if(p.deletedAt&&!stockFundingDeletion(state,id).charges.length)return 'Barang sudah dihapus dari inventori.';
  return '';
}
function prepareStockEdit(state,id,d,baseline){
  const p=state.inventory.find(p=>p.id===id);
  if(!p||stockBaseline(state,id)!==baseline)throw Error('Data barang atau transaksi terkait berubah. Buka ulang edit inventori.');
  if(p.deletedAt)throw Error('Barang sudah dihapus dari inventori.');
  if(state.business.brands&&stockBrandKey(d.brand)!==stockBrandKey(p.brand)&&!stockBrandList(state.business,state.inventory).some(name=>stockBrandKey(name)===stockBrandKey(d.brand)))throw Error('Merek sudah berubah. Buka ulang edit barang.');
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
  const next=structuredClone(state);
  cancelStockPurchase(next,id,confirmPayments);
  return next;
}
function cancelStockPurchase(next,id,confirmPayments){
  const p=next.inventory.find(p=>p.id===id),links=stockLinks(next,id);
  const removal=stockFundingDeletion(next,id);
  if(removal.payments.length&&!confirmPayments)throw Error('Konfirmasi penghapusan catatan pembayaran terkait terlebih dahulu.');
  if(removal.charges.length){
    // Preserve a recoverable copy outside live balances and automatic posting.
    const history=removal.charges.every(c=>c.installment)?'cancelledInstallments':'cancelledPurchases';
    p[history]??=[];
    removeChargeRecords(next,removal,p[history]);
    for(const pid of new Set(removal.charges.flatMap(stockChargeProducts))){
      const product=next.inventory.find(row=>row.id===pid);
      const remaining=stockLinks(next,pid);
      if(product&&!remaining.charges.length&&!remaining.sales.length)product.purchaseCancelled=true;
    }
  }
  // Sales retain their original cost and product reference after stock deletion.
  if(links.sales.length||stockFundingLocked(p,links)||p.qty!==p.purchasedQty){
    if(!p.deletedAt){p.deletedAt=new Date().toISOString();p.deletedStockQty=p.qty;}p.qty=0;
  }else next.inventory=next.inventory.filter(p=>p.id!==id);
}
function removeChargeRecords(state,removal,history){
  const {products,shared,allocatedPayments,...records}=removal;
  const chargeIds=new Set(records.charges.map(c=>c.id)),paymentIds=new Set(records.payments.map(r=>r.id)),ledgerIds=new Set(records.ledger.map(r=>r.id));
  const allocations=allocatedPayments.map(p=>({paymentId:p.id,allocations:p.saleAllocations.filter(a=>chargeIds.has(a.chargeId))}));
  history.push({deletedAt:new Date().toISOString(),...structuredClone(records),allocations});
  state.cardCharges=state.cardCharges.filter(c=>!chargeIds.has(c.id));
  state.cardPayments=state.cardPayments.filter(p=>!paymentIds.has(p.id));
  for(const pay of allocatedPayments)pay.saleAllocations=pay.saleAllocations.filter(a=>!chargeIds.has(a.chargeId));
  state.ledger=state.ledger.filter(r=>!ledgerIds.has(r.id));
  state.business.expenseCorrections=(state.business.expenseCorrections||[]).filter(r=>!chargeIds.has(r.chargeId));
  for(const row of records.imports){
    Object.assign(row,{status:'pending',dismissed:true,reason:'Tagihan kartu dibatalkan.'});
    for(const key of ['chargeId','activatedAt','kind','productId','productIds'])delete row[key];
  }
}
function deletedChargeAudit(state){
  const products=new Map(state.inventory.map(p=>[p.id,p]));
  return state.cardCharges.flatMap(c=>{
    const ids=stockChargeProducts(c);
    if(!ids.length||c.source==='cash-loan'||state.ledger.some(r=>r.type==='pinjam'&&r.chargeId===c.id))return [];
    const linked=ids.map(id=>products.get(id));
    if(linked.every(p=>p&&!p.deletedAt))return [];
    const owner=linked.find(p=>p?.deletedAt);
    if(linked.some(p=>!p))return [{charge:c,reason:'Referensi barang tidak lengkap.'}];
    if(linked.some(p=>!p.deletedAt))return [{charge:c,reason:'Tagihan gabungan masih membiayai barang aktif.'}];
    const links=stockLinks(state,owner.id),removal=stockFundingDeletion(state,owner.id);
    const simple=ids.length===1&&links.charges.length===1&&!c.installment&&!links.sales.length&&!links.ledger.length&&
      !links.imports.length&&!removal.payments.length&&!removal.allocatedPayments.length&&!removal.ledger.length&&
      owner.deletedStockQty===owner.purchasedQty&&owner.payMethod===c.cardId&&Math.abs(owner.cost*owner.purchasedQty-c.amount)<0.005;
    return [{charge:c,owner:owner.id,simple,reason:simple?'Seluruh unit dihapus sebelum terjual.':links.sales.length?'Ada penjualan terkait.':'Periksa rincian pembiayaan.'}];
  });
}
function simpleRepairBaseline(rows){return JSON.stringify(rows.filter(r=>r.simple).map(r=>[r.owner,r.charge.id,r.charge.cardId,r.charge.amount,r.charge.date]));}
function prepareDeletedChargeRepair(state,baseline){
  const rows=deletedChargeAudit(state),simple=rows.filter(r=>r.simple);
  if(!simple.length||simpleRepairBaseline(rows)!==baseline)throw Error('Daftar tagihan berubah. Buka ulang pemeriksaan.');
  const next=structuredClone(state);
  for(const row of simple)cancelStockPurchase(next,row.owner,false);
  return next;
}
function deletedChargeNotice(){
  const count=deletedChargeAudit(snapshot()).length;
  return count?`<div class="repayment-review"><span>${count} tagihan terkait stok terhapus atau referensi barang yang belum lengkap</span><button class="button" data-stock-audit>Periksa tagihan stok</button></div>`:'';
}
function deleteChargeButton(charge){
  return `<button type="button" class="icon-button stock-delete" data-delete-charge="${esc(charge.id)}" title="Hapus tagihan" aria-label="Hapus tagihan ${esc(charge.note||charge.id)}">${icon('trash-2')}</button>`;
}
function prepareChargeDeletion(state,id,expected){
  const next=structuredClone(state),charge=next.cardCharges.find(c=>c.id===id);
  if(!charge)throw Error('Tagihan sudah dihapus. Buka ulang detail kartu.');
  const records=chargeRemovalRecords(next,[charge]),productIds=stockChargeProducts(charge);
  const products=next.inventory.filter(p=>productIds.includes(p.id));
  const baseline=JSON.stringify([records,products.map(p=>[p.id,p.name,p.payMethod,p.deletedAt,p.qty]),TODAY]);
  next.business.cancelledCardCharges??=[];
  removeChargeRecords(next,records,next.business.cancelledCardCharges);
  for(const p of products){
    const links=stockLinks(next,p.id);
    if(p.deletedAt&&!links.charges.length&&!links.sales.length)p.purchaseCancelled=true;
    if(p.payMethod!==charge.cardId||links.charges.some(c=>c.cardId===p.payMethod))continue;
    const sources=[...new Set(links.charges.map(c=>c.cardId))];
    p.payMethod=sources.length===1?sources[0]:'unknown';
  }
  reconcileSaleCardPayments(next);
  const card=state.cards.find(c=>c.id===charge.cardId);
  const members=card?.groupId?state.cards.filter(c=>c.groupId===card.groupId).map(c=>c.id):[charge.cardId];
  const delta=sum(members,cid=>cardBalance(cid,'',state)-cardBalance(cid,'',next));
  const key=JSON.stringify([baseline,members,delta]);
  if(expected!==undefined&&key!==expected)throw Error('Tagihan atau pembayaran terkait berubah. Buka ulang konfirmasi.');
  return {next,charge,records,products,delta,key};
}
function deleteChargeForm(id,origin){
  const state=snapshot();
  if(!state.cardCharges.some(c=>c.id===id)){toast('Tagihan sudah dihapus.');return;}
  const {charge,records,products,delta,key}=prepareChargeDeletion(state,id);
  const loan=records.ledger.filter(r=>r.type==='pinjam');
  openDrawer('Hapus tagihan kartu?',`<form id="chargeDeleteForm" data-id="${esc(id)}" data-origin="${origin}">
    <div class="stock-delete-summary"><strong>${esc(charge.note||'Tagihan kartu')}</strong><p>${esc(cardName(charge.cardId))} · ${cardDate(charge.date)} · ${esc(id)}</p></div>
    <div class="detail-lines">${bookLine('Pokok tagihan',charge.amount)}
    ${records.payments.length?bookLine('Pembayaran terkait yang ikut dihapus ('+records.payments.length+')',sum(records.payments,p=>p.amount)):''}
    ${loan.length?bookLine('Penerimaan pinjaman yang ikut dihapus',sum(loan,r=>r.amount)):''}
    ${bookLine('Perubahan sisa limit di tracker',delta,true)}</div>
    ${charge.installment?'<p>Jadwal cicilan dan biaya terkait ikut dibatalkan.</p>':''}
    ${products.some(p=>!p.deletedAt)?'<p>Unit barang tetap tersedia sesuai jumlah stok saat ini. Sumber pembayaran mengikuti tagihan yang tersisa.</p>':''}
    <p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-charge-back>Batal</button><button type="submit" class="button danger">${icon('trash-2')}Hapus tagihan</button></div>
    </form>`,'KARTU KREDIT');
  el('chargeDeleteForm').dataset.baseline=key;
}
function returnToChargeList(origin,cardId){
  if(origin==='audit')deletedChargeReview();
  else if(origin==='card')cardDetail(cardId);
}
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-delete-charge]');
  if(button){
    const origin=button.closest('#stockRepairForm')?'audit':button.closest('#drawer')?'card':'list';
    deleteChargeForm(button.dataset.deleteCharge,origin);
  }
  const back=e.target.closest('[data-charge-back]');
  if(back){
    const f=back.form,cardId=cardCharges.find(c=>c.id===f.dataset.id)?.cardId;
    closeDrawer();if(cardId)returnToChargeList(f.dataset.origin,cardId);
  }
});
function deletedChargeReview(){
  const state=snapshot(),rows=deletedChargeAudit(state),simple=rows.filter(r=>r.simple);
  const list=rows.map(({charge,reason})=>`<div class="expense-row"><div><strong>${esc(charge.note)}</strong><p>${esc(cardName(charge.cardId))} · ${cardDate(charge.date)} · ${esc(charge.id)}</p><p>${esc(reason)}</p></div><strong>${money(charge.amount)}</strong>${deleteChargeButton(charge)}</div>`).join('');
  openDrawer('Periksa tagihan stok',`<form id="stockRepairForm">${list||emptyState('Semua tagihan stok sudah diperiksa.')}${simple.length?`<p class="stock-edit-note">Pembatalan mencakup ${simple.length} tagihan biasa untuk barang yang seluruh unitnya sudah dihapus. Limit di tracker dihitung ulang pada masing-masing kartu.</p>${bookLine('Total tagihan yang dibatalkan',sum(simple,r=>r.charge.amount))}${formFooter('Batalkan '+simple.length+' tagihan stok')}`:''}</form>`,'SELURUH KARTU');
  el('stockRepairForm').dataset.baseline=simpleRepairBaseline(rows);
}
document.addEventListener('click',e=>{if(e.target.closest('[data-stock-audit]'))deletedChargeReview();});
function stockDetailActions(p){return `<div class="stock-detail-actions"><button class="button" data-action="copy-stock" data-id="${p.id}">${icon('copy')}Salin barang masuk</button><button class="button" data-action="edit-stock" data-id="${p.id}">${icon('pencil')}Edit barang</button><button class="button stock-delete" data-action="delete-stock" data-id="${p.id}">${icon('trash-2')}Hapus barang</button></div>`;}
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
    <div class="field-pair">${selectField('Merek','brand',stockBrandOptions(p.brand??''))}${field('Sisa stok (unit)','qty','number',p.qty,`required step="1" min="${Math.min(0,p.qty)}"`)}</div>
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
  const removal=stockFundingDeletion(state,id),cleanup=!!p.deletedAt;
  const message=removal.charges.length?'Tagihan pembelian ini dibatalkan. Utang dan sisa limit di tracker dihitung ulang setelah memperhitungkan pembayaran terkait. Riwayat pembatalan tersimpan di backup.':archive?'Barang diarsipkan dan sisa stok menjadi nol.':'Barang dan lampiran invoice dihapus dari inventori.';
  const financeSummary=removal.charges.length?`${bookLine('Pokok tagihan yang dibatalkan',sum(removal.charges,c=>c.amount))}${bookLine('Catatan pembayaran yang ikut dihapus',sum(removal.payments,r=>r.amount))}${bookLine('Perubahan sisa limit di tracker',sum(removal.charges,c=>c.amount-openingInstallmentPrincipal(c)+installmentFees(c))-sum(removal.payments,r=>r.amount))}`:'';
  const paymentConfirmation=removal.payments.length?`<label class="purchase-finance-option"><input type="checkbox" name="confirmPayments" required><span>Saya setuju menghapus ${removal.payments.length} catatan pembayaran terkait beserta mutasi pembukuannya.</span></label>`:'';
  const sharedNotice=removal.shared.length?'<p class="stock-edit-note">Tagihan gabungan masih membiayai barang lain dan akan diperiksa kembali saat barang terakhir dihapus.</p>':'';
  openDrawer(reason?'Barang tidak dapat dihapus':cleanup?'Batalkan tagihan stok terhapus?':'Hapus barang?',`<form id="stockDeleteForm" data-id="${esc(id)}"><div class="stock-delete-summary"><strong>${esc(p.name)}</strong><p>${esc(p.variant)}${p.imei?' / IMEI '+esc(p.imei):''}</p></div>
    ${reason?`<p class="stock-edit-note" role="status">${esc(reason)}</p><div class="form-footer"><button type="button" class="button" data-action="cancel">Tutup</button></div>`:`<div class="detail-lines">${bookLine('Nilai stok yang dihapus',p.cost*Math.max(0,p.qty))}<div class="book-line"><span>Sisa stok</span><strong>${p.qty} unit</strong></div>${financeSummary}</div><p class="stock-edit-note">${message} ${links.sales.length?'Ada '+links.sales.length+' penjualan terkait. Riwayat penjualan dan HPP tersimpan.':''}</p>${sharedNotice}${paymentConfirmation}<p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-action="cancel">Batal</button><button type="submit" class="button danger">${icon('trash-2')}${cleanup?'Batalkan tagihan':removal.charges.length?'Hapus barang & tagihan':'Hapus barang'}</button></div>`}</form>`,'INVENTORI');
  el('stockDeleteForm').dataset.baseline=stockBaseline(state,id);
}
document.addEventListener('submit',async e=>{
  const f=e.target;if(!['stockEditForm','stockDeleteForm','stockRepairForm','chargeDeleteForm'].includes(f.id))return;
  e.preventDefault();if(f.dataset.saving)return;
  const button=f.querySelector('button[type="submit"]');if(!button)return;
  f.dataset.saving='true';button.disabled=true;
  let saving=false;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap. Backup data sebelum mencoba lagi.');
    const state=snapshot(),id=f.dataset.id,baseline=f.dataset.baseline;
    let next,message;
    switch(f.id){
      case 'chargeDeleteForm':
        next=prepareChargeDeletion(state,id,baseline).next;message='Tagihan dihapus. Limit kartu diperbarui.';break;
      case 'stockRepairForm':
        next=prepareDeletedChargeRepair(state,baseline);message='Tagihan stok dibatalkan. Limit kartu diperbarui.';break;
      case 'stockEditForm':
        next=prepareStockEdit(state,id,Object.fromEntries(new FormData(f)),baseline);message='Inventori diperbarui.';break;
      default:
        next=prepareStockDelete(state,id,baseline,f.elements.confirmPayments?.checked===true);
        message=stockFundingDeletion(state,id).charges.length?'Barang dan tagihan dibatalkan. Limit kartu diperbarui.':'Barang dihapus.';
    }
    validateSnapshot(next);savePending++;saving=true;updateStorageBadge();
    await persist(next);applyState(next);closeDrawer();render();toast(message);
    if(f.id==='chargeDeleteForm')returnToChargeList(f.dataset.origin,state.cardCharges.find(c=>c.id===id).cardId);
  }catch(err){formError(err.message);}
  finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
