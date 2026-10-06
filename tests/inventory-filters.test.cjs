const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={console,Date,structuredClone,Intl,window:{addEventListener(){}},document:{addEventListener(){},getElementById(){return {addEventListener(){}};}},location:{hash:''}};
vm.createContext(ctx);
for(const file of ['card-schedule.js','card-groups.js','cornetto-modules.js','cornetto.js','money-input.js','sale-edit.js','stock-edit.js','inventory-filters.js','installments.js','installments-ui.js','purchase-finance.js','installment-import.js','books-ui.js','workspace.js']){
  let code=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  if(file==='workspace.js')code=code.replace(/startWorkspace\(\);\s*$/,'');
  vm.runInContext(code,ctx,{filename:file});
}
const run=s=>vm.runInContext(s,ctx),plain=s=>JSON.parse(JSON.stringify(run(s)));
run(`emptyWorkspace();inventory=[
{id:'a',date:'2026-01-01',name:'Phone',variant:'Blue',supplier:'Shop',brand:'Apple',sku:'internal-a',imei:'001234567890123',qty:1,age:30,cost:1},
{id:'b',date:'2026-01-02',name:'Phone',variant:'Blue',supplier:'Shop',brand:'Apple',sku:'internal-b',qty:1,age:29,cost:2},
{id:'c',date:'2026-01-03',name:'Phone',variant:'Blue',supplier:'Shop',brand:'Apple',sku:'internal-c',qty:0,age:28,cost:3},
{id:'unknown',date:'',name:'Legacy',variant:'',supplier:'Shop',brand:'Apple',sku:'internal-d',qty:0,age:0,cost:0}];
stockStart='2026-01-01';stockEnd='2026-01-02';`);
assert.deepEqual(plain('stockDateRows().map(p=>p.id)'),['a','b']);
assert.deepEqual(plain('filteredInventory().map(p=>p.id)'),['b','a']);
run("query='001234567890123'");assert.equal(run('filteredInventory()[0].id'),'a');
run("query='';filter='empty'");assert.equal(run('filteredInventory().length'),0);
run("filter='all';stockStart='';stockEnd='2026-01-01'");assert.deepEqual(plain('stockDateRows().map(p=>p.id)'),['a']);
run("stockStart='2026-01-03';stockEnd=''");assert.deepEqual(plain('stockDateRows().map(p=>p.id)'),['c']);
run("stockStart=stockEnd=''");assert.equal(run('stockDateRows().length'),4);
assert.equal(run("stockTable(inventory).includes('<th>SKU</th>')"),false);
assert.equal(run("stockTable(inventory).includes('internal-a')"),false);
assert.equal(run("stockTable(inventory).includes('001234567890123')"),true);
assert.equal(run("validateStockImei('001234567890124','Handphone',1)"),'001234567890124');
assert.equal(run("validateStockImei('','Handphone',3)"),'');
assert.equal(run("validateStockImei('bad','Elektronik',3)"),'');
assert.throws(()=>run("validateStockImei('123','Handphone',1)"),/15 angka/);
assert.throws(()=>run("validateStockImei('001234567890124','Handphone',2)"),/satu unit/);
assert.throws(()=>run("validateStockImei('001234567890123','Handphone',1)"),/sudah ada/);
run('inventory[0].qty=0');assert.equal(run("validateStockImei('001234567890123','Handphone',1)"),'001234567890123');
for(const [key,today,start,end] of [['yesterday','2026-01-01','2025-12-31','2025-12-31'],['week','2026-01-03','2025-12-28','2026-01-03'],['30days','2024-03-01','2024-02-01','2024-03-01'],['lastMonth','2024-03-15','2024-02-01','2024-02-29'],['lastMonth','2025-03-15','2025-02-01','2025-02-28'],['year','2026-10-06','2026-01-01','2026-10-06']])assert.deepEqual(plain(`periodRange('${key}','${today}')`),{start,end});
console.log('PASS: inclusive and open-ended dates, unknown dates, combined search/status, IMEI leading zeros/validation/duplicates, optional multi-unit imports, hidden SKU and month/year boundaries.');
