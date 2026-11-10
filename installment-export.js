'use strict';
function installmentExportReport(){
  const bankNames=new Map(cards.map(c=>[filterBankKey(c),filterBankName(c)]));
  const plans=filteredInstallmentPlans().map(c=>{
    const card=cards.find(v=>v.id===c.cardId),bank=card?bankNames.get(filterBankKey(card)):'Bank belum diisi';
    const posted=cardPayments.filter(p=>p.installmentChargeId===c.id);
    const rows=c.installment.schedule.map(r=>{
      const paid=installmentPaid(c.id,r.number),left=installmentRemaining(c,r);
      const sources=new Set(posted.filter(p=>p.installmentNumber===r.number).map(p=>p.assumption?'Otomatis (asumsi)':'Catatan pembayaran'));
      return {...r,total:installmentRowTotal(r),paid,left,
        source:r.number<=(c.installment.opening?.paidMonths||0)?'Saldo awal impor':[...sources].join(' + '),
        status:!left?'Lunas':r.dueDate<TODAY?'Lewat tempo':r.dueDate===TODAY?'Jatuh tempo hari ini':paid?'Bayar sebagian':'Belum dibayar'};
    });
    return {id:c.id,name:c.note,bank,card:card?.name||c.cardId,date:c.date,principal:c.amount,months:c.installment.months,
      settled:rows.filter(r=>!r.left).length,next:rows.find(r=>r.left>0),rows};
  });
  const bank=installmentBank?bankNames.get(installmentBank)||installmentBank:'Semua bank';
  const status={active:'Belum lunas',paid:'Lunas',all:'Semua status'}[installmentFilter];
  const tenor={short:'< 12 bulan',year:'12 bulan',long:'> 12 bulan',all:'Semua tenor'}[installmentTenor];
  return {shop:business.name,today:TODAY,month:installmentMonth,plans,filters:[bank,selectedCard==='all'?'Semua kartu':cardName(selectedCard),status,tenor,cardMonthLabel(installmentMonth)].join('   /   ')};
}

