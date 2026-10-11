'use strict';
function bookRecord(key,state=snapshot()){
  const [kind,id,number]=key.split(':');
  if(kind==='expense')return state.expenses[Number(id)];
  if(kind==='ledger')return state.ledger.find(r=>r.id===id);
  const c=state.cardCharges.find(c=>c.id===id),row=c?.installment?.schedule.find(r=>r.number===Number(number));
  if(!row)return null;
  const correction=(state.business.expenseCorrections||[]).find(x=>x.chargeId===id&&x.number===Number(number));
  return {date:row.statementDate,amount:row.admin+row.interest,name:(state.cards.find(card=>card.id===c.cardId)?.name||'Cicilan')+' / '+c.note,category:'Biaya cicilan kartu',...correction,chargeId:id,number:Number(number)};
}
function bookBaseline(key,state=snapshot()){
  const r=bookRecord(key,state);
  return JSON.stringify({record:r,expenses:key.startsWith('expense:')?state.expenses:null,charges:state.cardCharges.filter(c=>c.id===r?.chargeId),payments:state.cardPayments.filter(p=>p.id===r?.paymentId||p.installmentChargeId===r?.chargeId),imports:state.migration?.installmentImport?.rows.filter(x=>x.chargeId===r?.chargeId)});
}
function bookImpact(key,r,remove=false){
  if(key.startsWith('installment:'))return 'Koreksi ini hanya mengubah beban dalam laporan. Tagihan, bunga bank, dan jadwal pembayaran tetap.';
  if(r.paymentId)return remove?'Pembayaran kartu terkait juga dihapus dan utang bertambah kembali. Pembayaran otomatis angsuran ini dihentikan agar tidak muncul lagi.':'Tanggal, nominal, dan keterangan pembayaran kartu ikut diperbarui. Angsuran yang dikoreksi tidak dicatat ulang otomatis.';
  if(r.chargeId)return remove?'Penerimaan pinjaman, pembiayaan kartu, dan pembayaran yang terhubung ikut dihapus. Baris impor terkait kembali perlu dicocokkan.':'Nominal dan tanggal pokok pembiayaan ikut diperbarui. Pembayaran terdahulu tetap dan akan diperiksa terhadap jadwal baru.';
  return remove?'Catatan ini dihapus dari pembukuan.':'Perubahan akan masuk ke laporan dan sinkron cloud.';
}
function bookEditForm(key,remove=false){
  const r=bookRecord(key);if(!r)return;
  const capital=key.startsWith('ledger:');
  openDrawer(remove?'Hapus catatan?':capital?'Edit modal & pinjaman':'Edit beban operasional',`<form id="bookEditForm" data-key="${esc(key)}" data-remove="${remove}"><p class="book-edit-notice">${esc(bookImpact(key,r,remove))}</p>${remove?`<strong>${esc(r.name||r.note)}</strong>${bookLine('Nominal',r.amount)}`:`${dayFirstField('Tanggal','date',r.date)}${capital?selectField('Jenis','type',Object.entries(ledgerLabels).map(([v,label])=>`<option value="${v}" ${v===r.type?'selected':''}>${label}</option>`).join('')):field('Kategori','category','text',r.category,'required maxlength="100"')}${field('Keterangan','note','text',r.name||r.note||'','required maxlength="200"')}${field('Nominal (Rp)','amount','number',r.amount,'required min="0.01" step="0.01"')}`}${formFooter(remove?'Hapus catatan':'Simpan perubahan')}</form>`,'PEMBUKUAN');
  el('bookEditForm').dataset.baseline=bookBaseline(key);
}
function prepareBookEdit(state,key,d,baseline,remove=false){
  if(bookBaseline(key,state)!==baseline)throw Error('Catatan terkait berubah. Buka ulang edit pembukuan.');
  const next=structuredClone(state),r=bookRecord(key,next);if(!r)throw Error('Catatan tidak ditemukan.');
  const amount=Number(d.amount),capital=key.startsWith('ledger:');
  if(!remove&&(!CardSchedule.validDate(d.date)||d.date<'2000-01-01'||d.date>TODAY||!installmentMoney(amount)||amount<=0||typeof d.note!=='string'||!d.note.trim()||d.note.length>200||(!capital&&(typeof d.category!=='string'||!d.category.trim()||d.category.length>100))||(capital&&!Object.hasOwn(ledgerLabels,d.type))))throw Error('Periksa tanggal, kategori, keterangan, dan nominal.');
  if(key.startsWith('installment:')){
    next.business.expenseCorrections=(next.business.expenseCorrections||[]).filter(x=>x.chargeId!==r.chargeId||x.number!==r.number);
    next.business.expenseCorrections.push({chargeId:r.chargeId,number:r.number,...(remove?{deleted:true}:{date:d.date,amount,category:d.category.trim(),name:d.note.trim()})});
  }else if(key.startsWith('expense:')){
    if(remove)next.expenses.splice(Number(key.split(':')[1]),1);
    else Object.assign(r,{date:d.date,amount,category:d.category.trim(),name:d.note.trim()});
  }else{
    const payment=next.cardPayments.find(p=>p.id===r.paymentId),charge=next.cardCharges.find(c=>c.id===r.chargeId);
    if(payment){
      const c=next.cardCharges.find(c=>c.id===payment.installmentChargeId);
      if(c)c.autoSkip=[...new Set([...(c.autoSkip||[]),payment.installmentNumber])].sort((a,b)=>a-b);
      if(remove){next.cardPayments=next.cardPayments.filter(p=>p.id!==payment.id);next.ledger=next.ledger.filter(x=>x.paymentId!==payment.id&&x.id!==r.id);}
      else{
        if(d.type!=='bayar')throw Error('Pembayaran kartu harus berjenis Pembayaran pinjaman. Untuk mengganti jenis, hapus pembayaran lalu catat mutasi baru.');
        Object.assign(payment,{date:d.date,amount,note:d.note.trim(),source:'manual-correction',assumption:false});
        next.ledger.filter(x=>x.paymentId===payment.id).forEach(x=>Object.assign(x,{date:d.date,amount,note:d.note.trim(),source:'manual-correction',assumption:false}));
      }
    }else if(charge){
      if(remove){
        const paymentIds=new Set(next.cardPayments.filter(p=>p.installmentChargeId===charge.id).map(p=>p.id));
        next.cardPayments=next.cardPayments.filter(p=>!paymentIds.has(p.id));
        next.ledger=next.ledger.filter(x=>x.id!==r.id&&x.chargeId!==charge.id&&!paymentIds.has(x.paymentId));
        next.cardCharges=next.cardCharges.filter(c=>c.id!==charge.id);
        next.business.expenseCorrections=(next.business.expenseCorrections||[]).filter(x=>x.chargeId!==charge.id);
        for(const row of next.migration?.installmentImport?.rows||[])if(row.chargeId===charge.id){row.status='pending';delete row.chargeId;delete row.activatedAt;delete row.kind;delete row.productId;}
      }else{
        if(d.type!=='pinjam')throw Error('Pembiayaan kartu harus berjenis Penerimaan pinjaman. Untuk mengganti jenis, hapus pembiayaan lalu catat mutasi baru.');
        if(charge.installment&&amount!==charge.amount){
          const plan=structuredClone(charge.installment);
          if(plan.interestMode==='schedule'){
            let remaining=cents(amount);plan.customRows=plan.customRows.map((row,i)=>{const principal=i===plan.months-1?remaining:Math.min(remaining,Math.round(cents(amount)*row.principal/charge.amount));remaining-=principal;return {...row,principal:rupiah(principal)};});
          }
          charge.installment=buildInstallment(amount,plan);
        }
        Object.assign(charge,{amount,date:d.date,note:d.note.trim()});Object.assign(r,{amount,date:d.date,note:d.note.trim()});
      }
    }else if(remove)next.ledger=next.ledger.filter(x=>x.id!==r.id);
    else Object.assign(r,{date:d.date,amount,type:d.type,note:d.note.trim()});
  }
  validateSnapshot(next);return next;
}
document.addEventListener('click',e=>{const a=e.target.closest('[data-book-edit],[data-book-delete]');if(a)bookEditForm(a.dataset.bookEdit||a.dataset.bookDelete,!!a.dataset.bookDelete);});
document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id!=='bookEditForm')return;e.preventDefault();if(f.dataset.saving)return;
  const button=f.querySelector('[type="submit"]');f.dataset.saving='true';button.disabled=true;let saving=false;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap. Unduh backup dahulu.');
    const next=prepareBookEdit(snapshot(),f.dataset.key,Object.fromEntries(new FormData(f)),f.dataset.baseline,f.dataset.remove==='true');
    savePending++;saving=true;updateStorageBadge();await persist(next);applyState(next);closeDrawer();render();toast(f.dataset.remove==='true'?'Catatan dihapus.':'Catatan diperbarui.');
  }catch(err){formError(err.message);}finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
