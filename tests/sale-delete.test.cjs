const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),handlers={},nodes={};let submitDelete;
const context={console,Date,Intl,structuredClone,queueMicrotask(){},window:{addEventListener(){}},document:{addEventListener(type,fn){(handlers[type]??=[]).push(fn);},getElementById(id){return nodes[id]||{addEventListener(){}};}},location:{hash:''}};
vm.createContext(context);
for(const name of ['card-schedule','card-groups','cornetto-modules','cornetto','money-input-v5','sale-edit','stock-edit','inventory-filters','inventory-view','installments','installments-ui','purchase-finance','installment-import','books-ui','workspace','entry-ui','performance','books-edit','books-export','expense-schedules','capital-finance','date-controls','card-repayments','card-activity']){
  const before=(handlers.submit||[]).length;
  vm.runInContext(fs.readFileSync(path.join(root,name+'.js'),'utf8'),context,{filename:name});
  if(name==='sale-edit')submitDelete=handlers.submit[before];
}
const run=s=>vm.runInContext(s,context),plain=s=>JSON.parse(JSON.stringify(run(s)));
run(`emptyWorkspace();TODAY='2026-10-28';period='all';
  cards=[{id:'cc',name:'Visa',bank:'Test Bank',limit:10000000,due:'',active:true,color:'#187457'}];
  inventory=[{id:'phone',name:'Test Phone',variant:'128GB Black',sku:'',brand:'Test',supplier:'Test',purchasedQty:5,qty:2,cost:1000000,price:1200000,payMethod:'cc',date:'2026-10-01',imei:'123456789012345'},
    {id:'other',name:'Test Phone',variant:'128GB Black',sku:'',brand:'Test',supplier:'Test',purchasedQty:1,qty:1,cost:900000,price:1100000,payMethod:'cash',date:'2026-10-02'}];
  cardCharges=[{id:'charge',productId:'phone',cardId:'cc',amount:5000000,date:'2026-10-01',note:'Test Phone'}];
  sales=[{id:'sale-paid',productId:'phone',date:'2026-10-26',qty:2,price:1200000,cost:1000000,fee:20000,shipping:10000,status:'paid',settlementDate:'2026-10-26',channel:'Toko',buyer:'Buyer',invoice:{name:'invoice.pdf',data:'data:application/pdf;base64,JVBERg=='}},
    {id:'sale-pending',productId:'phone',date:'2026-10-27',qty:1,price:1200000,cost:1000000,fee:10000,shipping:0,status:'pending',channel:'Toko',buyer:''}];
  ledger=[{id:'capital',type:'modal',amount:3000000,date:'2026-10-01',note:'Modal'}];
  var seed=structuredClone(snapshot());reconcileSaleCardPayments(seed);validateSnapshot(seed);var state,next;
`);
const reset=()=>run('state=structuredClone(seed)');
const remove=(id='sale-paid')=>run(`next=prepareSaleDelete(state,'${id}',saleDeleteBaseline(state,'${id}'))`);
reset();const before=plain('state');remove();
assert.deepEqual(plain('state'),before,'Preparing deletion must not mutate current data');
assert.equal(run('next.inventory[0].qty'),4,'Return exactly the two sold units');
assert.equal(run('next.inventory[0].purchasedQty'),5);
assert.deepEqual(plain('next.inventory[1]'),before.inventory[1],'Same-name batch with different HPP is untouched');
assert.equal(run('next.inventory[0].cost'),1000000);assert.equal(run('next.inventory[0].imei'),'123456789012345');
assert.equal(run('next.sales.length'),1);assert.equal(run('next.cardPayments.length'),0);
assert.deepEqual(plain('next.ledger'),before.ledger.filter(r=>r.id==='capital'));
assert.deepEqual(plain('next.cardCharges'),before.cardCharges,'Deleting a sale keeps purchase debt');
assert.equal(run('next.inventory[0].cancelledSales[0].sale.invoice.name'),'invoice.pdf','Recoverable original sale keeps its attachment');
run('applyState(next)');assert.equal(run("cardBalance('cc')"),5000000);assert.equal(run('metrics().revenue'),1200000);
assert.equal(run('reconcileSaleCardPayments(next)'),false,'Automatic payment cannot reappear');
assert.throws(()=>run("prepareSaleDelete(next,'sale-paid',saleDeleteBaseline(state,'sale-paid'))"),/berubah/,'Double deletion cannot return stock twice');
run('validateSnapshot(JSON.parse(JSON.stringify(next)))');
for(const status of ['pending','unknown']){
  reset();context.testStatus=status;run("state.sales[0].status=testStatus;delete state.sales[0].settlementDate;reconcileSaleCardPayments(state)");remove();
  assert.equal(run('next.inventory[0].qty'),4);assert.equal(run('next.sales.length'),1);assert.equal(run('next.cardPayments.length'),0);
}
reset();run("state.inventory[0].payMethod='cash';state.cardCharges=[];reconcileSaleCardPayments(state)");remove();assert.equal(run('next.inventory[0].qty'),4);
reset();run("state.inventory[0].qty=-1");remove();assert.equal(run('next.inventory[0].qty'),1,'Legacy negative stock uses the exact delta');
reset();run("state.inventory[0].deletedAt='2026-10-27T00:00:00Z';state.inventory[0].deletedStockQty=2;state.inventory[0].qty=0");remove();
assert.equal(run('next.inventory[0].qty'),2,'Deleted batch returns only the units in the cancelled sale');
assert.equal(run('next.inventory[0].deletedAt'),undefined);assert.equal(run('next.inventory[0].deletedStockQty'),undefined);
reset();run("state.business.salePaymentCorrections=[{saleId:'sale-paid',amount:500000,date:'2026-10-26',note:'Corrected'}];state.business.salePaymentSkips=['sale-paid'];reconcileSaleCardPayments(state)");remove();
assert.deepEqual(plain('next.business.salePaymentCorrections'),[]);assert.deepEqual(plain('next.business.salePaymentSkips'),[]);
reset();run(`state.cardPayments=[{id:'manual',cardId:'cc',amount:2000000,date:'2026-10-28',note:'Actual payment',saleAllocations:[{saleId:'sale-paid',chargeId:'charge',amount:1000000},{saleId:'sale-pending',chargeId:'charge',amount:1000000}]}];
  state.ledger.push({id:'manual-ledger',type:'bayar',amount:2000000,cardId:'cc',paymentId:'manual',date:'2026-10-28',note:'Actual payment'});reconcileSaleCardPayments(state)`);remove();
