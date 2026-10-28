'use strict';
function saleDeleteLinks(state,id){
  const payments=state.cardPayments.filter(p=>p.saleId===id&&isSaleRepayment(p)),paymentIds=new Set(payments.map(p=>p.id));
  return {
    payments,
    ledger:state.ledger.filter(r=>(r.source==='auto-sale'&&r.saleId===id)||paymentIds.has(r.paymentId)||payments.some(p=>r.id==='ledger-'+p.id)),
    manualPayments:state.cardPayments.filter(p=>!isSaleRepayment(p)&&p.saleAllocations?.some(a=>a.saleId===id)),
    corrections:(state.business.salePaymentCorrections||[]).filter(r=>r.saleId===id),
    skipped:(state.business.salePaymentSkips||[]).includes(id)
  };
}
function saleDeleteBaseline(state,id){
  const sale=state.sales.find(s=>s.id===id);
  return JSON.stringify({sale,product:state.inventory.find(p=>p.id===sale?.productId),links:saleDeleteLinks(state,id)});
}
function prepareSaleDelete(state,id,baseline){
  const sale=state.sales.find(s=>s.id===id);
  if(!sale||saleDeleteBaseline(state,id)!==baseline)throw Error('Penjualan atau stok terkait berubah. Buka ulang konfirmasi hapus.');
  const next=structuredClone(state),p=next.inventory.find(p=>p.id===sale.productId);
  if(!p||!Number.isSafeInteger(sale.qty)||sale.qty<1||!Number.isSafeInteger(p.qty)||!Number.isSafeInteger(p.qty+sale.qty))throw Error('Produk atau jumlah stok tidak valid. Penjualan belum dihapus.');
  const links=saleDeleteLinks(next,id);
  // Keep the original record and its automatic postings recoverable in the stock backup.
  p.cancelledSales??=[];
  p.cancelledSales.push({deletedAt:new Date().toISOString(),sale:structuredClone(sale),...structuredClone(links)});
  p.qty+=sale.qty;
  // A previously deleted batch returns only the units from this cancelled sale.
  delete p.deletedAt;delete p.deletedStockQty;
  next.sales=next.sales.filter(s=>s.id!==id);
  const paymentIds=new Set(links.payments.map(r=>r.id)),ledgerIds=new Set(links.ledger.map(r=>r.id));
  next.cardPayments=next.cardPayments.filter(r=>!paymentIds.has(r.id));
  next.ledger=next.ledger.filter(r=>!ledgerIds.has(r.id));
  for(const payment of links.manualPayments)payment.saleAllocations=payment.saleAllocations.filter(a=>a.saleId!==id);
  if(next.business.salePaymentCorrections)next.business.salePaymentCorrections=next.business.salePaymentCorrections.filter(r=>r.saleId!==id);
  if(next.business.salePaymentSkips)next.business.salePaymentSkips=next.business.salePaymentSkips.filter(saleId=>saleId!==id);
  reconcileSaleCardPayments(next);validateSnapshot(next);return next;
}
function saleDetailActions(s){return `<div class="sale-detail-actions"><button class="button" data-action="edit-sale" data-id="${esc(s.id)}">${icon('pencil')}Edit penjualan</button><button class="button sale-delete" data-action="delete-sale" data-id="${esc(s.id)}">${icon('trash-2')}Hapus penjualan</button></div>`;}
function deleteSaleForm(id){
  const state=snapshot(),s=state.sales.find(s=>s.id===id),p=state.inventory.find(p=>p.id===s?.productId);if(!s||!p)return;
  const links=saleDeleteLinks(state,id);
  openDrawer('Hapus penjualan?',`<form id="saleDeleteForm" data-id="${esc(id)}">
    <div class="stock-delete-summary"><strong>${esc(p.name)}</strong><p>${esc(p.variant)}${p.imei?' / IMEI '+esc(p.imei):''}</p><p>${esc(id)} / ${date(s.date)} ${s.date.slice(0,4)}</p></div>
    <div class="detail-lines">${bookLine('Total penjualan',revenue(s))}<div class="book-line"><span>Stok dikembalikan</span><strong>${s.qty} unit</strong></div><div class="book-line"><span>Sisa stok setelah hapus</span><strong>${p.qty+s.qty} unit</strong></div>${links.payments.length?bookLine('Pembayaran kartu otomatis dibatalkan',sum(links.payments,r=>r.amount)):''}</div>
    <p class="stock-edit-note">Penjualan dihapus dari laporan, termasuk omzet, laba, dan pencairannya. ${s.qty} unit kembali ke inventori asal. Tagihan pembelian dan cicilan barang tetap tersimpan.${p.deletedAt?' Batch yang sebelumnya dihapus akan muncul lagi, hanya dengan unit yang dikembalikan ini.':''}</p>
    ${links.payments.length||links.manualPayments.length?'<p class="stock-edit-note">Catatan pembayaran kartu otomatis dari penjualan ini ikut dibatalkan. Pembayaran manual tetap ada; hanya tautannya ke penjualan ini yang dilepas. Ini tidak membatalkan pembayaran di bank.</p>':''}
    <p id="formError" class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-action="cancel">Batal</button><button type="submit" class="button danger">${icon('trash-2')}Hapus & kembalikan stok</button></div></form>`,'PENJUALAN');
  el('saleDeleteForm').dataset.baseline=saleDeleteBaseline(state,id);
}
document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id!=='saleDeleteForm')return;e.preventDefault();if(f.dataset.saving)return;
  const button=f.querySelector('[type="submit"]');if(!button)return;
  f.dataset.saving='true';button.disabled=true;let saving=false;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap. Backup data sebelum mencoba lagi.');
    const next=prepareSaleDelete(snapshot(),f.dataset.id,f.dataset.baseline);
    savePending++;saving=true;updateStorageBadge();await persist(next);applyState(next);closeDrawer();render();toast('Penjualan dihapus. Stok sudah dikembalikan.');
  }catch(err){formError(err.message);}
  finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
