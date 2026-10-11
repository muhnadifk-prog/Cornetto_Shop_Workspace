'use strict';
let booksTab='summary',booksPage=1,booksQuery='',booksType='all';
const booksPageSize=12;
const ledgerLabels={modal:'Setoran modal',prive:'Prive',aset:'Pembelian aset',pinjam:'Penerimaan pinjaman',bayar:'Pembayaran pinjaman'};
function booksWorkspaceView(){
  const m=metrics();
  const tabNames=[['summary','Laba & arus dana'],['expenses','Beban operasional'],['capital','Modal & pinjaman'],['credit','Kartu kredit']];
  return `<div class="books-summary">${[['Omzet',m.revenue],['Laba transaksi',m.profit],['Beban operasional',m.expense],['Laba bersih sebelum pajak',m.profit-m.expense]].map(([label,amount])=>`<div><span>${label}</span><strong>${money(amount)}</strong></div>`).join('')}</div><div class="view-tabs books-tabs">${tabNames.map(([id,label])=>`<button data-books-tab="${id}" class="${booksTab===id?'active':''}" aria-pressed="${booksTab===id}">${label}</button>`).join('')}</div>${booksTab==='summary'?booksProfitView(m):booksTab==='credit'?creditBooks():booksTransactionsView()}`;
}
function booksProfitView(m){
  return `<div class="book-grid books-profit"><section><div class="section-heading"><h2>Laba rugi</h2><span class="muted">${periodLabel()}</span></div>${bookLine('Omzet penjualan',m.revenue)}${bookLine('Harga pokok penjualan',-sum(m.rows,s=>s.qty*s.cost))}${bookLine('Biaya marketplace',-sum(m.rows,s=>s.fee))}${bookLine('Ongkir penjualan',-sum(m.rows,s=>s.shipping||0))}${bookLine('Laba transaksi',m.profit,true)}${bookLine('Beban operasional',-m.expense)}${bookLine('Laba sebelum pajak',m.profit-m.expense,true)}</section><section><div class="section-heading"><h2>Penerimaan penjualan</h2>${icon('wallet')}</div>${bookLine('Dana diterima setelah biaya marketplace',sum(m.rows.filter(s=>s.status==='paid'),s=>revenue(s)-s.fee))}${bookLine('Dana belum cair',m.pending)}<div class="section-heading books-subheading"><h2>Pembiayaan</h2></div>${bookLine('Penerimaan pinjaman',sum(ledger.filter(r=>r.type==='pinjam'&&inPeriod(r.date)),r=>r.amount))}${bookLine('Pembayaran kartu kredit',sum(cardPayments.filter(r=>inPeriod(r.date)),r=>r.amount))}${bookLine('Utang kartu saat ini',sum(cards,c=>cardBalance(c.id)))}<p class="cash-note">Pokok pinjaman dan pembayaran pokok tidak mengurangi laba. Bunga dan biaya tercatat sebagai beban.</p></section></div>`;
}
function booksTransactionRows(){
  const source=booksTab==='capital'?ledger:reportExpenses();
  return source.filter(r=>inPeriod(r.date)&&(booksType==='all'||(booksTab==='capital'?r.type:r.category)===booksType)&&`${r.note||r.name||''} ${r.category||''}`.toLocaleLowerCase('id').includes(booksQuery.toLocaleLowerCase('id'))).sort((a,b)=>b.date.localeCompare(a.date));
}
function booksResults(){
  const rows=booksTransactionRows(),pages=Math.max(1,Math.ceil(rows.length/booksPageSize));booksPage=Math.min(booksPage,pages);
  return `<div class="table-scroll"><table class="books-table"><thead><tr><th>Tanggal</th><th>${booksTab==='capital'?'Jenis':'Kategori'}</th><th>Keterangan</th><th class="numeric">Nominal</th><th><span class="visually-hidden">Tindakan</span></th></tr></thead><tbody>${rows.slice((booksPage-1)*booksPageSize,booksPage*booksPageSize).map(r=>`<tr><td class="date-cell">${date(r.date)}<small>${esc(r.date.slice(0,4))}</small></td><td>${esc(booksTab==='capital'?(ledgerLabels[r.type]||r.type):r.category)}</td><td>${esc(r.note||r.name||'-')}${r.cardId?`<small>${esc(cardName(r.cardId))}</small>`:''}</td><td class="numeric">${money(r.amount)}</td><td><div class="books-actions"><button class="icon-button" data-book-edit="${esc(booksTab==='capital'?'ledger:'+r.id:r.bookKey)}" title="Edit catatan" aria-label="Edit ${esc(r.note||r.name)}">${icon('pencil')}</button><button class="icon-button danger" data-book-delete="${esc(booksTab==='capital'?'ledger:'+r.id:r.bookKey)}" title="Hapus catatan" aria-label="Hapus ${esc(r.note||r.name)}">${icon('trash-2')}</button></div></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Tidak ada catatan pada filter ini.</td></tr>'}</tbody><tfoot><tr><td colspan="3">Total ${rows.length} catatan</td><td class="numeric">${money(sum(rows,r=>r.amount))}</td><td></td></tr></tfoot></table></div><div class="books-pagination"><span>${booksPage} / ${pages}</span><button class="icon-button" data-books-page="${booksPage-1}" ${booksPage===1?'disabled':''} title="Sebelumnya" aria-label="Sebelumnya">${icon('chevron-left')}</button><button class="icon-button" data-books-page="${booksPage+1}" ${booksPage===pages?'disabled':''} title="Berikutnya" aria-label="Berikutnya">${icon('chevron-right')}</button></div>`;
}
function booksTransactionsView(){
  const capital=booksTab==='capital',source=capital?ledger:reportExpenses(),types=[...new Set(source.map(r=>capital?r.type:r.category))].sort();
  return `<section><div class="table-toolbar"><label class="search-field">${icon('search')}<input id="booksSearch" aria-label="Cari catatan pembukuan" placeholder="Cari catatan..." value="${esc(booksQuery)}"></label><div class="filters"><select id="booksType" aria-label="Jenis catatan"><option value="all">Semua ${capital?'jenis':'kategori'}</option>${types.map(t=>`<option value="${esc(t)}" ${booksType===t?'selected':''}>${esc(capital?(ledgerLabels[t]||t):t)}</option>`).join('')}</select><button class="button" ${capital?'data-work="add-ledger"':'data-action="add-expense"'}>${icon('plus')}${capital?'Catat mutasi':'Catat beban'}</button></div></div><div id="booksResults">${booksResults()}</div></section>`;
}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-books-tab],[data-books-page]');if(!a)return;
  if(a.dataset.booksTab){booksTab=a.dataset.booksTab;booksPage=1;booksQuery='';booksType='all';}
  else booksPage=Number(a.dataset.booksPage);
  render();
});
document.addEventListener('input',e=>{if(e.target.id!=='booksSearch')return;booksQuery=e.target.value;booksPage=1;el('booksResults').innerHTML=booksResults();refreshIcons();});
document.addEventListener('change',e=>{if(e.target.id!=='booksType')return;booksType=e.target.value;booksPage=1;render();});
