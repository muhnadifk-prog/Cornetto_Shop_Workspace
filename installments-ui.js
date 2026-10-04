'use strict';
let installmentFilter='active',installmentMonth=TODAY.slice(0,7);
const installmentCurrency=n=>'Rp '+rupiah(cents(n)).toLocaleString('id-ID',{maximumFractionDigits:2});
const installmentBookLine=(label,value,total=false)=>bookLine(label,value,total,installmentCurrency);
function installmentInterestLabel(mode){return mode==='flat'?'Bunga flat per bulan (%)':mode==='monthly'?'Cicilan per bulan, di luar admin (Rp)':'Total bunga dari bank (Rp)';}
function installmentFormData(f){
  const d=Object.fromEntries(new FormData(f));
  if(d.interestMode==='schedule'){
    d.admin=0;d.adminMode='first';d.interestValue=0;
    d.customRows=Array.from({length:Number(d.months)},(_,i)=>Object.fromEntries(['principal','interest','admin'].map(key=>[key,Number(f.elements['bank_'+key+'_'+i]?.value)])));
  }
  return d;
}
function bankScheduleFields(f,seed){
  const months=Number(f.elements.months.value),box=f.querySelector('[data-bank-schedule]');
  if(f.elements.interestMode.value!=='schedule'||!Number.isInteger(months)||months<1||months>36)return;
  if(Number(box.dataset.months)===months&&box.childElementCount)return;
  const c=cardCharges.find(c=>c.id===f.elements.chargeId?.value),principal=f.id==='stockForm'?Number(f.elements.qty.value)*Number(f.elements.cost.value):c?.amount||0;
  const rows=seed||c?.installment?.customRows;
  box.dataset.months=months;
  box.innerHTML=`<div class="module-table bank-schedule-table"><table><thead><tr><th>Bulan</th><th>Pokok (Rp)</th><th>Bunga (Rp)</th><th>Admin (Rp)</th></tr></thead><tbody>${Array.from({length:months},(_,i)=>`<tr><td>${i+1}</td>${['principal','interest','admin'].map(key=>`<td><input type="number" name="bank_${key}_${i}" aria-label="${key==='principal'?'Pokok':key==='interest'?'Bunga':'Admin'} bulan ${i+1}" value="${rows?.[i]?.[key]??(key==='principal'?splitInstallment(principal,months,i):key==='admin'&&(f.elements.adminMode.value==='monthly'||i===0)?Number(f.elements.admin.value):0)}" required min="0" max="1000000000000" step="0.01"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function installmentFields(plan={},card){
  const day=plan.statementDay||card?.statementDay||'',offset=plan.dueAfterDays||card?.dueAfterDays||'';
  let month=plan.firstMonth||TODAY.slice(0,7);
  if(!plan.firstMonth&&day&&statementOn(month,day)<TODAY)month=statementOn(month,1,1).slice(0,7);
  const selected=(key,value)=>plan[key]===value?'selected':'';
  return `<div class="field-pair">${field('Tenor (bulan)','months','number',plan.months||12,'required min="1" max="36" step="1"')}${field('Bulan cetak pertama','firstMonth','month',month,'required min="2000-01" max="2099-12"')}</div>
    <div class="field-pair">${field('Tanggal cetak bulanan','statementDay','number',day,'required min="1" max="31" step="1"')}${field('Jatuh tempo H+ (hari kalender)','dueAfterDays','number',offset,'required min="1" max="60" step="1"')}</div>
    <div class="field-pair">${selectField('Biaya admin','adminMode',`<option value="first">Sekali, tagihan pertama</option><option value="monthly" ${selected('adminMode','monthly')}>Setiap bulan</option>`)}${field('Nominal admin (Rp)','admin','number',plan.admin||0,'required min="0" step="0.01"')}</div>
    ${selectField('Bunga / nominal bank','interestMode',`<option value="none">Tanpa bunga</option><option value="flat" ${selected('interestMode','flat')}>Bunga flat per bulan (%)</option><option value="monthly" ${selected('interestMode','monthly')}>Nominal cicilan bulanan dari bank</option><option value="total" ${selected('interestMode','total')}>Total bunga dari bank (Rp)</option><option value="schedule" ${selected('interestMode','schedule')}>Rincian bank per bulan</option>`)}
    <div data-interest-value ${!plan.interestMode||['none','schedule'].includes(plan.interestMode)?'hidden':''}>${field(installmentInterestLabel(plan.interestMode),'interestValue','number',plan.interestValue||0,!plan.interestMode||['none','schedule'].includes(plan.interestMode)?'disabled':'required min="0" step="0.01"')}</div>
    <div data-bank-schedule hidden></div>
    <div class="installment-preview" data-install-preview></div>`;
}
function stockInstallmentFields(){return `<section class="form-section" data-stock-credit hidden>${selectField('Skema pembayaran kartu','creditMode','<option value="full">Tagihan biasa</option><option value="installment">Cicilan</option>')}<div data-stock-installment hidden>${installmentFields()}</div></section>`;}
function updateInstallmentFields(f){
  const stock=f.id==='stockForm',card=cards.find(c=>c.id===f.elements.payMethod?.value),active=!stock||(!!card&&f.elements.creditMode.value==='installment');
  if(stock){f.querySelector('[data-stock-credit]').hidden=!card;f.elements.creditMode.disabled=!card;f.querySelector('[data-stock-installment]').hidden=!active;}
  const box=stock?f.querySelector('[data-stock-installment]'):f.querySelector('[data-plan-fields]');
  if(!box)return;
  bankScheduleFields(f);
  box.querySelectorAll('input,select').forEach(input=>{input.disabled=!active;});
  const mode=f.elements.interestMode.value,input=f.elements.interestValue;
  input.disabled=!active||['none','schedule'].includes(mode);input.required=!input.disabled;
  f.querySelector('[data-interest-value]').hidden=['none','schedule'].includes(mode);
  f.querySelector('[data-bank-schedule]').hidden=mode!=='schedule';
  f.querySelectorAll('[data-bank-schedule] input').forEach(input=>{input.disabled=!active||mode!=='schedule';});
  for(const name of ['admin','adminMode'])f.elements[name].disabled=!active||mode==='schedule';
  input.closest('label').querySelector('span').textContent=installmentInterestLabel(mode);
  input.max=mode==='flat'?'100':'1000000000000';
  const preview=f.querySelector('[data-install-preview]');preview.innerHTML='';if(!active)return;
  try{
    const c=cardCharges.find(c=>c.id===f.elements.chargeId?.value),principal=stock?Number(f.elements.qty.value)*Number(f.elements.cost.value):c?.amount;
    const plan=buildInstallment(principal,installmentFormData(f));
    const total=sum(plan.schedule,installmentRowTotal);
    preview.innerHTML=`<div class="estimate"><span>Pokok pembelian</span><strong>${installmentCurrency(principal)}</strong></div><div class="estimate"><span>Admin + bunga seluruh tenor</span><strong>${installmentCurrency(total-principal)}</strong></div><div class="estimate"><span>Total pembayaran terjadwal</span><strong>${installmentCurrency(total)}</strong></div><div class="estimate"><span>Tagihan pertama / ${cardDate(plan.schedule[0].dueDate)}</span><strong>${installmentCurrency(installmentRowTotal(plan.schedule[0]))}</strong></div>`;
  }catch(err){preview.innerHTML=`<p class="muted">${esc(err.message)}</p>`;}
}
function installmentForm(id){
  const old=cardCharges.find(c=>c.id===id),sources=old?[old]:cardCharges.filter(c=>!c.installment&&cards.some(card=>card.id===c.cardId&&!card.legacyAllocation)&&c.amount<=ordinaryCardBalance(c.cardId)+0.000001);
  if(!sources.length){toast('Belum ada pembelian kartu yang dapat dijadikan cicilan.');return;}
  const c=old||sources[0],card=cards.find(card=>card.id===c.cardId);
  openDrawer(c.installment?'Edit cicilan':'Atur cicilan',`<form id="installmentForm" data-id="${esc(c.id)}">
    ${old?`<input type="hidden" name="chargeId" value="${esc(c.id)}"><div class="detail-lines"><strong>${esc(c.note)}</strong>${installmentBookLine(cardName(c.cardId),c.amount)}</div>`:selectField('Pembelian stok','chargeId',sources.map(row=>`<option value="${esc(row.id)}">${esc(cardName(row.cardId)+' / '+row.note)} / ${installmentCurrency(row.amount)}</option>`).join(''))}
    <section class="form-section" data-plan-fields>${installmentFields(c.installment,card)}</section>
    ${formFooter('Simpan cicilan')}</form>`,'CICILAN KARTU');
  updateInstallmentFields(el('installmentForm'));
}
function installmentView(){
  const plans=installmentCharges().filter(c=>(selectedCard==='all'||c.cardId===selectedCard)&&(installmentFilter==='all'||(installmentFilter==='paid')===c.installment.schedule.every(r=>installmentRemaining(c,r)<=0)));
  const monthly=installmentUpcoming().filter(({charge,row})=>row.dueDate.startsWith(installmentMonth)&&(selectedCard==='all'||charge.cardId===selectedCard));
  return `<div class="section-heading"><h2>Cicilan pembelian</h2><div class="heading-actions"><button class="icon-button" data-install-action="export" title="Ekspor jadwal cicilan" aria-label="Ekspor jadwal cicilan">${icon('download')}</button><button class="button" data-install-action="add">${icon('plus')}Atur cicilan</button></div></div>
    <div class="table-toolbar"><div class="filters"><select id="paymentCard" aria-label="Filter kartu"><option value="all">Semua kartu</option>${cards.filter(c=>!c.legacyAllocation).map(c=>`<option value="${c.id}" ${c.id===selectedCard?'selected':''}>${esc(cardName(c.id))}</option>`).join('')}</select><select id="installmentFilter" aria-label="Status cicilan">${[['active','Belum lunas'],['paid','Lunas'],['all','Semua cicilan']].map(([id,label])=>`<option value="${id}" ${installmentFilter===id?'selected':''}>${label}</option>`).join('')}</select><input type="month" id="installmentMonth" aria-label="Bulan tagihan cicilan" value="${installmentMonth}"></div></div>
    <div class="module-banner"><div>${icon('calendar-clock')}<span>Sisa tagihan jatuh tempo ${esc(installmentMonth)} <strong>${installmentCurrency(sum(monthly,({charge,row})=>installmentRemaining(charge,row)))}</strong></span></div><span>${monthly.length} angsuran</span></div>
    <div class="module-table"><table><thead><tr><th>Pembelian</th><th>Kartu</th><th>Progres</th><th class="numeric">Sisa seluruh jadwal</th><th>Jatuh tempo berikutnya</th><th></th></tr></thead><tbody>${plans.map(c=>{
      const rows=c.installment.schedule,paid=rows.filter(r=>installmentRemaining(c,r)<=0).length,next=rows.find(r=>installmentRemaining(c,r)>0);
      return `<tr><td><strong>${esc(c.note)}</strong><div class="product-sub">Pokok ${installmentCurrency(c.amount)}</div></td><td>${esc(cardName(c.cardId))}</td><td>${paid} / ${rows.length} lunas</td><td class="numeric">${installmentCurrency(sum(rows,r=>installmentRemaining(c,r)))}</td><td>${next?cardDate(next.dueDate):'Lunas'}</td><td><button class="icon-button" data-install-action="detail" data-id="${c.id}" aria-label="Rincian cicilan ${esc(c.note)}" title="Rincian cicilan">${icon('arrow-up-right')}</button></td></tr>`;
    }).join('')||'<tr><td colspan="6" class="empty">Belum ada cicilan pada filter ini.</td></tr>'}</tbody></table></div>`;
}
function installmentDetail(id){
  const c=cardCharges.find(c=>c.id===id&&c.installment);if(!c)return;
  const rows=c.installment.schedule,paid=sum(cardPayments.filter(p=>p.installmentChargeId===id),p=>p.amount);
  openDrawer(c.note,`<p>${esc(cardName(c.cardId))}</p><div class="detail-lines">${installmentBookLine('Pokok pembelian',c.amount)}${installmentBookLine('Admin seluruh tenor',sum(rows,r=>r.admin))}${installmentBookLine('Bunga seluruh tenor',sum(rows,r=>r.interest))}${installmentBookLine('Pembayaran tercatat',paid)}${installmentBookLine('Sisa seluruh jadwal',sum(rows,r=>installmentRemaining(c,r)),true)}</div>
    <div class="section-heading"><h3>Jadwal ${rows.length} bulan</h3><button class="icon-button" data-install-action="edit" data-id="${id}" ${paid>0?'disabled':''} title="Edit cicilan" aria-label="Edit cicilan">${icon('pencil')}</button><button class="icon-button" data-install-action="remove" data-id="${id}" ${paid>0?'disabled':''} title="Hapus jadwal cicilan" aria-label="Hapus jadwal cicilan">${icon('trash-2')}</button></div>
    <div class="module-table installment-schedule"><table><thead><tr><th>Ke</th><th>Cetak</th><th>Jatuh tempo</th><th>Pokok</th><th>Bunga</th><th>Admin</th><th>Sisa</th><th></th></tr></thead><tbody>${rows.map(r=>{const remaining=installmentRemaining(c,r);return `<tr><td>${r.number}</td><td>${cardDate(r.statementDate)}</td><td>${cardDate(r.dueDate)}</td><td>${installmentCurrency(r.principal)}</td><td>${installmentCurrency(r.interest)}</td><td>${installmentCurrency(r.admin)}</td><td>${remaining?installmentCurrency(remaining):'<span class="badge">Lunas</span>'}</td><td><button class="icon-button" data-install-action="pay" data-id="${id}" data-number="${r.number}" ${remaining<=0||r.statementDate>TODAY?'disabled':''} title="Catat pembayaran angsuran ${r.number}" aria-label="Catat pembayaran angsuran ${r.number}">${icon('wallet')}</button></td></tr>`;}).join('')}</tbody></table></div>`,'CICILAN KARTU');
}
function installmentPaymentForm(chargeId,number,paymentId){
  const old=cardPayments.find(p=>p.id===paymentId),c=cardCharges.find(c=>c.id===(old?.installmentChargeId||chargeId)),row=c?.installment?.schedule.find(r=>r.number===Number(old?.installmentNumber||number));
  if(!row)return;
  const remaining=installmentRemaining(c,row,paymentId);
  openDrawer(old?'Edit pembayaran cicilan':'Bayar cicilan',`<form id="installmentPaymentForm" data-id="${paymentId||''}"><input type="hidden" name="chargeId" value="${c.id}"><input type="hidden" name="number" value="${row.number}"><p>${esc(cardName(c.cardId))} / ${esc(c.note)}</p><div class="detail-lines">${installmentBookLine('Angsuran '+row.number+' / '+c.installment.months,installmentRowTotal(row))}${installmentBookLine('Sisa angsuran',remaining)}</div>${field('Tanggal bayar','date','date',old?.date||TODAY,`required min="${row.statementDate}" max="${TODAY}"`)}${field('Nominal pembayaran (Rp)','amount','number',old?.amount||remaining,`required min="0.01" step="0.01" max="${remaining}"`)}${field('Keterangan','note','text',old?.note||'Cicilan '+row.number+'/'+c.installment.months,'maxlength="120"')}${formFooter('Simpan pembayaran')}</form>`,'PEMBAYARAN CICILAN');
}
function routeInstallmentPayment(cardId,paymentId,ordinary){
  const old=cardPayments.find(p=>p.id===paymentId);
  if(old?.installmentChargeId){installmentPaymentForm(null,null,paymentId);return true;}
  if(ordinary||old||!installmentCharges().some(c=>!cardId||c.cardId===cardId))return false;
  const rows=installmentUpcoming().filter(({charge,row})=>(!cardId||charge.cardId===cardId)&&row.statementDate<=TODAY);
  const regular=cards.filter(c=>(!cardId||c.id===cardId)&&ordinaryCardBalance(c.id)>0);
  openDrawer('Pilih tagihan',`${regular.map(c=>`<div class="expense-row"><div><strong>${esc(cardName(c.id))}</strong><p>Tagihan biasa / ${installmentCurrency(ordinaryCardBalance(c.id))}</p></div><button class="icon-button" data-install-action="ordinary-pay" data-id="${c.id}" title="Bayar tagihan biasa" aria-label="Bayar tagihan biasa ${esc(cardName(c.id))}">${icon('wallet')}</button></div>`).join('')}${rows.map(({charge,row})=>`<div class="expense-row"><div><strong>${esc(charge.note)}</strong><p>${esc(cardName(charge.cardId))} / ${row.number} dari ${charge.installment.months} / ${cardDate(row.dueDate)} / ${installmentCurrency(installmentRemaining(charge,row))}</p></div><button class="icon-button" data-install-action="pay" data-id="${charge.id}" data-number="${row.number}" title="Bayar cicilan" aria-label="Bayar cicilan ${row.number} ${esc(charge.note)}">${icon('wallet')}</button></div>`).join('')}${!rows.length&&!regular.length?emptyState('Belum ada tagihan yang sudah tercetak.'):''}`,'PEMBAYARAN KARTU');
  return true;
}
function exportInstallments(){
  const rows=[['Kartu','Pembelian','Angsuran','Cetak','Jatuh tempo','Pokok','Bunga','Admin','Total','Dibayar','Sisa']];
  for(const c of installmentCharges().filter(c=>selectedCard==='all'||c.cardId===selectedCard))for(const r of c.installment.schedule)rows.push([cardName(c.cardId),c.note,r.number,r.statementDate,r.dueDate,r.principal,r.interest,r.admin,installmentRowTotal(r),installmentPaid(c.id,r.number),installmentRemaining(c,r)]);
  downloadData('cicilan-kartu_'+TODAY+'.csv','\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-install-action]');if(!a)return;
  const {installAction:action,id,number}=a.dataset;
  if(action==='add')installmentForm();
  if(action==='edit')installmentForm(id);
  if(action==='detail')installmentDetail(id);
  if(action==='pay')installmentPaymentForm(id,number);
  if(action==='ordinary-pay')paymentForm(id,null,true);
  if(action==='export')exportInstallments();
  if(action==='remove')openDrawer('Hapus jadwal cicilan?',`<p>Pokok pembelian dan stok tetap tercatat. Jadwal beserta biaya admin dan bunganya dibatalkan.</p><div class="form-footer"><button class="button" data-action="cancel">Batal</button><button class="button primary" data-install-action="confirm-remove" data-id="${id}">Hapus jadwal</button></div>`,'KONFIRMASI');
  if(action==='confirm-remove'){try{removeInstallment(id);finishModule('Jadwal dihapus; pokok pembelian tetap tercatat.');}catch(err){toast(err.message);}}
});
for(const event of ['input','change'])document.addEventListener(event,e=>{
  const f=e.target.form;
  if(f?.id==='stockForm'&&f.querySelector('[data-stock-credit]')){
    if(e.target.name==='payMethod'){const c=cards.find(c=>c.id===e.target.value);if(c){f.elements.statementDay.value=c.statementDay||'';f.elements.dueAfterDays.value=c.dueAfterDays||'';const month=TODAY.slice(0,7);f.elements.firstMonth.value=c.statementDay&&statementOn(month,c.statementDay)<TODAY?statementOn(month,1,1).slice(0,7):month;}}
    updateInstallmentFields(f);
  }
  if(f?.id==='installmentForm'){
    if(e.target.name==='chargeId'){const c=cardCharges.find(c=>c.id===e.target.value),card=cards.find(card=>card.id===c?.cardId);f.querySelector('[data-plan-fields]').innerHTML=installmentFields(c?.installment,card);}
    updateInstallmentFields(f);
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='installmentFilter'){installmentFilter=e.target.value;render();}
  if(e.target.id==='installmentMonth'){installmentMonth=e.target.value||TODAY.slice(0,7);render();}
});
document.addEventListener('submit',e=>{
  const f=e.target;if(!['installmentForm','installmentPaymentForm'].includes(f.id))return;e.preventDefault();
  const d=f.id==='installmentForm'?installmentFormData(f):Object.fromEntries(new FormData(f));
  try{if(f.id==='installmentForm')attachInstallment(d.chargeId,d);else commitInstallmentPayment(d,f.dataset.id);finishModule(f.id==='installmentForm'?'Jadwal cicilan tersimpan.':'Pembayaran cicilan tersimpan.');}catch(err){formError(err.message);}
});

