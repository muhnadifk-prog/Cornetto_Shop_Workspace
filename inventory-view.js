'use strict';
let stockPresentation='groups';
const expandedStockGroups=new Set();
function inventoryGroupKey(p){
  const norm=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id');
  // Legacy imports sometimes put the unit IMEI in the variant field.
  const variant=p.imei&&String(p.variant).trim()===String(p.imei).trim()?'':p.variant;
  return JSON.stringify([p.name,variant,p.brand,p.category,p.condition,p.warranty].map(norm));
}
function inventoryGroups(rows){
  const map=new Map();
  for(const p of rows){const key=inventoryGroupKey(p);if(!map.has(key))map.set(key,{key,product:p,rows:[]});map.get(key).rows.push(p);}
  const groups=[...map.values()];
  const qty=g=>sum(g.rows,p=>p.qty),cost=g=>Math.max(...g.rows.map(p=>p.cost));
  if(sort==='qty')groups.sort((a,b)=>qty(a)-qty(b));
  if(sort==='cost')groups.sort((a,b)=>cost(b)-cost(a));
  return groups;
}
function inventoryTotals(rows){
  const ids=new Set(rows.map(p=>p.id)),soldById=new Map();
  for(const s of sales)if(ids.has(s.productId))soldById.set(s.productId,(soldById.get(s.productId)||0)+s.qty);
  const purchased=p=>Number.isFinite(p.purchasedQty)?p.purchasedQty:Math.max(0,p.qty)+(soldById.get(p.id)||0);
  const available=sum(rows,p=>Math.max(0,p.qty)),remainingValue=sum(rows,p=>Math.max(0,p.qty)*p.cost);
  return {products:new Set(rows.map(inventoryGroupKey)).size,records:rows.length,incoming:sum(rows,purchased),sold:sum([...soldById.values()],n=>n),remaining:sum(rows,p=>p.qty),purchaseValue:sum(rows,p=>purchased(p)*p.cost),remainingValue,average:available?remainingValue/available:null};
}
function inventorySummary(rows){
  const t=inventoryTotals(rows),part=(label,value)=>`<span>${label} <strong>${value}</strong></span>`;
  return part('Produk',t.products)+part('Catatan masuk',t.records)+part('Unit masuk',t.incoming)+part('Terjual',t.sold)+part('Sisa',t.remaining)+part('Nilai beli',money(t.purchaseValue))+part('Nilai sisa',money(t.remainingValue))+part('Rata-rata HPP stok tersedia',t.average===null?'-':money(t.average));
}
function groupedStockTable(groups){
  if(!groups.length)return emptyState('Tidak ada produk yang cocok.');
  return `<div class="inventory-group-labels"><span>Produk / varian</span><span>Unit tersisa</span><span>HPP per unit</span><span></span></div>`+groups.map(g=>{
    const p=g.product,stock=g.rows.filter(r=>r.qty>0),costs=(stock.length?stock:g.rows).map(r=>r.cost),min=Math.min(...costs),max=Math.max(...costs);
    const variant=p.imei&&p.variant===p.imei?'':p.variant;
    return `<details class="inventory-product-group" data-stock-group="${esc(g.key)}" ${expandedStockGroups.has(g.key)?'open':''}><summary><span class="inventory-group-product"><strong>${esc(p.name)}</strong><small>${[variant,p.condition,p.warranty].filter(Boolean).map(esc).join(' / ')}</small><small>${g.rows.length} catatan masuk</small></span><span class="inventory-group-qty"><strong>${sum(g.rows,r=>r.qty)}</strong> unit</span><span class="inventory-group-cost">${money(min)}${min!==max?`<span> - ${money(max)}</span>`:''}</span>${icon('chevron-down')}</summary><div class="inventory-group-units">${stockTable(g.rows)}</div></details>`;
  }).join('');
}
function inventoryResults(rows){
  const display=stockPresentation==='groups'?inventoryGroups(rows):rows;
  page=Math.min(page,Math.max(1,Math.ceil(display.length/pageSize)));
  const selected=display.slice((page-1)*pageSize,page*pageSize);
  return (stockPresentation==='groups'?groupedStockTable(selected):stockTable(selected))+pager(display.length).replace(/ produk</,' '+(stockPresentation==='groups'?'produk':'catatan masuk')+'<');
}
function inventoryView(){
  const rows=filteredInventory(),dated=stockDateRows(),brands=[...new Set(inventory.map(p=>p.brand))].sort((a,b)=>a.localeCompare(b,'id'));
  const statuses=[['all','Semua produk',dated.length],['low','Stok menipis',dated.filter(p=>p.qty>0&&p.qty<=1).length],['aging','Stok lama',dated.filter(p=>p.qty>0&&p.age>30).length],['empty','Habis',dated.filter(p=>p.qty<=0).length]];
  return `${stockDateControls()}${tabs(statuses)}<div class="table-toolbar">${searchBox('Cari produk, IMEI, atau supplier...')}<div class="filters"><select id="channel" aria-label="Merek"><option value="all">Semua merek</option>${brands.map(b=>`<option ${b===channel?'selected':''}>${esc(b)}</option>`).join('')}</select><select id="supplierFilter" aria-label="Supplier"><option value="all">Semua supplier</option>${suppliers.map(s=>`<option value="${s.id}" ${supplierFilter===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select><select id="sort" aria-label="Urutan">${[['date','Terbaru'],['oldest','Tanggal masuk terlama'],['name','Nama produk A-Z'],['qty','Stok terendah'],['cost','HPP tertinggi']].map(([v,l])=>`<option value="${v}" ${sort===v?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="inventory-view-options"><label class="inventory-available"><input id="stockOnlyAvailable" type="checkbox" ${stockOnlyAvailable?'checked':''}>Hanya tersedia</label><div class="segmented" role="group" aria-label="Tampilan inventori"><button data-stock-view="groups" class="${stockPresentation==='groups'?'active':''}" aria-pressed="${stockPresentation==='groups'}">${icon('layers')}Per produk</button><button data-stock-view="units" class="${stockPresentation==='units'?'active':''}" aria-pressed="${stockPresentation==='units'}">${icon('list')}Per barang masuk</button></div></div><div id="inventorySummary" class="inventory-summary" role="status" aria-label="Ringkasan hasil filter">${inventorySummary(rows)}</div><div id="listResults">${inventoryResults(rows)}</div>`;
}
moduleViews.stock=inventoryView;
document.addEventListener('change',e=>{if(e.target.id==='stockOnlyAvailable'){stockOnlyAvailable=e.target.checked;if(stockOnlyAvailable&&filter==='empty')filter='all';page=1;render();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-stock-view]');if(b){stockPresentation=b.dataset.stockView;page=1;render();}if(view==='stock'&&e.target.closest('[data-filter-tab="empty"]')){stockOnlyAvailable=false;render();}});
document.addEventListener('toggle',e=>{const key=e.target.dataset?.stockGroup;if(key){if(e.target.open)expandedStockGroups.add(key);else expandedStockGroups.delete(key);}},true);