function workbookForInstallments(report,Excel){
  const {shop,today,month,plans,filters}=report,wb=new Excel.Workbook();
  wb.creator=shop;wb.calcProperties.fullCalcOnLoad=true;
  const green='FF187457',ink='FF19382D',muted='FF506C60',pale='FFEDF5F0',white='FFFFFFFF';
  const fill=argb=>({type:'pattern',pattern:'solid',fgColor:{argb}});
  const font=(size,bold,color)=>({name:'Calibri',size,bold,color:{argb:color}});
  const amount='#,##0.00;[Red](#,##0.00);"-"',day='dd/mm/yyyy';
  const dateValue=iso=>iso?new Date(iso+'T00:00:00Z'):null;
  const fx=(formula,result)=>({formula,result});
  const sumOf=(rows,key)=>rupiah(rows.reduce((v,r)=>v+cents(r[key]),0));
  const cover=wb.addWorksheet('Ringkasan',{views:[{showGridLines:false}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  const rows=plans.flatMap(p=>p.rows.map(r=>({p,r}))).sort((a,b)=>(a.r.dueDate||'9999').localeCompare(b.r.dueDate||'9999')||a.p.id.localeCompare(b.p.id)||a.r.number-b.r.number);
  const details=rows.map(({p,r},i)=>{
    const n=i+6;
    return [dateValue(r.dueDate),p.bank,p.card,p.name,r.number,r.status,r.principal,r.interest,r.admin,fx('ROUND(SUM(G'+n+':I'+n+'),2)',r.total),r.paid,fx('MAX(0,ROUND(J'+n+'-K'+n+',2))',r.left),dateValue(r.statementDate),r.source||null,p.id];
  });
  const last=5+rows.length,range=(col,end,sheet)=>"'"+sheet+"'!$"+col+'$6:$'+col+'$'+end;
  const purchases=plans.map((p,i)=>{
    const n=i+6,roll=(col,key)=>fx('SUMIF('+range('O',last,'Jadwal angsuran')+',$O'+n+','+range(col,last,'Jadwal angsuran')+')',sumOf(p.rows,key));
    return [p.name,p.bank,p.card,dateValue(p.next?.dueDate),p.next?.left??0,roll('L','left'),p.months,p.settled,p.principal,roll('H','interest'),roll('I','admin'),roll('J','total'),roll('K','paid'),dateValue(p.date),p.id];
  });
  const scope='Posisi '+dayFirstDate(today)+'   |   Rupiah   |   '+filters;
  function table(name,headers,data,moneyCols,dateCols,widths,subtitle,freeze){
    const ws=reportSheet(wb,name,headers,data,subtitle,moneyCols);
    ws.views=[{state:'frozen',xSplit:freeze,ySplit:5,showGridLines:false}];
    ws.properties.tabColor={argb:green};
    widths.forEach((w,i)=>{ws.getColumn(i+1).width=w;});
    ws.getRow(1).height=32;ws.getRow(2).height=19;ws.getRow(3).height=32;
    for(let i=6;i<=ws.rowCount;i++){
      const row=ws.getRow(i);row.height=Math.max(25,...data[i-6].map((v,j)=>typeof v==='string'?Math.ceil(v.length/(widths[j]*0.90))*15+9:0));
      for(const col of dateCols){const cell=row.getCell(col);cell.numFmt=day;cell.alignment={vertical:'middle',horizontal:'center'};}
      for(const col of moneyCols)row.getCell(col).numFmt=amount;
    }
    ws.pageSetup.printTitlesRow='5:5';ws.pageSetup.paperSize=8;
    return ws;
  }
  table('Pembelian',['Pembelian','Bank','Jenis kartu','Jatuh tempo terdekat','Sisa angsuran terdekat','Sisa seluruh tenor','Tenor (bulan)','Angsuran lunas','Pokok pembelian','Bunga','Admin','Total tagihan','Dibayar tercatat','Tanggal beli','ID pembelian'],
    purchases,[5,6,9,10,11,12,13],[4,14],[42,20,26,18,22,22,12,12,21,18,18,22,22,16,28],scope+'   |   Satu baris per pembelian; nominal seluruh tenor.',1);
  const schedule=table('Jadwal angsuran',['Jatuh tempo','Bank','Jenis kartu','Pembelian','Ke','Status','Pokok','Bunga','Admin','Total angsuran','Dibayar tercatat','Sisa tagihan','Tanggal cetak','Asal pembayaran','ID pembelian'],
    details,[7,8,9,10,11,12],[1,13],[16,20,26,42,8,22,20,16,16,20,21,20,16,27,28],scope+'   |   Jadwal lengkap pembelian terpilih. Saldo awal tanpa tanggal ditempatkan terakhir.',1);
  rows.forEach(({r},i)=>{const c=schedule.getCell(i+6,6);c.font=font(11,true,r.status==='Lunas'?green:r.status==='Lewat tempo'?'FFA33932':muted);});

  [28,16,23,23,23,24].forEach((w,i)=>cover.getColumn(i+1).width=w);
  function band(row,start,end,value,size,bg,fg,bold=true){
    cover.mergeCells(row,start,row,end);const c=cover.getCell(row,start);
    c.value=value;c.font=font(size,bold,fg);c.fill=fill(bg);c.alignment={vertical:'middle',horizontal:'left',indent:1,wrapText:true};return c;
  }
  band(1,1,6,shop+'   /   KARTU KREDIT',11,ink,white);cover.getRow(1).height=25;
  band(2,1,6,'Cicilan pembelian',22,ink,white);cover.getRow(2).height=40;
  band(3,1,6,'Posisi '+dayFirstDate(today)+'   |   Semua nominal dalam rupiah',11,pale,ink);cover.getRow(3).height=23;
  band(4,1,6,filters,11,'FFF7F9F7',muted,false);cover.getRow(4).height=32;
  const all=rows.map(v=>v.r),end=5+plans.length;
  [['Total tagihan seluruh tenor','L','total'],['Pembayaran tercatat','M','paid'],['Sisa seluruh tenor','F','left']].forEach(([label,col,key],i)=>{
    const start=i*2+1;band(6,start,start+1,label,11,pale,muted);
    const c=band(7,start,start+1,fx(plans.length?'SUM('+range(col,end,'Pembelian')+')':'0',sumOf(all,key)),19,pale,ink);c.numFmt=amount;
  });cover.getRow(6).height=23;cover.getRow(7).height=37;
  function section(at,title,headers){
    band(at,1,6,title,14,white,ink);cover.getRow(at).height=30;
    const r=cover.getRow(at+1);r.values=headers;r.height=28;
    r.eachCell(c=>{c.font=font(11,true,white);c.fill=fill(green);c.alignment={vertical:'middle',wrapText:true};});
  }
  function line(at,values){
    const row=cover.getRow(at);row.values=values;row.height=24;
    row.eachCell((c,col)=>{c.font=font(11,col===6,col===6?green:ink);c.alignment={vertical:'middle'};if(at%2===0)c.fill=fill(pale);if(col>=3)c.numFmt=amount;});
  }
  section(9,'Posisi per bank   /   Seluruh tenor',['Bank','Pembelian','Pokok pembelian','Total tagihan','Dibayar tercatat','Sisa tagihan']);
  const banks=new Map(),agenda=new Map();
  for(const p of plans){if(!banks.has(p.bank))banks.set(p.bank,[]);banks.get(p.bank).push(p);}
  for(const r of all){
    const ym=r.dueDate?.slice(0,7);if(!ym||month!=='all'&&ym!==month)continue;
    if(!agenda.has(ym))agenda.set(ym,[]);agenda.get(ym).push(r);
  }
  let n=11;
  for(const [bank,items] of [...banks].sort(([a],[b])=>a.localeCompare(b,'id'))){
    const charges=items.flatMap(p=>p.rows);line(n++,[bank,items.length,sumOf(items,'principal'),sumOf(charges,'total'),sumOf(charges,'paid'),sumOf(charges,'left')]);
  }
  section(n+1,'Agenda jatuh tempo   /   '+cardMonthLabel(month),['Bulan jatuh tempo','Angsuran','Pokok angsuran','Total tagihan','Dibayar tercatat','Sisa tagihan']);n+=3;
  for(const [ym,items] of [...agenda].sort(([a],[b])=>a.localeCompare(b))){
    line(n,[dateValue(ym+'-01'),items.length,sumOf(items,'principal'),sumOf(items,'total'),sumOf(items,'paid'),sumOf(items,'left')]);cover.getCell(n++,1).numFmt='mm/yyyy';
  }
  if(!agenda.size){band(n,1,6,'Tidak ada angsuran bertanggal pada periode ini.',11,pale,muted,false);cover.getRow(n++).height=24;}
  band(n+1,1,6,'Pembayaran tercatat mencakup saldo awal dan pencatatan otomatis, bukan konfirmasi bank. Saldo awal tanpa tanggal tidak masuk agenda bulanan.',11,pale,muted,false);cover.getRow(n+1).height=32;
  cover.headerFooter.oddFooter='&LCicilan pembelian&RHalaman &P / &N';
  return wb;
}

async function exportInstallments(button){
  if(button?.disabled)return;
  if(button)button.disabled=true;
  try{
    const report=installmentExportReport();
    if(!report.plans.length){toast('Tidak ada cicilan untuk filter ini.');return;}
    const Excel=await loadExcelLibrary(),buffer=await workbookForInstallments(report,Excel).xlsx.writeBuffer();
    downloadData('cornetto-cicilan-pembelian_'+(report.month==='all'?'semua-bulan':report.month)+'_'+report.today+'.xlsx',buffer,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch(err){toast('Ekspor cicilan gagal: '+err.message);}
  finally{if(button)button.disabled=false;}
}
