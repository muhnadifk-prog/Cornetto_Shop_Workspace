'use strict';
const isSaleRepayment=p=>p.source==='auto-sale';
function dismissDuplicateInstallmentImports(state){
  const batch=state.migration?.installmentImport;
  if(batch?.fingerprint!=='d7e9fc49eeaf0e4025656a3a317ede6f8a0c8d7c0f03055e8613bcc7027269bd')return false;
  let changed=false;
  for(const r of batch.rows)if(['excel-cicil-012','excel-cicil-028'].includes(r.id)&&r.status==='pending'&&!r.duplicateReviewed){r.dismissed=true;r.duplicateReviewed=true;changed=true;}
  return changed;
}
function saleRepaymentPlans(state,asOf=TODAY){
  const products=new Map(state.inventory.map(p=>[p.id,p])),cardIds=new Set(state.cards.filter(c=>!c.legacyAllocation).map(c=>c.id));
  const ordinary=state.cardCharges.filter(c=>!c.installment),manual=state.cardPayments.filter(p=>!p.installmentChargeId&&!isSaleRepayment(p));
  const allocated=manual.flatMap(p=>(p.saleAllocations||[]).map(a=>({...a,payment:p})));
  const chargeBudgets=new Map(ordinary.map(c=>[c.id,Math.max(0,cents(c.amount)-sum(allocated.filter(a=>a.chargeId===c.id),a=>cents(a.amount)))]));
  const cardBudgets=new Map([...cardIds].map(id=>[id,Math.max(0,sum(ordinary.filter(c=>c.cardId===id),c=>cents(c.amount))-sum(manual.filter(p=>p.cardId===id),p=>cents(p.amount)))]));
  const rows=[],payments=[],skips=new Set(state.business.salePaymentSkips||[]);
  // Existing linked payments get first claim on the remaining balance; sorting is deterministic across devices.
  const previous=new Map(state.cardPayments.filter(isSaleRepayment).map(p=>[p.saleId,p]));
  const ordered=state.sales.filter(s=>s.status==='paid').slice().sort((a,b)=>Number(previous.has(b.id))-Number(previous.has(a.id))||(a.settlementDate||a.date).localeCompare(b.settlementDate||b.date)||a.id.localeCompare(b.id));
  for(const s of ordered){
    const p=products.get(s.productId),links=state.cardCharges.filter(c=>c.productId===s.productId||c.productIds?.includes(s.productId));
    if(skips.has(s.id)||(!links.length&&!cardIds.has(p?.payMethod)))continue;
    if(links.length===1&&links[0].installment)continue;
    const c=links.length===1?links[0]:null,target=Math.max(0,Math.min(cents(s.cost*s.qty),cents(s.price*s.qty-s.fee-(s.shipping||0))));
    const result={sale:s,charge:c,target:rupiah(target),amount:0,matched:0,reason:''};rows.push(result);
    if(!c||c.productIds?.length>1||!cardIds.has(c.cardId)){result.reason='Pembelian belum tertaut ke satu tagihan biasa pada kartu yang jelas.';continue;}
    if(!p||!CardSchedule.validDate(c.date)||c.date>s.date||!CardSchedule.validDate(s.date)||s.date>asOf||s.settlementDate&&(!CardSchedule.validDate(s.settlementDate)||s.settlementDate<s.date||s.settlementDate>asOf)){
      result.reason='Tanggal pembelian atau pencairan perlu diperiksa.';continue;
    }
    if(cents(c.amount)!==cents(s.cost*p.purchasedQty)||sum(state.sales.filter(x=>x.productId===p.id),x=>x.qty)>p.purchasedQty){result.reason='Pokok pembelian atau jumlah unit berbeda dari riwayat penjualan.';continue;}
    const matched=sum(allocated.filter(a=>a.saleId===s.id&&a.chargeId===c.id),a=>cents(a.amount));result.matched=rupiah(matched);
    const remainder=Math.max(0,target-matched),old=previous.get(s.id);
    const loose=manual.some(pay=>pay.cardId===c.cardId&&(!CardSchedule.validDate(pay.date)||pay.date>=c.date)&&cents(pay.amount)>sum(pay.saleAllocations||[],a=>cents(a.amount)));
    if(loose&&remainder>0&&!old){result.reason='Ada pembayaran tagihan biasa yang belum dicocokkan.';continue;}
    const correction=(state.business.salePaymentCorrections||[]).find(x=>x.saleId===s.id);
    let amount=Math.min(remainder,chargeBudgets.get(c.id)||0,cardBudgets.get(c.cardId)||0);
    if(loose)amount=Math.min(amount,old?cents(old.amount):0);
    if(correction)amount=Math.min(amount,cents(correction.amount));
    result.amount=rupiah(amount);
    if(amount<remainder&&!correction)result.reason='Sisa utang atau pembayaran terdahulu perlu dicocokkan.';
    if(amount<=0)continue;
    const paymentDate=correction?.date||s.settlementDate||s.date;
    if(paymentDate<s.date||paymentDate>asOf){result.reason='Tanggal koreksi pembayaran mendahului penjualan atau melewati hari ini.';result.amount=0;continue;}
    chargeBudgets.set(c.id,chargeBudgets.get(c.id)-amount);cardBudgets.set(c.cardId,cardBudgets.get(c.cardId)-amount);
    payments.push({id:'sale-pay-'+s.id,cardId:c.cardId,purchaseChargeId:c.id,saleId:s.id,amount:rupiah(amount),date:paymentDate,source:'auto-sale',assumption:!correction,note:correction?.note||('Hasil penjualan cair / asumsi pemilik, bukan konfirmasi bank.'+(!s.settlementDate?' Tanggal mengikuti penjualan.':'')),settlementDateAssumed:!correction&&!s.settlementDate});
  }
  return {rows,payments};
}
function reconcileSaleCardPayments(state,asOf=TODAY){
  let changed=dismissDuplicateInstallmentImports(state);
  for(const p of state.cardPayments){
    if(!Array.isArray(p.saleAllocations))continue;
    const valid=p.saleAllocations.filter(a=>{const s=state.sales.find(s=>s.id===a.saleId),c=state.cardCharges.find(c=>c.id===a.chargeId);return s&&c&&!c.installment&&c.cardId===p.cardId&&c.productId===s.productId&&p.date>=s.date&&p.date<=asOf;});
    const next=sum(valid,a=>cents(a.amount))<=cents(p.amount)?valid:[];
    if(JSON.stringify(next)!==JSON.stringify(p.saleAllocations)){p.saleAllocations=next;changed=true;}
  }
  const desired=saleRepaymentPlans(state,asOf).payments,byId=new Map(desired.map(p=>[p.id,p]));
  const oldIds=new Set(state.cardPayments.filter(isSaleRepayment).map(p=>p.id));
  for(let i=state.cardPayments.length-1;i>=0;i--){const p=state.cardPayments[i];if(!isSaleRepayment(p))continue;const next=byId.get(p.id);if(!next){state.cardPayments.splice(i,1);changed=true;}else if(JSON.stringify(p)!==JSON.stringify(next)){state.cardPayments[i]=next;changed=true;}byId.delete(p.id);}
  for(const p of byId.values()){state.cardPayments.push(p);changed=true;}
  const wanted=new Map(desired.map(p=>['ledger-'+p.id,{id:'ledger-'+p.id,date:p.date,type:'bayar',amount:p.amount,note:p.note,cardId:p.cardId,chargeId:p.purchaseChargeId,paymentId:p.id,saleId:p.saleId,source:'auto-sale',assumption:p.assumption}]));
  for(let i=state.ledger.length-1;i>=0;i--){const r=state.ledger[i];if(r.source!=='auto-sale'&&!oldIds.has(r.paymentId))continue;const next=wanted.get(r.id);if(!next){state.ledger.splice(i,1);changed=true;}else if(JSON.stringify(r)!==JSON.stringify(next)){state.ledger[i]=next;changed=true;}wanted.delete(r.id);}
  for(const r of wanted.values()){state.ledger.push(r);changed=true;}
  return changed;
}
function queueSaleRepaymentReconciliation(){
  queueMicrotask(()=>{if(window.cornettoReady&&!storageFailed&&reconcileSaleCardPayments(snapshot())){saveDemo();render();}});
}
function skipSaleRepayment(payment){
  business.salePaymentSkips=[...new Set([...(business.salePaymentSkips||[]),payment.saleId])];
  cardPayments=cardPayments.filter(p=>p.id!==payment.id);ledger=ledger.filter(r=>r.paymentId!==payment.id);
}
function saleRepaymentReviewButton(){
  const pending=saleRepaymentPlans(snapshot()).rows.filter(r=>r.reason&&(selectedCard==='all'||r.charge?.cardId===selectedCard));
  const skipped=(business.salePaymentSkips||[]).length;
  return pending.length||skipped?`<div class="repayment-review"><span>${pending.length} penjualan perlu dicocokkan${skipped?' / '+skipped+' otomatis dihentikan':''}</span><button class="button" data-sale-repay="review">${icon('list-checks')}Cocokkan penjualan</button></div>`:'';
}
function saleRepaymentReviewForm(saleId){
  const pending=saleRepaymentPlans(snapshot()).rows.filter(r=>r.reason),current=pending.find(r=>r.sale.id===saleId)||pending[0];
  const choices=current?cardPayments.filter(p=>!p.installmentChargeId&&!isSaleRepayment(p)&&p.cardId===current.charge?.cardId&&p.date>=current.sale.date&&p.date<=TODAY&&cents(p.amount)>sum(p.saleAllocations||[],a=>cents(a.amount))):[];
  openDrawer('Cocokkan pembayaran penjualan',`${current?`<form id="saleRepaymentMatchForm">${selectField('Penjualan','saleId',pending.map(r=>`<option value="${r.sale.id}" ${current.sale.id===r.sale.id?'selected':''}>${esc(productById(r.sale.productId)?.name||r.sale.id)} / ${r.sale.id}</option>`).join(''))}<p class="stock-edit-note">${esc(current.reason)}</p><div class="detail-lines">${bookLine('HPP / dana cair yang dialokasikan',current.target)}${bookLine('Sudah dicocokkan',current.matched)}${bookLine('Otomatis tercatat',current.amount)}</div>${selectField('Pembayaran yang sudah tercatat','paymentId','<option value="">Pilih pembayaran</option>'+choices.map(p=>`<option value="${p.id}">${cardDate(p.date)} / ${installmentCurrency(p.amount)} / ${esc(p.note)}</option>`).join(''))}${field('Nominal yang dicocokkan (Rp)','amount','number',Math.max(0,current.target-current.matched-current.amount),'required min="0.01" step="0.01"')}<p class="cash-note">Menautkan pembayaran yang sudah ada, tanpa menambahkan pembayaran baru.</p>${formFooter('Tautkan pembayaran')}</form>`:'<p>Tidak ada penjualan yang perlu dicocokkan.</p>'}${(business.salePaymentSkips||[]).length?`<details class="repayment-review-list"><summary>Otomatis dihentikan (${business.salePaymentSkips.length})</summary>${business.salePaymentSkips.map(id=>`<div class="expense-row"><span>${esc(id)}</span><button class="icon-button" data-sale-repay="restore" data-id="${id}" title="Aktifkan kembali" aria-label="Aktifkan kembali ${id}">${icon('rotate-ccw')}</button></div>`).join('')}</details>`:''}`,'PEMBAYARAN TAGIHAN BIASA');
}
function matchSaleRepayment(state,d){
  const next=structuredClone(state),r=saleRepaymentPlans(next).rows.find(r=>r.sale.id===d.saleId),p=next.cardPayments.find(p=>p.id===d.paymentId),amount=Number(d.amount);
  if(!r?.charge||!p||p.installmentChargeId||isSaleRepayment(p)||p.cardId!==r.charge.cardId||p.date<r.sale.date||p.date>TODAY||!installmentMoney(amount)||amount<=0||cents(amount)>cents(r.target-r.matched-r.amount)||cents(amount)+sum(p.saleAllocations||[],a=>cents(a.amount))>cents(p.amount))throw Error('Pilih pembayaran pada kartu yang sama, setelah penjualan, dengan nominal yang belum dialokasikan.');
  p.saleAllocations??=[];const allocation=p.saleAllocations.find(a=>a.saleId===r.sale.id&&a.chargeId===r.charge.id);
  if(allocation)allocation.amount=rupiah(cents(allocation.amount)+cents(amount));else p.saleAllocations.push({saleId:r.sale.id,chargeId:r.charge.id,amount});
  reconcileSaleCardPayments(next);validateSnapshot(next);return next;
}
function saleRepaymentCorrectionForm(id){
  const p=cardPayments.find(p=>p.id===id&&isSaleRepayment(p));if(!p)return;
  openDrawer('Edit pembayaran penjualan',`<form id="saleRepaymentCorrectionForm" data-id="${id}"><p>${esc(cardName(p.cardId))} / ${esc(p.saleId)}</p>${field('Tanggal bayar','date','date',p.date,`required min="${sales.find(s=>s.id===p.saleId).date}" max="${TODAY}"`)}${field('Nominal pembayaran (Rp)','amount','number',p.amount,`required min="0.01" max="${p.amount}" step="0.01"`)}${field('Keterangan','note','text',p.note,'required maxlength="200"')}${formFooter('Simpan pembayaran')}</form>`,'PEMBAYARAN TAGIHAN BIASA');
}
function validateSaleRepayments(state){
  const allocated=new Set();
  for(const p of state.cardPayments){
    if(p.saleAllocations!==undefined){
      if(!Array.isArray(p.saleAllocations)||p.installmentChargeId||sum(p.saleAllocations,a=>cents(a.amount))>cents(p.amount))throw Error('Alokasi pembayaran melebihi pembayaran kartu.');
      for(const a of p.saleAllocations){const s=state.sales.find(s=>s.id===a.saleId),c=state.cardCharges.find(c=>c.id===a.chargeId);if(!s||!c||c.installment||c.cardId!==p.cardId||c.productId!==s.productId||!installmentMoney(a.amount)||a.amount<=0||allocated.has(p.id+':'+a.saleId))throw Error('Alokasi pembayaran penjualan tidak valid.');allocated.add(p.id+':'+a.saleId);}
    }
    if(isSaleRepayment(p)&&(!state.sales.some(s=>s.id===p.saleId)||!state.cardCharges.some(c=>c.id===p.purchaseChargeId&&c.cardId===p.cardId)||!installmentMoney(p.amount)||p.amount<=0))throw Error('Pembayaran otomatis penjualan tidak valid.');
  }
  for(const s of state.sales)if(s.settlementDate&&(!CardSchedule.validDate(s.settlementDate)||s.settlementDate<s.date||s.settlementDate>TODAY))throw Error('Tanggal pencairan penjualan tidak valid.');
  if(state.business.salePaymentSkips!==undefined&&(!Array.isArray(state.business.salePaymentSkips)||state.business.salePaymentSkips.some(id=>typeof id!=='string')))throw Error('Pengecualian pembayaran penjualan tidak valid.');
  if(state.business.salePaymentCorrections!==undefined){if(!Array.isArray(state.business.salePaymentCorrections))throw Error('Koreksi pembayaran penjualan tidak valid.');for(const r of state.business.salePaymentCorrections)if(!state.sales.some(s=>s.id===r.saleId)||!CardSchedule.validDate(r.date)||r.date>TODAY||!installmentMoney(r.amount)||r.amount<=0||typeof r.note!=='string'||r.note.length>200)throw Error('Koreksi pembayaran penjualan tidak valid.');}
}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-sale-repay]');if(!a)return;
  if(a.dataset.saleRepay==='review')saleRepaymentReviewForm();
  if(a.dataset.saleRepay==='restore'){business.salePaymentSkips=(business.salePaymentSkips||[]).filter(id=>id!==a.dataset.id);saveDemo();closeDrawer();render();}
});
document.addEventListener('change',e=>{if(e.target.form?.id==='saleRepaymentMatchForm'&&e.target.name==='saleId')saleRepaymentReviewForm(e.target.value);});
document.addEventListener('submit',async e=>{
  const f=e.target;if(!['saleRepaymentMatchForm','saleRepaymentCorrectionForm'].includes(f.id))return;e.preventDefault();if(f.dataset.saving)return;
  f.dataset.saving='true';const button=f.querySelector('[type="submit"]');button.disabled=true;let saving=false;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap.');const d=Object.fromEntries(new FormData(f));let next;
    if(f.id==='saleRepaymentMatchForm')next=matchSaleRepayment(snapshot(),d);
    else{
      next=structuredClone(snapshot());const p=next.cardPayments.find(p=>p.id===f.dataset.id&&isSaleRepayment(p)),s=next.sales.find(s=>s.id===p?.saleId),amount=Number(d.amount);
      if(!p||!CardSchedule.validDate(d.date)||d.date<s.date||d.date>TODAY||!installmentMoney(amount)||amount<=0||amount>p.amount||!d.note.trim()||d.note.length>200)throw Error('Periksa tanggal, nominal, dan keterangan pembayaran.');
      next.business.salePaymentCorrections=(next.business.salePaymentCorrections||[]).filter(r=>r.saleId!==s.id);next.business.salePaymentCorrections.push({saleId:s.id,date:d.date,amount,note:d.note.trim()});reconcileSaleCardPayments(next);validateSnapshot(next);
    }
    savePending++;saving=true;updateStorageBadge();await persist(next);applyState(next);closeDrawer();render();toast('Pembayaran penjualan diperbarui.');
  }catch(err){formError(err.message);}finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