assert.equal(run('next.cardPayments[0].amount'),2000000,'Manual payment amount is preserved');
assert.deepEqual(plain('next.cardPayments[0].saleAllocations'),[{saleId:'sale-pending',chargeId:'charge',amount:1000000}]);
assert.ok(run("next.ledger.some(r=>r.id==='manual-ledger')"));
reset();run(`state.cardCharges[0].installment=buildInstallment(5000000,{months:5,firstMonth:'2026-10',statementDay:1,dueAfterDays:2,admin:0,adminMode:'first',interestMode:'none',interestValue:0});reconcileSaleCardPayments(state)`);
const installments=plain('state.cardCharges');remove();assert.deepEqual(plain('next.cardCharges'),installments,'Installment schedule is not a sale posting');
reset();run("var baseline=saleDeleteBaseline(state,'sale-paid');state.inventory[0].qty++");
assert.throws(()=>run("prepareSaleDelete(state,'sale-paid',baseline)"),/berubah/);
reset();run("baseline=saleDeleteBaseline(state,'sale-paid');state.sales[0].price++");assert.throws(()=>run("prepareSaleDelete(state,'sale-paid',baseline)"),/berubah/);
reset();run("baseline=saleDeleteBaseline(state,'sale-paid');state.cardPayments[0].amount--");assert.throws(()=>run("prepareSaleDelete(state,'sale-paid',baseline)"),/berubah/);
reset();run('state.inventory=[]');assert.throws(remove,/Produk/);
reset();run('state.inventory[0].qty=Number.MAX_SAFE_INTEGER');assert.throws(remove,/stok/);
reset();remove();run("var report=buildBookReport(next,{start:'2026-10-01',end:TODAY},TODAY)");assert.equal(run('report.debit'),run('report.credit'));
assert.ok(!run("report.journal.some(r=>r.id==='sale-paid'||r.id==='sale-pay-sale-paid')"));
run('applyState(seed)');assert.match(run('salesTable(sales)'),/data-action="delete-sale"/);
assert.match(run('saleDetailActions(sales[0])'),/Hapus penjualan/);
let html='';context.openDrawer=(title,body)=>{html=body;};nodes.saleDeleteForm={dataset:{}};
run("deleteSaleForm('sale-paid')");assert.match(html,/Hapus & kembalikan stok/);assert.match(html,/2 unit/);assert.match(html,/2\.000\.000/);
assert.equal(nodes.saleDeleteForm.dataset.baseline,run("saleDeleteBaseline(snapshot(),'sale-paid')"));

(async()=>{
  let persisted,attempts=0,error='',fail=true;
  context.persist=async data=>{attempts++;if(fail)throw Error('Test storage failure');persisted=structuredClone(data);};
  context.formError=message=>{error=message;};context.closeDrawer=()=>{};context.render=()=>{};context.toast=()=>{};context.updateStorageBadge=()=>{};
  const button={disabled:false,isConnected:true},form={id:'saleDeleteForm',dataset:{id:'sale-paid',baseline:run("saleDeleteBaseline(snapshot(),'sale-paid')")},querySelector(){return button;}};
  const event={target:form,preventDefault(){}};
  await submitDelete(event);assert.match(error,/storage failure/);assert.equal(run('sales.length'),2);assert.equal(run('inventory[0].qty'),2);assert.equal(button.disabled,false);
  fail=false;attempts=0;await Promise.all([submitDelete(event),submitDelete(event)]);
  assert.equal(attempts,1,'Double submit persists once');assert.equal(run('sales.length'),1);assert.equal(run('inventory[0].qty'),4);
  assert.equal(persisted.sales.length,1);assert.equal(persisted.cardPayments.length,0);assert.equal(run('savePending'),0);
  context.restored=JSON.parse(JSON.stringify(persisted));run('validateSnapshot(restored);applyState(restored)');assert.equal(run('inventory[0].qty'),4,'Reload/import preserves reversal');
  if(process.argv.includes('--fixture'))fs.writeFileSync(path.resolve(__dirname,'../../../work/sale-delete-fixture.json'),JSON.stringify(plain('seed')));
  console.log('PASS sale deletion: exact-batch reversal; paid/pending/unknown/cash; negative/deleted stock; purchase/installment preservation; auto-payment reversal; manual allocation preservation; balanced reports; stale/double-submit guards; storage failure/reload; confirmation UI.');
})().catch(error=>{console.error(error);process.exitCode=1;});
