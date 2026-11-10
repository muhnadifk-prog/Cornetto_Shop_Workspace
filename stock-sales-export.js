'use strict';
const tradeStatus={all:'Semua transaksi',paid:'Lunas',pending:'Belum cair',unknown:'Belum diketahui'};
const tradeMoneyFormat='#,##0.00;[Red](#,##0.00);"-"';
const tradePercentFormat='0.00%;[Red](0.00%);0.00%';
const tradeDate=iso=>iso?new Date(iso+'T00:00:00Z'):null;
const tradeFormula=(formula,result)=>({formula,result});
const tradeVariant=p=>p.imei&&p.variant?.trim()===String(p.imei).trim()?'':p.variant;
function tradeGroup(rows,key){
  const groups=new Map();
  for(const row of rows){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
  return [...groups].sort(([a],[b])=>a.localeCompare(b,'id'));
}
function stockExportData(){
  const items=filteredInventory(),totals=inventoryTotals(items),sold=new Map();
  for(const s of sales)sold.set(s.productId,(sold.get(s.productId)||0)+s.qty);
  const incoming=p=>p.purchasedQty??(Math.max(0,p.qty)+(sold.get(p.id)||0));
  const value=p=>Math.max(0,p.qty)*p.cost;
  const details=items.map((p,i)=>{
    const n=i+6,qty=incoming(p),fund=p.payMethod==='cash'?'Tunai / transfer':cards.some(c=>c.id===p.payMethod)?cardName(p.payMethod):'Belum diketahui';
    return [tradeDate(p.date),p.name,tradeVariant(p)||null,p.imei?String(p.imei):null,p.brand,supplierName(p)||null,qty,sold.get(p.id)||0,p.qty,p.cost,
      tradeFormula('MAX(0,I'+n+')*J'+n,value(p)),tradeFormula('G'+n+'*J'+n,qty*p.cost),p.price||null,p.category,p.condition,p.warranty,fund,p.date?p.age:null,
      p.qty<0?'Stok minus':p.qty===0?'Habis':p.qty===1?'Stok menipis':'Tersedia',p.id];
  });
  const products=inventoryGroups(items).map(({product:p,rows})=>{
    const available=rows.filter(x=>x.qty>0),units=sum(available,x=>x.qty),total=sum(rows,value);
    const costs=available.map(x=>x.cost);
    return [p.name,tradeVariant(p)||null,p.brand,p.category,p.condition,p.warranty,rows.length,sum(rows,incoming),sum(rows,x=>sold.get(x.id)||0),
      sum(rows,x=>x.qty),units,total,units?total/units:null,costs.length?Math.min(...costs):null,costs.length?Math.max(...costs):null];
  });
  const brands=tradeGroup(items,p=>p.brand||'Belum diisi').map(([name,rows])=>[name,new Set(rows.map(inventoryGroupKey)).size,sum(rows,incoming),sum(rows,p=>sold.get(p.id)||0),sum(rows,p=>p.qty),sum(rows,value)]);
  const filters=[stockStart||stockEnd?'Tanggal masuk: '+(dayFirstDate(stockStart)||'awal riwayat')+' s.d. '+(dayFirstDate(stockEnd)||'hari ini'):'Semua tanggal masuk',
    ({all:'Semua stok',available:'Tersedia',low:'Stok menipis',aging:'Stok lama',empty:'Habis'})[filter],stockOnlyAvailable?'Hanya tersedia':'',
    channel==='all'?'Semua merek':channel,supplierFilter==='all'?'Semua supplier':suppliers.find(s=>s.id===supplierFilter)?.name,query?'Cari: '+query:''].filter(Boolean).join('   /   ');
  return {kind:'stock',shop:business.name,today:TODAY,filters,details,products,brands,totals,available:sum(items,p=>Math.max(0,p.qty))};
}
function salesExportData(){
  const items=filteredSales(),net=s=>revenue(s)-s.fee;
  const groups=(rows,key)=>tradeGroup(rows,key).map(([name,ss])=>[name,ss.length,sum(ss,s=>s.qty),sum(ss,revenue),sum(ss,profit),sum(ss,net)]);
  const details=items.map((s,i)=>{
    const n=i+6,p=productById(s.productId),gross=revenue(s),earn=profit(s);
    return [tradeDate(s.date),p.name,tradeVariant(p)||null,s.imei||p.imei?String(s.imei||p.imei):null,s.channel,s.qty,s.price,tradeFormula('F'+n+'*G'+n,gross),
      s.cost,tradeFormula('F'+n+'*I'+n,s.cost*s.qty),s.fee,s.shipping||0,tradeFormula('H'+n+'-SUM(J'+n+':L'+n+')',earn),
      gross?tradeFormula('IFERROR(M'+n+'/H'+n+',0)',earn/gross):null,tradeFormula('H'+n+'-K'+n,net(s)),tradeStatus[s.status],tradeDate(s.settlementDate),
      s.buyer||null,s.orderId?String(s.orderId):null,s.id,s.productId];
  });
  const range=periodRange(),filters=[period==='all'?'Semua tanggal penjualan':dayFirstDate(range.start)+' s.d. '+dayFirstDate(range.end),tradeStatus[filter],channel==='all'?'Semua channel':channel,query?'Cari: '+query:''].filter(Boolean).join('   /   ');
  return {kind:'sales',shop:business.name,today:TODAY,filters,details,channels:groups(items,s=>s.channel),funds:groups(items,s=>tradeStatus[s.status]),
    units:sum(items,s=>s.qty),gross:sum(items,revenue),profit:sum(items,profit),pending:sum(items.filter(s=>s.status==='pending'),net)};
}
function tradeDataSheet(wb,name,headers,rows,widths,amountCols,subtitle,{dates=[],text=[],percent=[],freeze=1}={}){
  const ws=reportSheet(wb,name,headers,rows,subtitle,amountCols);
  ws.properties.tabColor={argb:'FF187457'};ws.views=[{state:'frozen',xSplit:freeze,ySplit:5,showGridLines:false}];
  widths.forEach((width,j)=>{ws.getColumn(j+1).width=width;});
  ws.getRow(1).height=32;ws.getRow(2).height=20;ws.getRow(3).height=36;ws.getRow(5).height=34;
  rows.forEach((values,i)=>{
    const row=ws.getRow(i+6);row.height=Math.max(26,...values.map((v,j)=>typeof v==='string'?Math.ceil(v.length/(widths[j]*0.88))*15+8:0));
    for(const col of dates){const c=row.getCell(col);c.numFmt='dd/mm/yyyy';c.alignment={horizontal:'center',vertical:'middle'};}
    for(const col of text)row.getCell(col).numFmt='@';
    for(const col of percent)row.getCell(col).numFmt=tradePercentFormat;
  });
  ws.pageSetup.printTitlesRow='5:5';ws.pageSetup.paperSize=8;
  return ws;
}
function workbookForStockSales(data,Excel){
  const wb=new Excel.Workbook();wb.creator=data.shop;wb.calcProperties.fullCalcOnLoad=true;
  const stock=data.kind==='stock',title=stock?'Inventori':'Penjualan';
  const ws=wb.addWorksheet('Ringkasan',{views:[{showGridLines:false}],pageSetup:{orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0}});
  const ink='FF19382D',green='FF187457',pale='FFEDF5F0',white='FFFFFFFF',muted='FF506C60';
  const style=(cell,size,bold,fg,bg)=>{
    cell.font={name:'Calibri',size,bold,color:{argb:fg}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}};
    cell.alignment={vertical:'middle',wrapText:true};
  };
  function band(n,start,end,value,size,bold,fg,bg){
    ws.mergeCells(n,start,n,end);const c=ws.getCell(n,start);c.value=value;style(c,size,bold,fg,bg);c.alignment={...c.alignment,horizontal:'left',indent:1};return c;
  }
  [29,17,20,23,23,24].forEach((w,i)=>{ws.getColumn(i+1).width=w;});
  band(1,1,6,data.shop,12,true,white,ink);ws.getRow(1).height=25;
  band(2,1,6,'Laporan '+title.toLowerCase(),22,true,white,ink);ws.getRow(2).height=40;
  const scope='Posisi '+dayFirstDate(data.today)+'   |   Rupiah   |   '+data.filters;
  band(3,1,6,scope,11,false,muted,pale);ws.getRow(3).height=30+16*Math.floor(scope.length/110);
  const end=5+data.details.length,detail=stock?'Barang masuk':'Transaksi';
  const roll=(col,result)=>tradeFormula("SUM('"+detail+"'!"+col+'6:'+col+end+')',result);
  const cards=stock?[['Nilai stok tersedia',roll('K',data.totals.remainingValue),tradeMoneyFormat],['Unit tersedia',data.available,'#,##0'],['HPP rata-rata stok tersedia',data.available?tradeFormula('A6/C6',data.totals.average):null,tradeMoneyFormat]]:
    [['Omzet penjualan',roll('H',data.gross),tradeMoneyFormat],['Laba transaksi',roll('M',data.profit),tradeMoneyFormat],['Margin transaksi',data.gross?tradeFormula('C6/A6',data.profit/data.gross):null,tradePercentFormat]];
  cards.forEach(([label,value,fmt],i)=>{const a=1+2*i;band(5,a,a+1,label,11,true,muted,pale);band(6,a,a+1,value,19,true,ink,pale).numFmt=fmt;});ws.getRow(5).height=23;ws.getRow(6).height=38;
  let n=8;
  function section(label,headers,rows,moneyCols){
    band(n,1,6,label,14,true,ink,white);ws.getRow(n++).height=30;
    const h=ws.getRow(n++);h.values=headers;h.height=31;h.eachCell(c=>style(c,11,true,white,green));
    for(const values of rows){const r=ws.getRow(n++);r.values=values;r.height=Math.max(24,Math.ceil(String(values[0]).length/26)*16+8);r.eachCell((c,k)=>{style(c,11,k===6,ink,n%2?pale:white);c.numFmt=moneyCols.includes(k)?tradeMoneyFormat:k===1?'General':'#,##0';});}
    n++;
  }
  if(stock){
    const t=data.totals;
    section('Posisi stok sesuai filter',['Produk','Batch','Unit masuk','Unit terjual','Sisa bersih','Nilai pembelian'],[[t.products,t.records,t.incoming,t.sold,t.remaining,t.purchaseValue]],[6]);
    section('Rincian per merek',['Merek','Produk','Unit masuk','Unit terjual','Sisa bersih','Nilai stok tersedia'],data.brands,[6]);
    band(n,1,6,'Stok adalah posisi saat ekspor. Filter tanggal mengikuti barang masuk. Sisa bersih mencakup stok minus; nilai stok dan HPP rata-rata hanya menghitung unit yang tersedia.',11,false,muted,pale);
    tradeDataSheet(wb,'Per produk',['Produk','Varian','Merek','Kategori','Kondisi','Garansi','Batch','Unit masuk','Unit terjual','Sisa bersih','Unit tersedia','Nilai stok tersedia','HPP rata-rata tersedia','HPP terendah tersedia','HPP tertinggi tersedia'],data.products,[38,27,18,18,18,24,10,12,12,12,12,23,22,22,22],[12,13,14,15],scope+'   |   HPP rata-rata tertimbang berdasarkan jumlah unit tersedia.');
    tradeDataSheet(wb,detail,['Tanggal masuk','Produk','Varian','IMEI / nomor seri','Merek','Supplier','Unit masuk','Unit terjual','Sisa unit','HPP per unit','Nilai stok tersedia','Nilai pembelian','Harga jual rencana / unit','Kategori','Kondisi','Garansi','Sumber pembayaran','Usia (hari)','Status stok','ID batch'],data.details,[16,38,26,23,18,23,12,12,12,20,22,22,22,18,18,24,32,12,18,30],[10,11,12,13],scope,{dates:[1],text:[4,20],freeze:2});
  }else{
    const headers=['Channel','Transaksi','Unit terjual','Omzet','Laba transaksi','Dana setelah admin'];
    section('Performa channel',headers,data.channels,[4,5,6]);
    section('Pencairan dana',['Status dana',...headers.slice(1)],data.funds,[4,5,6]);
    band(n,1,6,'Dana setelah admin = omzet dikurangi biaya admin. Ongkir dikurangkan terpisah saat menghitung laba transaksi, sebelum beban operasional dan pajak. Status dana mengikuti catatan saat ekspor.',11,false,muted,pale);
    tradeDataSheet(wb,detail,['Tanggal jual','Produk','Varian','IMEI / nomor seri','Channel','Unit','Harga jual / unit','Omzet','HPP historis / unit','Total HPP','Biaya admin','Ongkir ditanggung','Laba transaksi','Margin','Dana setelah admin','Status dana','Tanggal cair','Pembeli','No. pesanan','ID transaksi','ID batch'],data.details,[16,38,26,23,19,10,21,21,21,21,18,18,21,14,22,18,16,24,25,28,28],[7,8,9,10,11,12,13,15],scope,{dates:[1,17],text:[4,19,20,21],percent:[14],freeze:2});
  }
  ws.getRow(n).height=36;ws.headerFooter.oddFooter='&L'+title+'&RHalaman &P / &N';
  return wb;
}
async function exportStockSales(kind,button){
  if(button?.disabled)return;
  if(button)button.disabled=true;
  try{
    const data=kind==='stock'?stockExportData():salesExportData();
    if(!data.details.length){toast('Tidak ada data untuk filter ini.');return;}
    const Excel=await loadExcelLibrary(),wb=workbookForStockSales(data,Excel);
    downloadData('cornetto-'+(kind==='stock'?'inventori':'penjualan')+'_'+data.today+'.xlsx',await wb.xlsx.writeBuffer(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch(err){toast('Ekspor gagal: '+err.message);}finally{if(button)button.disabled=false;}
}
