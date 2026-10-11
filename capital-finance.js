'use strict';
function capitalTotals(state,end=TODAY,start='0001-01-01'){
  const total=(type,from)=>sum(state.ledger.filter(r=>r.type===type&&r.date>=from&&r.date<=end),r=>r.amount);
  const deposited=total('modal','0001-01-01'),withdrawn=total('prive','0001-01-01');
  return {deposited,withdrawn,net:deposited-withdrawn,periodDeposits:total('modal',start),periodWithdrawals:total('prive',start),periodLoans:total('pinjam',start)};
}
function capitalSummaryView(){
  const m=capitalTotals(snapshot(),periodEnd(),periodStart());
  return `<section class="capital-summary" aria-label="Posisi modal tercatat"><div class="section-heading"><h2>Modal & pendanaan</h2><span class="muted">s.d. ${dayFirstDate(periodEnd())}</span></div><div class="capital-values">${[['Modal disetor',m.deposited],['Prive',m.withdrawn],['Setoran neto',m.net],['Pinjaman diterima / periode',m.periodLoans]].map(([name,n])=>`<div><span>${name}</span><strong>${money(n)}</strong></div>`).join('')}</div></section>`;
}
function capitalForm(id=''){
  const old=ledger.find(r=>r.id===id);if(id&&!old)return;
  openDrawer(old?'Hubungkan pinjaman ke kartu':'Catat modal & pinjaman',`<form id="capitalForm" data-id="${id}">${selectField('Jenis','type',Object.entries(ledgerLabels).map(([key,label])=>`<option value="${key}" ${key===(old?.type||'modal')?'selected':''}>${label}</option>`).join(''))}${field('Tanggal','date','date',old?.date||TODAY,`required min="2000-01-01" max="${TODAY}"`)}${field('Nominal diterima / dibayar (Rp)','amount','number',old?.amount||'','required min="0.01" step="0.01"')}${field('Keterangan','note','text',old?.note||'','required maxlength="200"')}<section data-loan-source hidden>${selectField('Sumber pinjaman','loanSource','<option value="other">Pinjaman lain</option>'+cards.filter(c=>c.active&&!c.legacyAllocation).sort((a,b)=>cardName(a.id).localeCompare(cardName(b.id),'id')).map(c=>`<option value="${c.id}">${esc(cardName(c.id))}</option>`).join(''))}<div data-loan-credit hidden>${selectField('Skema tagihan','creditMode','<option value="full">Tagihan biasa</option><option value="installment">Cicilan</option>')}<input type="hidden" name="principal"><section data-plan-fields>${installmentFields()}</section><label class="purchase-finance-option" data-loan-auto><input type="checkbox" name="autoPost" checked><span>Catat pembayaran cicilan otomatis saat jatuh tempo sebagai asumsi pemilik.</span></label></div></section><p class="book-edit-notice" data-loan-notice hidden>Nominal penerimaan dicatat sekali sebagai pinjaman dan utang kartu, bukan omzet atau modal disetor.</p>${formFooter(old?'Hubungkan pinjaman':'Simpan mutasi')}</form>`,'PEMBUKUAN');
  const f=el('capitalForm');f.dataset.baseline=old?bookBaseline('ledger:'+id):'';
  if(old)f.elements.type.disabled=true;updateCapitalForm(f,true);
}
function updateCapitalForm(f,cardChanged=false){
  const loan=f.elements.type.value==='pinjam',card=cards.find(c=>c.id===f.elements.loanSource.value),credit=loan&&!!card,plan=credit&&f.elements.creditMode.value==='installment';
  f.querySelector('[data-loan-source]').hidden=!loan;f.elements.loanSource.disabled=!loan;
  f.querySelector('[data-loan-credit]').hidden=!credit;f.elements.creditMode.disabled=!credit;
  f.querySelector('[data-plan-fields]').hidden=!plan;f.querySelector('[data-loan-auto]').hidden=!plan;f.elements.autoPost.disabled=!plan;
  f.querySelector('[data-loan-notice]').hidden=!credit;f.elements.principal.value=f.elements.amount.value;
  if(cardChanged&&card){
    f.elements.statementDay.value=card.statementDay||'';f.elements.dueAfterDays.value=card.dueAfterDays||'';
    const purchase=f.elements.date.value,month=purchase.slice(0,7);
    if(CardSchedule.validDate(purchase))f.elements.firstMonth.value=card.statementDay&&statementOn(month,card.statementDay)<purchase?statementOn(month,1,1).slice(0,7):month;
  }
  if(plan)updateInstallmentFields(f);
  else f.querySelectorAll('[data-plan-fields] input,[data-plan-fields] select').forEach(input=>input.disabled=true);
  syncMoneyInputs(f);if(typeof syncDateControls==='function')syncDateControls(f);
}
function prepareCapitalRecord(state,d,id='',baseline=''){
  const next=structuredClone(state),old=next.ledger.find(r=>r.id===id),amount=Number(d.amount),type=old?.type||d.type;
  if(id&&(!old||bookBaseline('ledger:'+id,state)!==baseline||old.chargeId||old.paymentId||old.type!=='pinjam'))throw Error('Pinjaman berubah atau sudah terhubung. Buka ulang catatan.');
  if(!Object.hasOwn(ledgerLabels,type)||!CardSchedule.validDate(d.date)||d.date<'2000-01-01'||d.date>TODAY||!installmentMoney(amount)||amount<=0||typeof d.note!=='string'||!d.note.trim()||d.note.length>200)throw Error('Periksa jenis, tanggal, nominal, dan keterangan.');
  const record=old||{id:nextId('ledger')};Object.assign(record,{type,date:d.date,amount,note:d.note.trim()});
  if(type==='pinjam'&&d.loanSource!=='other'){
    const card=next.cards.find(c=>c.id===d.loanSource&&c.active&&!c.legacyAllocation);if(!card)throw Error('Pilih kartu kredit yang aktif.');
    const charge={id:nextId('charge'),cardId:card.id,date:d.date,amount,note:d.note.trim(),source:'cash-loan'};
    if(d.creditMode==='installment'){
      charge.installment=buildInstallment(amount,d);charge.autoPost=d.autoPost===true||d.autoPost==='on';charge.autoSkip=[];
      if(charge.installment.schedule[0].statementDate<d.date)throw Error('Tanggal cetak pertama tidak boleh sebelum penerimaan pinjaman.');
    }
    next.cardCharges.push(charge);Object.assign(record,{cardId:card.id,chargeId:charge.id,source:'card-cash-loan'});
  }else if(id)throw Error('Pilih kartu untuk menghubungkan pinjaman lama.');
  if(!old)next.ledger.push(record);validateSnapshot(next);return next;
}
document.addEventListener('click',e=>{const a=e.target.closest('[data-link-loan]');if(a)capitalForm(a.dataset.linkLoan);});
document.addEventListener('input',e=>{if(e.target.form?.id==='capitalForm')updateCapitalForm(e.target.form);});
document.addEventListener('change',e=>{if(e.target.form?.id==='capitalForm')updateCapitalForm(e.target.form,['loanSource','date'].includes(e.target.name)||!!e.target.dataset.calendarDisplay);});
document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id!=='capitalForm')return;e.preventDefault();if(f.dataset.saving)return;
  const button=f.querySelector('[type="submit"]');f.dataset.saving='true';button.disabled=true;let saving=false;
  try{await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap.');const d=installmentFormData(f);d.type=f.elements.type.value;const next=prepareCapitalRecord(snapshot(),d,f.dataset.id,f.dataset.baseline);savePending++;saving=true;updateStorageBadge();await persist(next);applyState(next);closeDrawer();render();toast('Mutasi dan pembiayaan tersimpan.');}catch(err){formError(err.message);}finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
