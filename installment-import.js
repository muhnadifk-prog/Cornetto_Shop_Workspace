'use strict';
function importedInstallmentPlan(row,card){
  const opening={paidMonths:row.paidMonths,asOf:row.asOf};
  let firstMonth=row.asOf.slice(0,7);
  for(let offset=-2;offset<60;offset++){
    const month=statementOn(firstMonth,1,offset).slice(0,7),statementDate=statementOn(month,card.statementDay);
    const due=new Date(statementDate+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+card.dueAfterDays);
    if(statementDate>=row.date&&due.toISOString().slice(0,10)>row.asOf){firstMonth=month;break;}
  }
  return buildInstallment(row.principal,{months:row.months,firstMonth,statementDay:card.statementDay,dueAfterDays:card.dueAfterDays,adminMode:'first',admin:0,interestMode:row.rate?'flat':'none',interestValue:row.rate||0,opening});
}
function prepareImportedInstallment(state,rowId,selection){
  const next=structuredClone(state),batch=next.migration?.installmentImport,row=batch?.rows.find(r=>r.id===rowId),card=next.cards.find(c=>c.id===selection.cardId&&c.active&&!c.legacyAllocation);
  if(!row||row.status==='active')throw Error('Baris ini sudah diproses atau tidak tersedia.');
  if(!card||!CardSchedule.validRule(card)||!CardSchedule.validDate(row.date)||row.date>TODAY||!Number.isInteger(row.paidMonths)||row.paidMonths<0||row.paidMonths>row.months)throw Error('Periksa kartu, tanggal pembelian, tenor, dan jumlah cicilan yang sudah dibayar.');
  if(!['stock','loan'].includes(selection.kind))throw Error('Tentukan pembelian stok atau penerimaan pinjaman.');
  const p=next.inventory.find(p=>p.id===selection.productId),sources=selection.kind==='stock'?next.cardCharges.filter(c=>c.productId===p?.id||c.productIds?.includes(p?.id)):[];
  if(selection.kind==='stock'&&(!p||sources.length>1))throw Error('Pilih satu batch stok dengan pembiayaan yang jelas.');
  if(sources.some(c=>c.installment))throw Error('Pembelian ini sudah memiliki cicilan.');
  const old=sources[0];
  if(old){
    const unallocated=next.cardPayments.filter(pay=>pay.cardId===old.cardId&&!pay.installmentChargeId);
    if(unallocated.length)throw Error('Alokasikan pembayaran kartu lama sebelum menautkan cicilan.');
    if(Math.abs(old.amount-row.principal)>0.01&&!selection.acceptDifference)throw Error('Nominal Excel berbeda dari pembelian. Konfirmasi selisih terlebih dahulu.');
  }
  const plan=importedInstallmentPlan(row,card),charge=old||{id:'import-'+row.id,date:row.date,note:row.description,amount:row.principal};
  if(!old&&next.cardCharges.some(c=>c.id===charge.id))throw Error('Cicilan ini sudah ada.');
  if(old){charge.beforeInstallmentImport={amount:old.amount,cardId:old.cardId,date:old.date};charge.amount=row.principal;charge.date=row.date;}
  Object.assign(charge,{cardId:card.id,installment:plan,autoPost:selection.autoPost===true,importRowId:row.id});
  if(selection.kind==='stock'){charge.productId=p.id;p.payMethod=card.id;}
  if(!old)next.cardCharges.push(charge);
  if(selection.kind==='loan'){
    const id='loan-'+row.id;
    if(next.ledger.some(r=>r.id===id))throw Error('Penerimaan pinjaman ini sudah tercatat.');
    next.ledger.push({id,date:row.date,type:'pinjam',amount:row.principal,cardId:card.id,chargeId:charge.id,note:row.description+' / sumber kartu kredit',source:'installment-import'});
  }
  Object.assign(row,{status:'active',cardId:card.id,chargeId:charge.id,kind:selection.kind,productId:p?.id||'',activatedAt:new Date().toISOString()});
  next.version=4;
  return next;
}
function installmentImportView(){
  const batch=migration?.installmentImport;if(!batch)return '';
  const pending=batch.rows.filter(r=>r.status!=='active');
  return `<section class="installment-import"><div class="section-heading"><div><h2>Impor cicilan Excel</h2><p>${batch.rows.length} baris / ${batch.rows.length-pending.length} aktif / ${pending.length} perlu dicocokkan</p></div><span class="badge neutral">Posisi ${cardDate(batch.asOf)}</span></div>${pending.length?`<div class="storage-notice">Baris yang belum dicocokkan belum menambah utang atau pembayaran otomatis.</div><div class="module-table"><table><thead><tr><th>No.</th><th>Pembelian</th><th>Kartu</th><th class="numeric">Pokok Excel</th><th>Sudah bayar</th><th></th></tr></thead><tbody>${pending.map(r=>`<tr><td>${r.row}</td><td><strong>${esc(r.description)}</strong><div class="product-sub">${cardDate(r.date)} / ${esc(r.reason||'Perlu dicocokkan dengan pembelian')}</div></td><td>${esc(cardName(r.cardId))}</td><td class="numeric">${money(r.principal)}</td><td>${r.paidMonths} / ${r.months}</td><td><button class="icon-button" data-import-installment="${r.id}" title="Cocokkan cicilan" aria-label="Cocokkan cicilan baris ${r.row}">${icon('link')}</button></td></tr>`).join('')}</tbody></table></div>`:''}</section>`;
}
function importInstallmentForm(id){
  const row=migration?.installmentImport?.rows.find(r=>r.id===id&&r.status!=='active');if(!row)return;
  openDrawer('Cocokkan cicilan',`<form id="importInstallmentForm" data-id="${esc(id)}" data-row-baseline="${esc(JSON.stringify(row))}"><strong>${esc(row.description)}</strong><div class="detail-lines">${installmentBookLine('Pokok dari Excel',row.principal)}<div class="book-line"><span>Sudah dibayar per ${cardDate(row.asOf)}</span><strong>${row.paidMonths} / ${row.months} bulan</strong></div></div>${selectField('Kartu','cardId',cards.filter(c=>c.active&&!c.legacyAllocation).sort((a,b)=>cardName(a.id).localeCompare(cardName(b.id),'id')).map(c=>`<option value="${c.id}" ${c.id===row.cardId?'selected':''}>${esc(cardName(c.id))}</option>`).join(''))}${selectField('Pencatatan pembelian','kind','<option value="stock">Tautkan ke stok yang sudah ada</option><option value="loan">Penerimaan pinjaman dari kartu kredit</option>')}${selectField('Produk / batch stok','productId','<option value="">Pilih batch</option>'+inventory.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.name.localeCompare(b.name,'id')).map(p=>`<option value="${p.id}">${esc(p.sku+' / '+p.name)} / ${money(p.cost*p.purchasedQty)} / ${p.date||'-'}</option>`).join(''))}<label class="purchase-finance-option"><input type="checkbox" name="acceptDifference"><span>Gunakan pokok Excel jika berbeda. HPP dan laba penjualan tetap.</span></label><label class="purchase-finance-option"><input type="checkbox" name="autoPost" checked><span>Catat pembayaran saat jatuh tempo berdasarkan asumsi saya, bukan konfirmasi bank.</span></label>${formFooter('Aktifkan cicilan')}</form>`,'EXCEL / BARIS '+row.row);
}
document.addEventListener('click',e=>{const a=e.target.closest('[data-import-installment]');if(a)importInstallmentForm(a.dataset.importInstallment);});
document.addEventListener('change',e=>{if(e.target.form?.id==='importInstallmentForm'&&e.target.name==='kind')e.target.form.elements.productId.disabled=e.target.value==='loan';});
document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id!=='importInstallmentForm')return;e.preventDefault();
  try{const current=migration?.installmentImport?.rows.find(r=>r.id===f.dataset.id);if(!current||JSON.stringify(current)!==f.dataset.rowBaseline)throw Error('Data cicilan berubah. Buka ulang pencocokan.');const d=Object.fromEntries(new FormData(f));d.autoPost=f.elements.autoPost.checked;d.acceptDifference=f.elements.acceptDifference.checked;const next=prepareImportedInstallment(snapshot(),f.dataset.id,d);validateSnapshot(next);await saveQueue;await persist(next);applyState(next);closeDrawer();render();toast('Cicilan aktif. Stok dan penjualan tidak ditambahkan ulang.');}catch(err){formError(err.message);}
});

