'use strict';
function purchaseFinanceBaseline(productId){return JSON.stringify({product:productById(productId),charges:cardCharges.filter(c=>c.productId===productId)});}
function commitPurchaseFinance(productId,data,baseline){
  const p=productById(productId),existing=cardCharges.filter(c=>c.productId===productId),card=cards.find(c=>c.id===data.cardId&&c.active&&!c.legacyAllocation);
  if(!p||purchaseFinanceBaseline(productId)!==baseline)throw Error('Pembelian berubah. Buka ulang pengaturan cicilan.');
  if(existing.length>1)throw Error('Pembelian memiliki lebih dari satu catatan kartu. Periksa rincian sebelum mengubah pembiayaan.');
  const charge=existing[0],amount=charge?.amount??p.cost*p.purchasedQty;
  if(!card||!CardSchedule.validDate(p.date))throw Error('Pilih kartu dan tanggal pembelian yang valid.');
  if(charge?.installment||cardPayments.some(pay=>pay.installmentChargeId===charge?.id))throw Error('Pembelian sudah memiliki jadwal cicilan. Buka rincian cicilan untuk mengubahnya.');
  if(charge&&charge.amount>ordinaryCardBalance(charge.cardId)+0.000001)throw Error('Pembayaran lama belum dialokasikan. Periksa sisa pokok agar utang tidak tercatat ganda.');
  const plan=buildInstallment(amount,data);
  if(plan.schedule[0].statementDate<p.date)throw Error('Cetak pertama tidak boleh mendahului tanggal pembelian.');
  const oldCard=cards.find(c=>c.id===charge?.cardId),sameFacility=oldCard&&(oldCard.id===card.id||(oldCard.groupId&&oldCard.groupId===card.groupId));
  if(amount+installmentFees({installment:plan})>availableCardLimit(card)+(sameFacility?amount:0)+0.000001)throw Error('Sisa limit kartu tidak cukup.');
  const next=charge||{id:nextId('charge'),productId:p.id,date:p.date,amount,note:p.name+' / '+p.purchasedQty+' unit'};
  next.cardId=card.id;next.installment=plan;next.autoPost=data.autoPost===true;next.autoSkip=[];p.payMethod=card.id;
  if(!charge)cardCharges.push(next);
}
function purchaseFinanceForm(productId){
  const p=productById(productId),existing=cardCharges.filter(c=>c.productId===productId);if(!p)return;
  if(existing[0]?.installment){installmentDetail(existing[0].id);return;}
  if(existing.length>1){toast('Ada beberapa catatan pembelian. Periksa melalui rincian kartu.');return;}
  const c=existing[0],card=cards.find(card=>card.id===(c?.cardId||p.payMethod)&&!card.legacyAllocation),amount=c?.amount??p.cost*p.purchasedQty;
  openDrawer('Cicilan pembelian',`<form id="purchaseFinanceForm" data-product="${esc(p.id)}"><div class="detail-lines"><strong>${esc(p.name)}</strong>${installmentBookLine('Pokok seluruh batch / '+p.purchasedQty+' unit',amount)}</div><input type="hidden" name="principal" value="${amount}">${c?`<input type="hidden" name="chargeId" value="${esc(c.id)}">`:''}${selectField('Kartu pembelian','cardId','<option value="">Pilih kartu</option>'+cards.filter(c=>c.active&&!c.legacyAllocation).sort((a,b)=>cardName(a.id).localeCompare(cardName(b.id),'id')).map(c=>`<option value="${c.id}" ${card?.id===c.id?'selected':''}>${esc(cardName(c.id))}</option>`).join(''))}<section class="form-section" data-plan-fields>${installmentFields({},card)}</section><label class="purchase-finance-option"><input type="checkbox" name="autoPost" checked><span>Catat pembayaran otomatis saat jatuh tempo sebagai asumsi pemilik.</span></label>${formFooter('Simpan cicilan pembelian')}</form>`,'PEMBIAYAAN STOK');
  const f=el('purchaseFinanceForm');f.dataset.baseline=purchaseFinanceBaseline(productId);updateInstallmentFields(f);
}
for(const event of ['input','change'])document.addEventListener(event,e=>{
  const f=e.target.form;if(f?.id!=='purchaseFinanceForm')return;
  if(e.target.name==='cardId'){const card=cards.find(c=>c.id===e.target.value);f.elements.statementDay.value=card?.statementDay||'';f.elements.dueAfterDays.value=card?.dueAfterDays||'';}
  updateInstallmentFields(f);
});
document.addEventListener('submit',e=>{
  const f=e.target;if(f.id!=='purchaseFinanceForm')return;e.preventDefault();
  try{commitPurchaseFinance(f.dataset.product,installmentFormData(f),f.dataset.baseline);saveDemo();closeDrawer();render();toast('Pembelian terhubung ke cicilan. Penjualan dan jumlah stok tetap.');}catch(err){formError(err.message);}
});
