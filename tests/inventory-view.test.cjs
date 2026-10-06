const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={console,Date,Intl,structuredClone,window:{addEventListener(){}},document:{addEventListener(){},getElementById(){return {addEventListener(){}};}},location:{hash:''}};
vm.createContext(context);
for(const file of ['card-schedule.js','card-groups.js','cornetto-modules.js','cornetto.js','money-input.js','sale-edit.js','stock-edit.js','inventory-filters.js','inventory-view.js','installments.js','installments-ui.js','purchase-finance.js','installment-import.js','books-ui.js','workspace.js']){
  let src=fs.readFileSync(path.join(__dirname,'..',file),'utf8');if(file==='workspace.js')src=src.replace(/startWorkspace\(\);\s*$/,'');vm.runInContext(src,context,{filename:file});
}
const run=s=>vm.runInContext(s,context),json=s=>JSON.parse(JSON.stringify(run(s)));
run(`emptyWorkspace();suppliers=[{id:'s',name:'Shop',active:true}];
inventory=Array.from({length:8},(_,i)=>({id:'p'+i,name:'iPhone 15',variant:i===7?'Blue':'Black',brand:'Apple',category:'Handphone',condition:'Baru',warranty:'Resmi',imei:'00000000000000'+i,qty:i===0?0:1,purchasedQty:1,cost:100+i*10,price:200,date:'2026-10-01',supplier:'Shop',supplierId:'s',age:5,payMethod:'cash'}));
sales=[{id:'sale1',productId:'p0',qty:1,cost:100,price:200,fee:0,shipping:0,date:TODAY,status:'paid',channel:'Toko'}];`);
assert.equal(run('inventoryGroups(inventory).length'),2);
assert.equal(run('inventoryGroups(inventory)[0].rows.length'),7);
assert.deepEqual(json('inventoryTotals(inventory)'),{products:2,records:8,incoming:8,sold:1,remaining:7,purchaseValue:1080,remainingValue:980,average:140});
run("stockOnlyAvailable=true;query='iphone 15'");
assert.equal(run('filteredInventory().length'),7);
assert.equal(run('inventoryTotals(filteredInventory()).sold'),0);
run("stockStart='2026-10-02'");assert.equal(run('filteredInventory().length'),0);
assert.equal(run('inventoryTotals(filteredInventory()).average'),null);
run("stockStart='';query='000000000000003'");assert.equal(run('filteredInventory()[0].id'),'p3');
run("stockOnlyAvailable=false;query='';inventory[1].qty=-1;");
assert.equal(run('inventoryTotals(inventory).remaining'),5);
assert.equal(run('inventoryTotals(inventory).remainingValue'),870);
run("inventory[1].qty=1;inventory[1].condition='Bekas'");assert.equal(run('inventoryGroups(inventory).length'),3);
run("inventory[1].condition='Baru';inventory[1].warranty='Distributor'");assert.equal(run('inventoryGroups(inventory).length'),3);
const before=run('JSON.stringify(snapshot())');run('inventoryGroups(inventory);inventoryTotals(inventory);inventoryResults(inventory)');assert.equal(run('JSON.stringify(snapshot()).replace(/"exportedAt":"[^"]+"/,"X")'),before.replace(/"exportedAt":"[^"]+"/,'X'));
// Limit is descriptive, not an authorization gate. Invalid cards still fail.
run(`formError=message=>{globalThis.error=message;return false;};cards=[{id:'cc',name:'Card',bank:'Bank',limit:100,active:true,dueMode:'manual',due:'',color:'#187457'}];
var purchase={name:'New phone',variant:'Black',qty:1,cost:1000,price:1200,brand:'Apple',category:'Handphone',condition:'Baru',warranty:'Resmi',supplierId:'s',payMethod:'cc'};`);
assert.equal(run('commitStock(purchase)'),true);assert.equal(run('availableCardLimit(cards[0])'),-900);
assert.equal(run('totalAvailableCardLimit()'),-900);
run("cardGroups=[{id:'g',name:'Shared',limit:10}];cards[0].groupId='g';cards.push({...cards[0],id:'sibling',name:'Sibling'});");
assert.equal(run("commitStock({...purchase,payMethod:'sibling'})"),true);
assert.equal(run('availableCardLimit(cards[0])'),-1990);
assert.equal(run('totalAvailableCardLimit()'),-1990,'shared limit counted once, including negative');
const count=run('inventory.length');assert.equal(run("commitStock({...purchase,payMethod:'missing'})"),false);assert.equal(run('inventory.length'),count);
run("cards[1].active=false");assert.equal(run("commitStock({...purchase,payMethod:'sibling'})"),false);
run(`commitCardSettings('cc',{name:'Card',bank:'Bank',limitMode:'own',limit:1,color:'#187457',dueMode:'manual',due:'',last4:''})`);
assert.equal(run('cards[0].limit'),1);
assert.throws(()=>run(`commitCardSettings('cc',{name:'Card',bank:'Bank',limitMode:'own',limit:-1,color:'#187457',dueMode:'manual',due:'',last4:''})`),/positif/);
run(`var target=inventory.find(p=>p.payMethod==='cc');var base=purchaseFinanceBaseline(target.id);var d={cardId:'cc',months:12,interestMode:'flat',interestValue:1,adminMode:'first',admin:20,firstMonth:TODAY.slice(0,7),statementDay:Number(TODAY.slice(8)),dueAfterDays:14,autoPost:false};`);
const chargeCount=run('cardCharges.length'),saleBefore=run('JSON.stringify(sales)'),qtyBefore=run('target.qty');
run('commitPurchaseFinance(target.id,d,base)');
assert.equal(run('cardCharges.length'),chargeCount);assert.equal(run('JSON.stringify(sales)'),saleBefore);assert.equal(run('target.qty'),qtyBefore);
assert.equal(run('cardCharges.find(c=>c.productId===target.id).installment.months'),12);
assert.ok(run('availableCardLimit(cards[0])')<0);
// All write paths must keep the accounting records even when remaining limit is negative.
for(const name of ['cornetto-modules.js','purchase-finance.js','card-groups.js']){
 const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 assert.doesNotMatch(source,/throw Error\('Sisa limit|melebihi sisa limit|limit<cardBalance|groupLimit<cardBalance/);
}
console.log('PASS: grouped identity, weighted stock HPP, all-result summary, sold/empty/negative stock, IMEI/date filtering, read-only grouping, uncapped own/shared CC, invalid card and amount guards.');

