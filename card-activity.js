'use strict';
let installmentPage=1,paymentPage=1,paymentMonth=TODAY.slice(0,7);
let installmentBank='';
const cardActivityPageSize=10;
function cardMonthLabel(value){return value==='all'?'Semua bulan':months[Number(value.slice(5))-1]+' '+value.slice(0,4);}
function cardMonthSelect(id,label,value,dates){
  const values=[...new Set([TODAY.slice(0,7),...(value==='all'?[]:[value]),...dates.filter(Boolean).map(d=>d.slice(0,7))])].sort().reverse();
  return `<select id="${id}" aria-label="${label}"><option value="all" ${value==='all'?'selected':''}>Semua bulan</option>${values.map(v=>`<option value="${v}" ${v===value?'selected':''}>${cardMonthLabel(v)}</option>`).join('')}</select>`;
}
const filterBankName=c=>String(c.bank||'').trim()||'Bank belum diisi';
const filterBankKey=c=>filterBankName(c).toLocaleLowerCase('id');
function selectableCards(){return cards.filter(c=>!c.deletedAt&&!c.legacyAllocation);}
function syncCardActivityFilters(useBank){
  const eligible=selectableCards();
  if(useBank&&installmentBank&&!eligible.some(c=>filterBankKey(c)===installmentBank)){installmentBank='';installmentPage=1;}
  if(selectedCard!=='all'&&!eligible.some(c=>c.id===selectedCard&&(!useBank||!installmentBank||filterBankKey(c)===installmentBank))){
    selectedCard='all';installmentPage=1;paymentPage=1;
  }
}
function installmentBankOptions(){
  const banks=new Map(selectableCards().map(c=>[filterBankKey(c),filterBankName(c)]));
  return '<option value="">Semua bank</option>'+[...banks].sort((a,b)=>a[1].localeCompare(b[1],'id')).map(([key,label])=>`<option value="${esc(key)}" ${installmentBank===key?'selected':''}>${esc(label)}</option>`).join('');
}
function cardFilterOptions(bank=''){
  return '<option value="all">Semua kartu</option>'+selectableCards().filter(c=>!bank||filterBankKey(c)===bank).sort((a,b)=>cardName(a.id).localeCompare(cardName(b.id),'id')).map(c=>`<option value="${c.id}" ${selectedCard===c.id?'selected':''}>${esc(cardName(c.id))}</option>`).join('');
}
function matchesInstallmentCard(charge){
  return (selectedCard==='all'||charge.cardId===selectedCard)&&(!installmentBank||cards.some(c=>c.id===charge.cardId&&filterBankKey(c)===installmentBank));
}
function cardActivityPage(rows,kind){
  const pages=Math.max(1,Math.ceil(rows.length/cardActivityPageSize));
  const current=Math.max(1,Math.min(kind==='installments'?installmentPage:paymentPage,pages));
  if(kind==='installments')installmentPage=current;else paymentPage=current;
  return {rows:rows.slice((current-1)*cardActivityPageSize,current*cardActivityPageSize),current,pages,total:rows.length};
}
function cardActivityPager(info,kind,label){return `<div class="table-foot card-activity-pager"><span>Menampilkan ${info.total?(info.current-1)*10+1:0}-${Math.min(info.current*10,info.total)} dari ${info.total} ${label}</span><div class="pagination"><button class="icon-button" data-credit-page="${info.current-1}" data-kind="${kind}" ${info.current===1?'disabled':''} title="Halaman sebelumnya" aria-label="Halaman sebelumnya">${icon('chevron-left')}</button><span class="page-number">${info.current}</span><span>dari ${info.pages}</span><button class="icon-button" data-credit-page="${info.current+1}" data-kind="${kind}" ${info.current===info.pages?'disabled':''} title="Halaman berikutnya" aria-label="Halaman berikutnya">${icon('chevron-right')}</button></div></div>`;}
function cardActivitySummary(items,label){return `<div class="inventory-summary card-activity-summary" role="status" aria-label="${label}">${items.map(([name,value])=>`<span>${esc(name)} <strong>${value}</strong></span>`).join('')}</div>`;}
function filteredInstallmentPlans(){
  const plans=installmentCharges().filter(c=>{
    const {months,schedule}=c.installment;
    if(installmentTenor==='short'&&months>=12||installmentTenor==='year'&&months!==12||installmentTenor==='long'&&months<=12)return false;
    return matchesInstallmentCard(c)&&(installmentFilter==='all'||(installmentFilter==='paid')===schedule.every(r=>installmentRemaining(c,r)<=0))&&(installmentMonth==='all'||schedule.some(r=>r.dueDate?.startsWith(installmentMonth)));
  });
  return plans.sort((a,b)=>{
    const delta=a.installment.months-b.installment.months;
    return (installmentTenor==='short'?delta:installmentTenor==='long'?-delta:0)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id);
  });
}
function installmentSummary(plans){
  const rows=plans.flatMap(charge=>charge.installment.schedule.map(row=>({charge,row}))),due=rows.filter(({row})=>row.dueDate&&(installmentMonth==='all'||row.dueDate.startsWith(installmentMonth)));
  return cardActivitySummary([
    ['Pembelian',plans.length],['Pokok',installmentCurrency(sum(plans,c=>c.amount))],
    ['Admin & bunga',installmentCurrency(sum(rows,({row})=>row.admin+row.interest))],
    ['Sudah dibayar',installmentCurrency(sum(rows,({charge,row})=>installmentPaid(charge.id,row.number)))],
    ['Sisa seluruh jadwal',installmentCurrency(sum(rows,({charge,row})=>installmentRemaining(charge,row)))],
    ['Angsuran / '+cardMonthLabel(installmentMonth),due.length],
    ['Sisa tagihan / '+cardMonthLabel(installmentMonth),installmentCurrency(sum(due,({charge,row})=>installmentRemaining(charge,row)))]
  ],'Ringkasan cicilan sesuai filter');
}
function cardPaymentHistoryView(){
  syncCardActivityFilters(false);
  const rows=cardPayments.filter(p=>(selectedCard==='all'||p.cardId===selectedCard)&&(paymentMonth==='all'||p.date.startsWith(paymentMonth))).slice().sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)),info=cardActivityPage(rows,'payments');
  return `<div class="table-toolbar card-activity-toolbar"><span class="subtitle">Pembayaran porsi bisnis</span><div class="filters"><select id="paymentCard" aria-label="Filter kartu">${cardFilterOptions()}</select>${cardMonthSelect('paymentMonth','Bulan pembayaran',paymentMonth,cardPayments.map(p=>p.date))}</div></div>${cardActivitySummary([['Pembayaran',rows.length],['Total',installmentCurrency(sum(rows,p=>p.amount))],['Cicilan',installmentCurrency(sum(rows.filter(p=>p.installmentChargeId),p=>p.amount))],['Tagihan biasa',installmentCurrency(sum(rows.filter(p=>!p.installmentChargeId),p=>p.amount))]],'Ringkasan pembayaran sesuai filter')}${saleRepaymentReviewButton()}
  <div class="module-table card-activity-table"><table><thead><tr><th>Tanggal</th><th>Kartu</th><th>Keterangan</th><th class="numeric">Pembayaran</th><th>Aksi</th></tr></thead><tbody>${info.rows.map(p=>`<tr><td class="date-cell">${cardDate(p.date)}</td><td>${esc(cardName(p.cardId))}</td><td>${esc(p.note)}${p.saleId?`<div class="product-sub">Penjualan ${esc(p.saleId)}</div>`:''}</td><td class="numeric green">${installmentCurrency(p.amount)}</td><td><div class="sale-actions"><button class="icon-button" data-action="edit-payment" data-id="${p.id}" aria-label="Edit pembayaran ${p.id}" title="Edit pembayaran">${icon('pencil')}</button><button class="icon-button" data-action="delete-payment" data-id="${p.id}" aria-label="Hapus pembayaran ${p.id}" title="Hapus pembayaran">${icon('trash-2')}</button></div></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Tidak ada pembayaran pada filter ini.</td></tr>'}</tbody></table></div>${cardActivityPager(info,'payments','pembayaran')}`;
}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-credit-page]');if(!a||a.disabled)return;
  if(a.dataset.kind==='installments')installmentPage=Number(a.dataset.creditPage);else paymentPage=Number(a.dataset.creditPage);
  render();
});
document.addEventListener('change',e=>{
  if(e.target.id==='paymentMonth'){paymentMonth=e.target.value;paymentPage=1;render();}
  if(e.target.id==='installmentBank'){installmentBank=e.target.value;selectedCard='all';installmentPage=1;render();}
});
