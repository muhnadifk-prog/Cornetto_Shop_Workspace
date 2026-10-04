'use strict';
const cents=n=>Math.round(n*100);
const rupiah=n=>n/100;
function installmentMoney(n){return Number.isFinite(n)&&n>=0&&n<=1e12&&Math.abs(n-rupiah(cents(n)))<0.000001;}
function splitInstallment(amount,months,index){const total=cents(amount),base=Math.floor(total/months);return rupiah(base+(index===months-1?total-base*months:0));}
function statementOn(month,day,offset=0){
  const [year,m]=month.split('-').map(Number),d=new Date(Date.UTC(year,m-1+offset,1,12));
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).getUTCDate();
  d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
}
function buildInstallment(principal,d){
  const months=Number(d.months),statementDay=Number(d.statementDay),dueAfterDays=Number(d.dueAfterDays),admin=Number(d.admin),interestValue=Number(d.interestValue||0);
  if(!installmentMoney(principal)||principal<=0||!Number.isInteger(months)||months<1||months>36||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(d.firstMonth||'')||!CardSchedule.validRule({statementDay,dueAfterDays})||!['first','monthly'].includes(d.adminMode)||!installmentMoney(admin)||!['none','flat','total','monthly','schedule'].includes(d.interestMode)||!installmentMoney(interestValue)||(d.interestMode==='flat'&&interestValue>100))throw Error('Periksa tenor 1-36 bulan, bulan cetak pertama, tanggal cetak, H+, biaya admin, dan bunga.');
  const custom=d.interestMode==='schedule';
  if(custom&&(!Array.isArray(d.customRows)||d.customRows.length!==months||d.customRows.some(r=>!r||![r.principal,r.interest,r.admin].every(installmentMoney))||d.customRows.reduce((n,r)=>n+cents(r.principal),0)!==cents(principal)))throw Error('Total pokok pada rincian bank harus sama dengan pokok pembelian.');
  const totalInterest=custom?sum(d.customRows,r=>r.interest):d.interestMode==='none'?0:d.interestMode==='flat'?rupiah(cents(principal*interestValue/100))*months:d.interestMode==='monthly'?rupiah(cents(interestValue)*months-cents(principal)):interestValue;
  if(!installmentMoney(totalInterest)||!installmentMoney(principal+totalInterest+admin*(d.adminMode==='monthly'?months:1)))throw Error('Total cicilan terlalu besar.');
  const schedule=Array.from({length:months},(_,i)=>{
    const statementDate=statementOn(d.firstMonth,statementDay,i),due=new Date(statementDate+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+dueAfterDays);
    const part=splitInstallment(principal,months,i),interest=d.interestMode==='monthly'?rupiah(cents(interestValue)-cents(part)):splitInstallment(totalInterest,months,i);
    if(interest<0)throw Error('Nominal cicilan bulanan tidak cukup untuk pokok pembelian.');
    return {number:i+1,statementDate,dueDate:due.toISOString().slice(0,10),...(custom?{principal:d.customRows[i].principal,interest:d.customRows[i].interest,admin:d.customRows[i].admin}:{principal:part,interest,admin:d.adminMode==='monthly'||i===0?admin:0})};
  });
  if(!installmentMoney(sum(schedule,installmentRowTotal)))throw Error('Total cicilan terlalu besar.');
  return {months,firstMonth:d.firstMonth,statementDay,dueAfterDays,adminMode:d.adminMode,admin,interestMode:d.interestMode,interestValue:['none','schedule'].includes(d.interestMode)?0:interestValue,...(custom?{customRows:d.customRows.map(r=>({principal:r.principal,interest:r.interest,admin:r.admin}))}:{}),schedule};
}
function installmentCharges(){return cardCharges.filter(c=>c.installment);}
function installmentRowTotal(row){return rupiah(cents(row.principal)+cents(row.interest)+cents(row.admin));}
function installmentPaid(chargeId,number,exclude=''){return sum(cardPayments.filter(p=>p.installmentChargeId===chargeId&&p.installmentNumber===number&&p.id!==exclude),p=>p.amount);}
function installmentRemaining(c,row,exclude=''){return Math.max(0,rupiah(cents(installmentRowTotal(row))-cents(installmentPaid(c.id,row.number,exclude))));}
function installmentFees(c,asOf=TODAY){return c.installment?sum(c.installment.schedule.filter(r=>r.statementDate<=asOf),r=>r.admin+r.interest):0;}
function installmentBalance(c){return c.amount+installmentFees(c)-sum(cardPayments.filter(p=>p.installmentChargeId===c.id),p=>p.amount);}
function ordinaryCardBalance(id,exclude=''){return sum(cardCharges.filter(c=>c.cardId===id&&!c.installment),c=>c.amount)-sum(cardPayments.filter(p=>p.cardId===id&&!p.installmentChargeId&&p.id!==exclude),p=>p.amount);}
function installmentExpenses(){return installmentCharges().flatMap(c=>c.installment.schedule.filter(r=>r.statementDate<=TODAY&&r.admin+r.interest>0).map(r=>({date:r.statementDate,amount:r.admin+r.interest,category:'Biaya cicilan kartu',name:cardName(c.cardId)+' / '+c.note+' / '+r.number+'/'+c.installment.months}))); }
function reportExpenses(){return [...expenses,...installmentExpenses()];}
function installmentUpcoming(){
  return installmentCharges().flatMap(c=>c.installment.schedule.filter(r=>installmentRemaining(c,r)>0).map(row=>({charge:c,row}))).sort((a,b)=>a.row.dueDate.localeCompare(b.row.dueDate));
}
function attachInstallment(chargeId,data){
  const c=cardCharges.find(c=>c.id===chargeId);
  if(!c||!cards.some(card=>card.id===c.cardId&&!card.legacyAllocation))throw Error('Pilih pembelian pada kartu yang sudah ditentukan.');
  if(cardPayments.some(p=>p.installmentChargeId===c.id))throw Error('Cicilan sudah memiliki pembayaran. Koreksi pembayaran terkait sebelum mengubah jadwal.');
  // Existing unallocated payments cannot be silently reclassified as installment payments.
  if(!c.installment&&c.amount>ordinaryCardBalance(c.cardId)+0.000001)throw Error('Pembelian ini mungkin sudah dibayar. Catat hanya pokok yang masih terutang; jangan menggandakan pembelian lama.');
  const plan=buildInstallment(c.amount,data);
  if(plan.schedule[0].statementDate<c.date)throw Error('Cetak pertama tidak boleh mendahului tanggal pembelian.');
  c.installment=plan;
}
function commitInstallmentPayment(d,id=''){
  const c=cardCharges.find(c=>c.id===d.chargeId&&c.installment),number=Number(d.number),row=c?.installment.schedule.find(r=>r.number===number),old=cardPayments.find(p=>p.id===id),amount=Number(d.amount);
  if(!row||(id&&(!old||!old.installmentChargeId))||!installmentMoney(amount)||amount<=0||amount>installmentRemaining(c,row,id)+0.000001||!CardSchedule.validDate(d.date)||d.date<row.statementDate||d.date>TODAY||typeof d.note!=='string'||d.note.length>120)throw Error('Periksa nominal dan tanggal bayar. Pembayaran hanya untuk cicilan yang sudah tercetak dan tidak boleh melebihi sisanya.');
  if(old&&(old.installmentChargeId!==c.id||old.installmentNumber!==number))throw Error('Koreksi pembayaran pada cicilan asalnya.');
  const payment=old||{id:nextId('payment')};
  Object.assign(payment,{cardId:c.cardId,installmentChargeId:c.id,installmentNumber:number,amount,date:d.date,note:d.note.trim()});
  if(!old)cardPayments.push(payment);
}
function removeInstallment(id){
  const c=cardCharges.find(c=>c.id===id&&c.installment);
  if(!c||cardPayments.some(p=>p.installmentChargeId===id))throw Error('Jadwal yang sudah memiliki pembayaran tidak dapat dihapus.');
  delete c.installment;
}
function validateInstallments(d){
  const charges=new Map(d.cardCharges.map(c=>[c.id,c])),cardsById=new Map(d.cards.map(c=>[c.id,c]));
  for(const c of d.cardCharges.filter(c=>c.installment)){
    const card=cardsById.get(c.cardId);
    if(d.version<3||!card||card.legacyAllocation||!CardSchedule.validDate(c.date))throw Error('Kartu atau versi data cicilan tidak valid.');
    const rebuilt=buildInstallment(c.amount,c.installment),actual=c.installment.schedule;
    if(!Array.isArray(actual)||actual.length!==rebuilt.months||rebuilt.schedule[0].statementDate<c.date)throw Error('Jadwal cicilan tidak valid.');
    for(let i=0;i<actual.length;i++)for(const key of ['number','statementDate','dueDate','principal','interest','admin'])if(actual[i][key]!==rebuilt.schedule[i][key])throw Error('Rincian cicilan tidak sesuai pokok dan jadwal.');
  }
  const totals=new Map();
  for(const p of d.cardPayments.filter(p=>p.installmentChargeId)){
    const c=charges.get(p.installmentChargeId),row=c?.installment?.schedule.find(r=>r.number===p.installmentNumber);
    if(!row||p.cardId!==c.cardId||!installmentMoney(p.amount)||p.amount<=0||!CardSchedule.validDate(p.date)||p.date<row.statementDate||p.date>TODAY)throw Error('Pembayaran cicilan tidak valid.');
    const key=c.id+':'+row.number,total=(totals.get(key)||0)+cents(p.amount);totals.set(key,total);
    if(total>cents(installmentRowTotal(row)))throw Error('Pembayaran cicilan melebihi tagihan.');
  }
}

