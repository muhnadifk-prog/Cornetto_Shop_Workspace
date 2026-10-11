'use strict';
const bookAccounts={1100:'Kas/bank indikatif - perlu rekonsiliasi',1200:'Piutang / dana penjualan',1300:'Persediaan',1400:'Setoran pajak - belum dialokasikan',1500:'Aset - belum disusutkan',2100:'Utang kartu kredit',2110:'Perantara pembiayaan kartu',2200:'Pinjaman lain',3100:'Modal disetor',3200:'Prive',4100:'Penjualan',5100:'HPP',6100:'Beban operasional dan cicilan',6200:'Biaya marketplace',6300:'Ongkir penjualan',9990:'Akun lawan / saldo awal belum teridentifikasi'};
const reportNumber=n=>Math.round((n+Number.EPSILON)*100)/100;
function reportExpenseRows(state,today){
  const rows=state.expenses.map((r,i)=>({...r,id:r.id||'expense-'+i,source:'Catatan beban'}));
  for(const c of state.cardCharges.filter(c=>c.installment))for(const r of c.installment.schedule){
    if(!r.statementDate||r.statementDate>today)continue;
    const edit=(state.business.expenseCorrections||[]).find(x=>x.chargeId===c.id&&x.number===r.number);
    if(edit?.deleted||(!edit&&r.interest+r.admin===0))continue;
    rows.push({id:c.id+'-'+r.number,date:r.statementDate,amount:r.interest+r.admin,category:'Biaya cicilan kartu',name:c.note+' / cicilan '+r.number,...edit,chargeId:c.id,source:edit?'Koreksi beban cicilan':'Jadwal cicilan'});
  }
  return rows;
}
function buildBookReport(state,range,today){
  const within=d=>d&&d>=range.start&&d<=range.end,allExpenses=reportExpenseRows(state,today);
  const selected=state.sales.filter(s=>within(s.date)),out=allExpenses.filter(r=>within(r.date));
  const byId=new Map(state.inventory.map(p=>[p.id,p])),cardNames=new Map(state.cards.map(c=>[c.id,[c.bank,c.name].filter(Boolean).join(' / ')]));
  const cardLabel=id=>cardNames.get(id)||id||'Belum diketahui',journal=[],warnings=[];
  function entry(date,id,note,lines,assumption=''){
    if(!date){warnings.push(id+': tanggal belum diketahui; tidak masuk jurnal periode.');return;}
    if(!within(date))return;
    const nonzero=lines.filter(l=>Math.abs(l[1])>=0.005);
    const codes=nonzero.map(r=>r[0]);
    const activity=codes.includes(1500)?'Investasi':codes.includes(2100)?'Pembayaran kartu - pokok/bunga perlu dialokasikan':codes.some(c=>[2110,2200,3100,3200].includes(c))?'Pendanaan':'Operasi';
    for(const [account,net] of nonzero)journal.push({date,id,note,account:String(account),debit:reportNumber(Math.max(0,net)),credit:reportNumber(Math.max(0,-net)),assumption,activity});
  }
  for(const s of state.sales){
    const gross=reportNumber(s.price*s.qty),hpp=reportNumber(s.cost*s.qty),net=gross-s.fee;
    entry(s.date,s.id,byId.get(s.productId)?.name||s.productId,[[1200,net],[6200,s.fee],[4100,-gross],[5100,hpp],[1300,-hpp],[6300,s.shipping||0],[1100,-(s.shipping||0)]],s.shipping?'Tanggal pembayaran ongkir diasumsikan tanggal transaksi':'');
    if(s.status==='paid')entry(s.settlementDate||s.date,s.id+'-cair','Penerimaan '+s.id,[[1100,net],[1200,-net]],s.settlementDate?'':'Tanggal pencairan tidak tersimpan; diasumsikan tanggal penjualan');
  }
  for(const p of state.inventory){
    const amount=reportNumber(p.purchasedQty*p.cost),pay=p.payMethod==='cash'?1100:cardNames.has(p.payMethod)?2110:9990;
    entry(p.date,'stock-'+p.id,'Pembelian '+p.name,[[1300,amount],[pay,-amount]],'Nilai rekonstruksi dari jumlah masuk dan HPP saat ekspor; koreksi stok historis belum tersedia');
  }
  for(const e of state.expenses)entry(e.date,e.id||'expense-'+state.expenses.indexOf(e),e.name||e.note,[[6100,e.amount],[1100,-e.amount]],'Pembayaran beban diasumsikan pada tanggal catatan');
  for(const c of state.cardCharges){
    const linked=state.inventory.some(p=>p.id===c.productId||c.productIds?.includes(p.id))||state.ledger.some(r=>r.type==='pinjam'&&r.chargeId===c.id);
    entry(c.date,c.id,cardLabel(c.cardId)+' / '+c.note,[[linked?2110:9990,c.amount],[2100,-c.amount]],linked?'':'Alokasi pembelian/pinjaman belum lengkap');
    const plan=c.installment;if(!plan)continue;
    const opening=plan.opening;
    if(opening?.paidMonths)entry(opening.asOf,c.id+'-saldo-awal','Pokok telah dibayar sebelum impor',[[2100,sum(plan.schedule.slice(0,opening.paidMonths),r=>r.principal)],[9990,-sum(plan.schedule.slice(0,opening.paidMonths),r=>r.principal)]],'Penyesuaian saldo awal; bukan pembayaran kas periode ini');
    for(const r of plan.schedule){
      if(!r.statementDate||r.statementDate>today)continue;
      const fee=r.admin+r.interest,edit=(state.business.expenseCorrections||[]).find(x=>x.chargeId===c.id&&x.number===r.number);
      entry(r.statementDate,c.id+'-fee-'+r.number,'Admin/bunga '+c.note,[[6100,fee],[2100,-fee]]);
      if(edit){
        entry(r.statementDate,c.id+'-fee-reversal-'+r.number,'Pembalikan beban sebelum koreksi',[[6100,-fee],[9990,fee]],'Koreksi laporan tidak mengubah tagihan kartu');
        if(!edit.deleted)entry(edit.date,c.id+'-fee-edit-'+r.number,edit.name,[[6100,edit.amount],[9990,-edit.amount]],'Koreksi laporan tidak mengubah tagihan kartu');
      }
    }
  }
  for(const p of state.cardPayments)entry(p.date,p.id,cardLabel(p.cardId)+' / '+p.note,[[2100,p.amount],[1100,-p.amount]],p.assumption?'Pembayaran otomatis berdasarkan asumsi pemilik, bukan konfirmasi bank':'');
  for(const r of state.ledger){
    if(r.paymentId&&state.cardPayments.some(p=>p.id===r.paymentId))continue;
    const amount=r.amount,account={modal:3100,prive:3200,aset:1500,pinjam:r.chargeId?2110:2200,bayar:2200}[r.type];
    if(!account){warnings.push(r.id+': jenis modal/pinjaman belum terpetakan.');continue;}
    const incoming=['modal','pinjam'].includes(r.type);
    entry(r.date,r.id,r.note,[[1100,incoming?amount:-amount],[account,incoming?-amount:amount]],'Arus kas diasumsikan pada tanggal mutasi; cocokkan dengan rekening');
  }
  for(const p of state.taxPayments)entry(p.date,p.id,'Setoran '+p.type+' / '+p.period,[[1400,p.amount],[1100,-p.amount]],'Setoran tidak otomatis disamakan dengan beban pajak');
  journal.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const balances=Object.entries(bookAccounts).map(([code,name])=>{const rows=journal.filter(r=>r.account===code),debit=sum(rows,r=>r.debit),credit=sum(rows,r=>r.credit);return {code,name,debit:reportNumber(debit),credit:reportNumber(credit),net:reportNumber(debit-credit)};}).filter(r=>r.debit||r.credit);
  const m={revenue:sum(selected,s=>s.qty*s.price),hpp:sum(selected,s=>s.qty*s.cost),fee:sum(selected,s=>s.fee),shipping:sum(selected,s=>s.shipping||0),expense:sum(out,e=>e.amount),units:sum(selected,s=>s.qty)};m.profit=m.revenue-m.hpp-m.fee-m.shipping-m.expense;
  const priorEnd=new Date(range.start+'T12:00:00Z');priorEnd.setUTCDate(priorEnd.getUTCDate()-1);
  const days=Math.round((Date.parse(range.end+'T12:00:00Z')-Date.parse(range.start+'T12:00:00Z'))/86400000)+1,priorStart=new Date(priorEnd);priorStart.setUTCDate(priorStart.getUTCDate()-days+1);
  const prior=range.start==='0001-01-01'?null:{start:priorStart.toISOString().slice(0,10),end:priorEnd.toISOString().slice(0,10)};
  if(prior){const ss=state.sales.filter(s=>s.date>=prior.start&&s.date<=prior.end);prior.revenue=sum(ss,s=>s.qty*s.price);prior.hpp=sum(ss,s=>s.qty*s.cost);prior.fee=sum(ss,s=>s.fee);prior.shipping=sum(ss,s=>s.shipping||0);prior.expense=sum(allExpenses.filter(e=>e.date>=prior.start&&e.date<=prior.end),e=>e.amount);prior.profit=prior.revenue-prior.hpp-prior.fee-prior.shipping-prior.expense;}
  warnings.push('Laporan manajemen dan jurnal rekonstruksi, bukan laporan keuangan yang telah diaudit atau pernyataan patuh SAK.');
  warnings.push('Kas awal, saldo bank terpisah, modal awal, aset tetap/depresiasi, dan pemakaian pribadi belum lengkap. Neraca lengkap dan saldo kas aktual belum dapat ditentukan.');
  warnings.push('Piutang dan status lunas memakai status terakhir saat ekspor. Tanggal pencairan yang belum tersedia diasumsikan sama dengan tanggal penjualan pada jurnal dan arus kas indikatif.');
  warnings.push('Persediaan pada lembar Posisi tercatat dan Persediaan adalah posisi saat ekspor, bukan rekonstruksi stok pada akhir periode lama.');
  warnings.push('Pinjaman dan pembayaran pokok tidak masuk laba rugi. Bunga/admin masuk beban sesuai tanggal cetak, termasuk koreksi pembukuan.');
  warnings.push('Jurnal stok menggunakan HPP dan jumlah masuk saat ekspor. Selisih HPP historis penjualan, penghapusan/koreksi stok, dan alokasi pembiayaan harus direkonsiliasi.');
  const unknown=state.sales.filter(s=>within(s.date)&&s.status==='unknown');if(unknown.length)warnings.push(unknown.length+' penjualan belum diketahui status pencairannya.');
  const assumed=state.cardPayments.filter(p=>within(p.date)&&p.assumption);if(assumed.length)warnings.push(assumed.length+' pembayaran kartu adalah asumsi otomatis pemilik, bukan konfirmasi bank.');
  const pending=state.migration?.installmentImport?.rows.filter(r=>r.status==='pending')||[];if(pending.length)warnings.push(pending.length+' baris impor cicilan belum dicocokkan; belum masuk utang aktif.');
  if(state.inventory.some(p=>p.qty<0))warnings.push('Ada stok negatif. Nilai persediaan posisi memakai stok positif; periksa selisih kuantitas.');
  const debit=reportNumber(sum(journal,r=>r.debit)),credit=reportNumber(sum(journal,r=>r.credit));
  return {state,range,today,selected,out,allExpenses,journal,balances,m,prior,warnings,debit,credit,within,byId,cardLabel};
}
function reportSheet(wb,name,headers,rows,subtitle,numeric=[]){
  const ws=wb.addWorksheet(name,{views:[{state:'frozen',ySplit:5}],pageSetup:{paperSize:9,orientation:headers.length>6?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  ws.mergeCells(1,1,1,headers.length);ws.getCell('A1').value=name;ws.getCell('A1').font={name:'Calibri',size:18,bold:true,color:{argb:'FF187457'}};
  ws.mergeCells(2,1,2,headers.length);ws.getCell('A2').value=wb.creator;ws.getCell('A2').font={name:'Calibri',size:11};
  ws.mergeCells(3,1,3,headers.length);ws.getCell('A3').value=subtitle;ws.getCell('A3').alignment={wrapText:true,vertical:'middle'};ws.getRow(3).height=34;
  ws.getRow(5).values=headers;ws.getRow(5).height=30;
  headers.forEach((h,i)=>{ws.getColumn(i+1).width=numeric.includes(i+1)?19:/Keterangan|Produk|Catatan|Asumsi|Nama akun/.test(h)?44:22;const cell=ws.getCell(5,i+1);cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF187457'}};cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true,vertical:'middle'};});
  for(const values of rows){const row=ws.addRow(values);row.height=Math.max(32,...values.map((v,i)=>typeof v==='string'?Math.ceil(v.length/Math.max(10,ws.getColumn(i+1).width-4))*16+8:32));row.eachCell(cell=>{cell.font={name:'Calibri',size:11};cell.alignment={vertical:'top',wrapText:true};if(row.number%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F6F4'}};});for(const i of numeric){row.getCell(i).numFmt='#,##0.00;[Red](#,##0.00);"-"';row.getCell(i).alignment={horizontal:'right',vertical:'top'};}}
  ws.autoFilter={from:{row:5,column:1},to:{row:Math.max(5,ws.rowCount),column:headers.length}};ws.pageSetup.printTitlesRow='1:5';ws.headerFooter.oddFooter='&L'+name+'&RHalaman &P / &N';return ws;
}
function workbookForBooks(report,Excel){
  const {state,range,today,selected,out,journal,balances,m,prior,within,byId,cardLabel}=report,wb=new Excel.Workbook();wb.creator=state.business.name;wb.created=new Date();wb.calcProperties.fullCalcOnLoad=true;
  const subtitle=(range.start==='0001-01-01'?'Seluruh riwayat':dayFirstDate(range.start))+' s.d. '+dayFirstDate(range.end)+' | Rupiah | Ekspor '+dayFirstDate(today);
  const make=(name,headers,rows,nums=[],note=subtitle)=>reportSheet(wb,name,headers,rows,note,nums);
  const pnl=make('Laba rugi',['Pos','Periode terpilih','Pembanding','Selisih'],[],[2,3,4],subtitle+(prior?' | Pembanding '+dayFirstDate(prior.start)+' - '+dayFirstDate(prior.end):' | Tanpa pembanding'));
  make('Posisi tercatat',['Pos','Nominal','Catatan'],[
    ['Persediaan positif',sum(state.inventory,p=>Math.max(0,p.qty)*p.cost),'Posisi '+dayFirstDate(today)],
    ['Dana belum cair',sum(state.sales.filter(s=>s.status==='pending'),s=>s.price*s.qty-s.fee),'Status terakhir, seluruh riwayat'],
    ['Dana belum diketahui',sum(state.sales.filter(s=>s.status==='unknown'),s=>s.price*s.qty-s.fee),'Bukan dana terkonfirmasi'],
    ['Utang kartu tercatat',sum(state.cardCharges,c=>c.amount-(c.installment?sum(c.installment.schedule.slice(0,c.installment.opening?.paidMonths||0),r=>r.principal):0)+(c.installment?sum(c.installment.schedule.filter(r=>r.statementDate&&r.statementDate<=today),r=>r.interest+r.admin):0))-sum(state.cardPayments,p=>p.amount),'Porsi yang dicatat; dapat berbeda dari tagihan bank'],
    ['Kas/bank aktual',null,'Belum dapat ditentukan tanpa saldo awal dan rekonsiliasi'],['Modal akhir',null,'Belum dapat ditentukan; modal awal/pemakaian pribadi belum lengkap']
  ],[2],'POSISI SAAT EKSPOR '+dayFirstDate(today)+' | Bukan neraca lengkap; tidak mengikuti filter periode');
  const cash=journal.filter(r=>r.account==='1100');
  make('Arus kas indikatif',['Tanggal','Referensi','Keterangan','Penerimaan','Pengeluaran','Aktivitas','Asumsi'],cash.map(r=>[dayFirstDate(r.date),r.id,r.note,r.debit,r.credit,r.activity,r.assumption||'Belum direkonsiliasi rekening']),[4,5],subtitle+' | Bukan saldo atau arus kas bank terverifikasi');
  const saleRows=selected.map((s,i)=>{const p=byId.get(s.productId),r=i+6;return [s.id,dayFirstDate(s.date),p?.name||s.productId,p?.imei||'',s.channel,s.buyer,s.qty,s.price,{formula:`G${r}*H${r}`,result:s.qty*s.price},s.cost,{formula:`G${r}*J${r}`,result:s.qty*s.cost},s.fee,s.shipping||0,{formula:`I${r}-K${r}-L${r}-M${r}`,result:s.qty*(s.price-s.cost)-s.fee-(s.shipping||0)},({paid:'Lunas',pending:'Belum cair',unknown:'Belum diketahui'})[s.status],s.settlementDate?dayFirstDate(s.settlementDate):'Tidak tercatat',s.invoice?'Ada':'Tidak'];});
  make('Penjualan',['ID','Tanggal','Produk','IMEI','Channel','Pembeli','Unit','Harga per unit','Omzet','HPP per unit','Total HPP','Admin','Ongkir','Laba transaksi','Status dana','Tanggal cair','Lampiran invoice'],saleRows,[7,8,9,10,11,12,13,14]);
  make('Beban',['Referensi','Tanggal','Kategori','Keterangan','Nominal','Sumber'],out.map(e=>[e.id,dayFirstDate(e.date),e.category,e.name||e.note,e.amount,e.source]),[5]);
  const aggregate=(sheet,col,count)=>count?`SUM('${sheet}'!${col}6:${col}${count+5})`:'0';
  const pnlRows=[['Omzet',aggregate('Penjualan','I',selected.length),m.revenue,prior?.revenue],['Harga pokok penjualan',aggregate('Penjualan','K',selected.length),m.hpp,prior?.hpp],['Laba kotor','B6-B7',m.revenue-m.hpp,prior?prior.revenue-prior.hpp:null],['Biaya marketplace',aggregate('Penjualan','L',selected.length),m.fee,prior?.fee],['Ongkir penjualan',aggregate('Penjualan','M',selected.length),m.shipping,prior?.shipping],['Laba transaksi','B8-B9-B10',m.profit+m.expense,prior?prior.profit+prior.expense:null],['Beban operasional dan cicilan',aggregate('Beban','E',out.length),m.expense,prior?.expense],['Laba bersih sebelum pajak','B11-B12',m.profit,prior?.profit]];
  pnlRows.forEach(([name,formula,result,old],i)=>{const r=i+6;pnl.getRow(r).values=[name,{formula,result},old??null,old==null?null:{formula:`B${r}-C${r}`,result:result-old}];pnl.getRow(r).height=28;for(const c of [2,3,4])pnl.getCell(r,c).numFmt='#,##0.00;[Red](#,##0.00);"-"';if([8,11,13].includes(r))pnl.getRow(r).font={bold:true,color:{argb:'FF187457'}};});
  const capital=state.ledger.filter(r=>within(r.date));
  make('Modal dan pinjaman',['ID','Tanggal','Jenis','Keterangan','Nominal','Kartu','ID pembiayaan','ID pembayaran','Asumsi'],capital.map(r=>[r.id,dayFirstDate(r.date),ledgerLabels[r.type]||r.type,r.note,r.amount,cardLabel(r.cardId),r.chargeId||'',r.paymentId||'',r.assumption?'Asumsi pemilik':'Catatan pengguna']),[5]);
  make('Pembelian stok',['ID','Tanggal masuk','Produk','IMEI','Supplier','Unit masuk','HPP per unit','Total pembelian','Sumber dana'],state.inventory.filter(p=>within(p.date)).map((p,i)=>[p.id,dayFirstDate(p.date),p.name,p.imei||'',p.supplier,p.purchasedQty,p.cost,{formula:`F${i+6}*G${i+6}`,result:p.purchasedQty*p.cost},p.payMethod==='cash'?'Tunai / transfer':cardLabel(p.payMethod)]),[6,7,8]);
  make('Persediaan',['ID','Tanggal masuk','Produk','Varian','IMEI','Unit masuk','Sisa unit','HPP per unit','Nilai sisa positif','Harga rencana','Status'],state.inventory.map((p,i)=>[p.id,dayFirstDate(p.date),p.name,p.variant,p.imei||'',p.purchasedQty,p.qty,p.cost,{formula:`MAX(0,G${i+6})*H${i+6}`,result:Math.max(0,p.qty)*p.cost},p.price||null,p.deletedAt?'Dihapus / arsip':p.qty>0?'Tersedia':'Habis']),[6,7,8,9,10],'POSISI SAAT EKSPOR '+dayFirstDate(today)+' | Seluruh stok dan arsip, bukan saldo historis akhir periode');
  const mutations=[...state.cardCharges.filter(c=>within(c.date)).map(c=>[c.id,dayFirstDate(c.date),cardLabel(c.cardId),'Pembiayaan',c.note,c.amount,0,c.productId||'',c.installment?'Cicilan':'Tagihan biasa']),...state.cardPayments.filter(p=>within(p.date)).map(p=>[p.id,dayFirstDate(p.date),cardLabel(p.cardId),'Pembayaran',p.note,0,p.amount,p.installmentChargeId||'',p.assumption?'Asumsi otomatis':'Catatan pengguna'])];
  make('Mutasi kartu',['ID','Tanggal','Kartu','Jenis','Keterangan','Pokok pembiayaan','Pembayaran','Referensi','Status'],mutations,[6,7]);
  const schedule=[];for(const c of state.cardCharges.filter(c=>c.installment))for(const r of c.installment.schedule){const paid=r.number<=(c.installment.opening?.paidMonths||0)?r.principal+r.interest+r.admin:sum(state.cardPayments.filter(p=>p.installmentChargeId===c.id&&p.installmentNumber===r.number),p=>p.amount);schedule.push([c.id,cardLabel(c.cardId),c.note,r.number,dayFirstDate(r.statementDate)||'Saldo awal',dayFirstDate(r.dueDate)||'Saldo awal',r.principal,r.interest,r.admin,r.principal+r.interest+r.admin,paid,Math.max(0,reportNumber(r.principal+r.interest+r.admin-paid)),c.autoPost?'Aktif':'Tidak aktif',(c.autoSkip||[]).includes(r.number)?'Dikecualikan':'']);}
  make('Jadwal cicilan',['ID','Kartu','Pembiayaan','Ke','Cetak','Jatuh tempo','Pokok','Bunga','Admin','Tagihan','Dibayar','Sisa','Otomatis','Pengecualian'],schedule,[4,7,8,9,10,11,12],'SELURUH TENOR | Posisi pembayaran '+dayFirstDate(today)+'; termasuk proyeksi setelah periode');
  make('Jurnal rekonstruksi',['Tanggal','Referensi','Keterangan','Kode akun','Nama akun','Debit','Kredit','Asumsi'],journal.map(r=>[dayFirstDate(r.date),r.id,r.note,r.account,bookAccounts[r.account],r.debit,r.credit,r.assumption]),[6,7]);
  const running=new Map(),general=journal.slice().sort((a,b)=>a.account.localeCompare(b.account)||a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(r=>{const net=reportNumber((running.get(r.account)||0)+r.debit-r.credit);running.set(r.account,net);return [r.account,bookAccounts[r.account],dayFirstDate(r.date),r.id,r.note,r.debit,r.credit,net];});
  make('Buku besar mutasi',['Kode akun','Nama akun','Tanggal','Referensi','Keterangan','Debit','Kredit','Saldo mutasi D-K'],general,[6,7,8],subtitle+' | Tanpa saldo awal; saldo mutasi bukan saldo akun aktual');
  make('Neraca saldo mutasi',['Kode akun','Nama akun','Mutasi debit','Mutasi kredit','Saldo debit','Saldo kredit'],balances.map(r=>[r.code,r.name,r.debit,r.credit,Math.max(0,r.net),Math.max(0,-r.net)]),[3,4,5,6],subtitle+' | Tanpa saldo awal; bukan neraca posisi keuangan');
  make('Kontrol dan catatan',['Pemeriksaan','Nilai / keterangan'],[
    ['Jumlah penjualan periode',selected.length],['Unit terjual',m.units],['Total debit jurnal',report.debit],['Total kredit jurnal',report.credit],['Selisih debit-kredit',reportNumber(report.debit-report.credit)],
    ['Total beban periode',m.expense],['Kebijakan pembanding',prior?'Periode sebelumnya dengan jumlah hari yang sama; berasal dari snapshot yang sama':'Tidak diterapkan pada semua tanggal'],
    ...report.warnings.map((w,i)=>['Catatan '+(i+1),w]),
    ['Referensi struktur laporan','https://web.iaiglobal.or.id/SAK-EMKM-Efektif/SAK%20EMKM%20Efektif%20Per%201%20Januari%202018'],
    ['Referensi arus kas/nonkas','https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/'],
    ['Lampiran','Berkas invoice tidak disalin ke Excel. Gunakan backup JSON lengkap untuk lampiran asli.']
  ]);const notes=wb.getWorksheet('Kontrol dan catatan');notes.getColumn(1).width=36;notes.getColumn(2).width=100;for(let i=6;i<=notes.rowCount;i++)notes.getRow(i).height=48;
  for(const [name,cols] of [['Penjualan',[7,9,11,12,13,14]],['Beban',[5]],['Arus kas indikatif',[4,5]],['Jurnal rekonstruksi',[6,7]],['Neraca saldo mutasi',[3,4,5,6]],['Pembelian stok',[6,8]],['Persediaan',[6,7,9]],['Mutasi kartu',[6,7]],['Jadwal cicilan',[7,8,9,10,11,12]]]){
    const ws=wb.getWorksheet(name),last=ws.rowCount,row=ws.addRow(['TOTAL']);row.font={bold:true,color:{argb:'FF187457'}};row.height=28;
    for(const col of cols){const letter=ws.getColumn(col).letter,result=Array.from({length:Math.max(0,last-5)},(_,i)=>ws.getCell(i+6,col).value).reduce((n,v)=>n+(typeof v==='number'?v:typeof v?.result==='number'?v.result:0),0);row.getCell(col).value={formula:last>=6?`SUM(${letter}6:${letter}${last})`:'0',result:reportNumber(result)};row.getCell(col).numFmt='#,##0.00;[Red](#,##0.00);"-"';}
  }
  return wb;
}
let excelLibraryPromise;
function loadExcelLibrary(){
  if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
  if(!excelLibraryPromise)excelLibraryPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='exceljs.min.js';script.onload=()=>resolve(window.ExcelJS);script.onerror=()=>{excelLibraryPromise=null;script.remove();reject(Error('Pustaka ekspor belum dapat dimuat. Periksa koneksi lalu coba lagi.'));};document.head.append(script);});
  return excelLibraryPromise;
}
async function exportBooks(){
  const button=document.querySelector('[data-action="export"]');if(button?.disabled)return;
  if(button)button.disabled=true;
  try{
    await saveQueue;if(storageFailed)throw Error('Penyimpanan lokal gagal; gunakan Backup lokal dahulu.');
    const report=buildBookReport(structuredClone(snapshot()),periodRange(),TODAY),Excel=await loadExcelLibrary();
    const wb=workbookForBooks(report,Excel),buffer=await wb.xlsx.writeBuffer();
    downloadData(`cornetto-pembukuan_${period==='all'?'semua':report.range.start}_${report.range.end}.xlsx`,buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch(err){toast('Ekspor gagal: '+err.message);}finally{if(button?.isConnected)button.disabled=false;}
}