let saleEditBaseline='';
function editSaleForm(id){
  const s=sales.find(s=>s.id===id);if(!s)return;
  saleEditBaseline=JSON.stringify(s);
  const products=inventory.filter(p=>p.qty>0||p.id===s.productId);
  const names=[...new Set([s.channel,...channels.filter(c=>c.active).map(c=>c.name)])];
  openDrawer('Edit penjualan',`<form id="saleEditForm" data-id="${esc(id)}">
    ${field('Tanggal','date','date',s.date,`required min="2000-01-01" max="${TODAY}"`)}
    ${selectField('Produk / batch stok','productId',products.map(p=>`<option value="${esc(p.id)}" ${p.id===s.productId?'selected':''}>${esc(p.name)} / ${esc(p.variant)} / ${p.imei?'IMEI '+esc(p.imei):p.date?date(p.date):'Tanggal belum diisi'} / HPP ${money(p.id===s.productId?s.cost:p.cost)}</option>`).join(''))}
    <div class="field-pair">${field('Jumlah unit','qty','number',s.qty,'required min="1" step="1"')}${field('Harga jual per unit (Rp)','price','number',s.price,'required min="1" step="1"')}</div>
    <div class="field-pair">${selectField('Channel','channel',names.map(name=>`<option ${name===s.channel?'selected':''}>${esc(name)}</option>`).join(''))}${selectField('Status dana','status',[['unknown','Belum diketahui'],['pending','Belum cair'],['paid','Lunas']].map(([v,label])=>`<option value="${v}" ${v===s.status?'selected':''}>${label}</option>`).join(''))}</div>
    <div class="field-pair">${field('Biaya admin total (Rp)','fee','number',s.fee,'required min="0" step="1"')}${field('Ongkir ditanggung (Rp)','shipping','number',s.shipping||0,'required min="0" step="1"')}</div>
    ${field('Nama pembeli','buyer','text',s.buyer||'','maxlength="80"')}
    <div class="estimate"><span>HPP per unit</span><strong id="editSaleCost">${money(s.cost)}</strong></div>
    <div class="estimate"><span>Laba transaksi</span><strong id="editSaleProfit">${saleProfitText(profit(s),revenue(s))}</strong></div>
    <label class="purchase-finance-option"><input type="checkbox" name="financePurchase"><span>Atur cicilan kartu untuk pembelian barang ini setelah simpan</span></label>${formFooter('Simpan perubahan')}</form>`,'PENJUALAN / '+id);
}
function commitSaleEdit(id,d,baseline){
  const s=sales.find(s=>s.id===id);
  if(!s||JSON.stringify(s)!==baseline)throw Error('Transaksi berubah. Tutup dan buka ulang edit penjualan.');
  const old=productById(s.productId),p=productById(d.productId),qty=Number(d.qty),price=Number(d.price),fee=Number(d.fee),shipping=Number(d.shipping);
  const ch=channels.find(c=>c.active&&c.name===d.channel);
  if(!old||!p||!Number.isSafeInteger(qty)||qty<1||!validAmount(price)||price<=0||!validAmount(price*qty)||!validAmount(fee)||!validAmount(shipping)||!['paid','pending','unknown'].includes(d.status)||(!ch&&d.channel!==s.channel)||!CardSchedule.validDate(d.date)||d.date<'2000-01-01'||d.date>TODAY||typeof d.buyer!=='string'||d.buyer.trim().length>80)throw Error('Periksa produk, tanggal, jumlah, harga, biaya, dan channel.');
  const extra=p===old?qty-s.qty:qty;
  if(extra>Math.max(0,p.qty))throw Error('Jumlah penjualan melebihi stok tersedia.');
  const cost=p===old?s.cost:p.cost;
  const settlementDate=d.status==='paid'?(s.status==='paid'?s.settlementDate:TODAY):undefined;
  if(settlementDate&&settlementDate<d.date)throw Error('Tanggal penjualan tidak boleh setelah tanggal pencairan.');
  // Only the stock delta changes; historical fees, purchase funding and attachments stay intact.
  if(!old.deletedAt)old.qty+=s.qty;
  if(!p.deletedAt)p.qty-=qty;
  Object.assign(s,{productId:p.id,date:d.date,qty,price,cost,fee,shipping,channel:d.channel,channelId:ch?.id||s.channelId,buyer:d.buyer.trim(),status:d.status});
  if(settlementDate)s.settlementDate=settlementDate;else delete s.settlementDate;
}
function updateSaleEditEstimate(f){
  const s=sales.find(s=>s.id===f.dataset.id),p=productById(f.elements.productId.value);if(!s||!p)return;
  const cost=p.id===s.productId?s.cost:p.cost;
  el('editSaleCost').textContent=money(cost);
  const total=Number(f.elements.price.value)*Number(f.elements.qty.value);
  el('editSaleProfit').textContent=saleProfitText(total-cost*Number(f.elements.qty.value)-Number(f.elements.fee.value)-Number(f.elements.shipping.value),total);
}
for(const event of ['input','change'])document.addEventListener(event,e=>{if(e.target.form?.id==='saleEditForm')updateSaleEditEstimate(e.target.form);});
document.addEventListener('submit',e=>{
  const f=e.target;if(f.id!=='saleEditForm')return;e.preventDefault();
  try{commitSaleEdit(f.dataset.id,Object.fromEntries(new FormData(f)),saleEditBaseline);const finance=f.elements.financePurchase.checked,productId=f.elements.productId.value;saveDemo();closeDrawer();render();if(finance)purchaseFinanceForm(productId);else toast('Penjualan diperbarui.');}catch(err){formError(err.message);}
});
