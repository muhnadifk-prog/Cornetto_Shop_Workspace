'use strict';
let saleEditBaseline='';
function editSaleForm(id){
  const s=sales.find(s=>s.id===id);if(!s)return;
  saleEditBaseline=JSON.stringify(s);
  const products=inventory.filter(p=>p.qty>0||p.id===s.productId);
  const names=[...new Set([s.channel,...channels.filter(c=>c.active).map(c=>c.name)])];
  openDrawer('Edit penjualan',`<form id="saleEditForm" data-id="${esc(id)}">
    ${field('Tanggal','date','date',s.date,`required min="2000-01-01" max="${TODAY}"`)}
    ${selectField('Produk / batch stok','productId',products.map(p=>`<option value="${esc(p.id)}" ${p.id===s.productId?'selected':''}>${esc(p.name)} / ${esc(p.variant)} / ${esc(p.sku)} / HPP ${money(p.id===s.productId?s.cost:p.cost)}</option>`).join(''))}
    <div class="field-pair">${field('Jumlah unit','qty','number',s.qty,'required min="1" step="1"')}${field('Harga jual per unit (Rp)','price','number',s.price,'required min="1" step="1"')}</div>
    <div class="field-pair">${selectField('Channel','channel',names.map(name=>`<option ${name===s.channel?'selected':''}>${esc(name)}</option>`).join(''))}${selectField('Status dana','status',[['unknown','Belum diketahui'],['pending','Belum cair'],['paid','Lunas']].map(([v,label])=>`<option value="${v}" ${v===s.status?'selected':''}>${label}</option>`).join(''))}</div>
    <div class="field-pair">${field('Biaya admin total (Rp)','fee','number',s.fee,'required min="0" step="1"')}${field('Ongkir ditanggung (Rp)','shipping','number',s.shipping||0,'required min="0" step="1"')}</div>
    ${field('Nama pembeli','buyer','text',s.buyer||'','maxlength="80"')}
    <div class="estimate"><span>HPP per unit</span><strong id="editSaleCost">${money(s.cost)}</strong></div>
    <div class="estimate"><span>Laba transaksi</span><strong id="editSaleProfit">${money(profit(s))}</strong></div>
    <label class="purchase-finance-option"><input type="checkbox" name="financePurchase"><span>Atur cicilan kartu untuk pembelian barang ini setelah simpan</span></label>${formFooter('Simpan perubahan')}</form>`,'PENJUALAN / '+id);
}
function commitSaleEdit(id,d,baseline){
  const s=sales.find(s=>s.id===id);
  if(!s||JSON.stringify(s)!==baseline)throw Error('Transaksi berubah. Tutup dan buka ulang edit penjualan.');
  const old=productById(s.productId),p=productById(d.productId),qty=Number(d.qty),price=Number(d.price),fee=Number(d.fee),shipping=Number(d.shipping);
  const ch=channels.find(c=>c.active&&c.name===d.channel);
  if(!old||!p||!Number.isSafeInteger(qty)||qty<1||!validAmount(price)||price<=0||!validAmount(price*qty)||!validAmount(fee)||!validAmount(shipping)||!['paid','pending','unknown'].includes(d.status)||(!ch&&d.channel!==s.channel)||!CardSchedule.validDate(d.date)||d.date<'2000-01-01'||d.date>TODAY||typeof d.buyer!=='string'||d.buyer.trim().length>80)throw Error('Periksa produk, tanggal, jumlah, harga, biaya, dan channel.');
  const extra=p===old?qty-s.qty:qty;
  if(extra>Math.max(0,p.qty))throw Error('Jumlah penjualan melebihi stok tersedia.');
  const cost=p===old?s.cost:p.cost;
  // Only the stock delta changes; historical fees, purchase funding and attachments stay intact.
  old.qty+=s.qty;p.qty-=qty;
  Object.assign(s,{productId:p.id,date:d.date,qty,price,cost,fee,shipping,channel:d.channel,channelId:ch?.id||s.channelId,buyer:d.buyer.trim(),status:d.status});
}
function updateSaleEditEstimate(f){
  const s=sales.find(s=>s.id===f.dataset.id),p=productById(f.elements.productId.value);if(!s||!p)return;
  const cost=p.id===s.productId?s.cost:p.cost;
  el('editSaleCost').textContent=money(cost);
  el('editSaleProfit').textContent=money((Number(f.elements.price.value)-cost)*Number(f.elements.qty.value)-Number(f.elements.fee.value)-Number(f.elements.shipping.value));
}
for(const event of ['input','change'])document.addEventListener(event,e=>{if(e.target.form?.id==='saleEditForm')updateSaleEditEstimate(e.target.form);});
document.addEventListener('submit',e=>{
  const f=e.target;if(f.id!=='saleEditForm')return;e.preventDefault();
  try{commitSaleEdit(f.dataset.id,Object.fromEntries(new FormData(f)),saleEditBaseline);const finance=f.elements.financePurchase.checked,productId=f.elements.productId.value;saveDemo();closeDrawer();render();if(finance)purchaseFinanceForm(productId);else toast('Penjualan diperbarui.');}catch(err){formError(err.message);}
});

