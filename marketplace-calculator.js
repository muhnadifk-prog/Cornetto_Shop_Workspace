'use strict';
let marketplaceDraft=null,marketplaceExpanded=null,marketplaceTimer=null,marketplacePending=false;
function validateMarketplaceCalculator(d){if(d.business.marketplaceCalculator!==undefined)MarketplaceFees.validate(d.business.marketplaceCalculator);}
function flushMarketplaceCalculator(){
  clearTimeout(marketplaceTimer);marketplaceTimer=null;
  if(!marketplacePending)return saveQueue;
  marketplacePending=false;savePending--;return saveDemo();
}
function saveMarketplaceCalculator(){
  MarketplaceFees.validate(marketplaceDraft);
  business.marketplaceCalculator=structuredClone(marketplaceDraft);
  // Reserve a pending save so remote refreshes cannot replace an unsaved calculator edit.
  if(!marketplacePending){marketplacePending=true;savePending++;}
  updateStorageBadge();clearTimeout(marketplaceTimer);
  marketplaceTimer=setTimeout(flushMarketplaceCalculator,800);
}
const marketplacePercent=n=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:4})+'%';
function marketplaceInput(label,key,value,kind='money',feeId=''){
  return `<label class="form-field"><span>${label}</span><input type="text" inputmode="${kind==='percent'?'decimal':'numeric'}" autocomplete="off" ${feeId?`data-mc-fee="${feeId}"`:''} data-mc-key="${key}" data-mc-kind="${kind}" aria-label="${label}" value="${esc(kind==='money'?moneyInputText(value):String(value).replace('.',','))}"></label>`;
}
function marketplaceSelect(label,key,value,options,feeId=''){
  return `<label class="form-field"><span>${label}</span><select ${feeId?`data-mc-fee="${feeId}"`:''} data-mc-key="${key}" aria-label="${label}">${options.map(([v,label])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${label}</option>`).join('')}</select></label>`;
}
function marketplaceFeeDescription(f){return (f.type==='percent'?marketplacePercent(f.rate)+' / '+(f.base==='gross'?'harga barang':'setelah diskon'):money(f.fixed)+' / '+(f.unit==='unit'?'unit':'pesanan'))+(f.capped?' / maks. '+money(f.cap):'')+(f.taxed?' / PPN '+marketplacePercent(f.tax):'');}
function marketplaceFeeRows(){const amounts=marketplaceResults().rows;return marketplaceDraft.fees[marketplaceDraft.market].map(f=>`<section class="mc-fee" data-mc-row="${f.id}">
  <div class="mc-fee-line"><label class="mc-check"><input type="checkbox" data-mc-fee="${f.id}" data-mc-key="on" ${f.on?'checked':''} aria-label="Aktifkan ${esc(f.name)}"><span><strong data-mc-name>${esc(f.name)}</strong><small data-mc-description>${esc(marketplaceFeeDescription(f))}</small></span></label><span class="mc-amount" data-mc-amount="${f.id}">${amounts.some(r=>r.id===f.id)?money(amounts.find(r=>r.id===f.id).amount):'-'}</span><button class="icon-button" data-mc-edit="${f.id}" title="Atur ${esc(f.name)}" aria-label="Atur ${esc(f.name)}" aria-expanded="${marketplaceExpanded===f.id}">${icon('sliders-horizontal')}</button></div>
  <div class="mc-fee-config" ${marketplaceExpanded===f.id?'':'hidden'}>
    <label class="form-field mc-wide"><span>Nama biaya</span><input data-mc-fee="${f.id}" data-mc-key="name" aria-label="Nama biaya" maxlength="80" value="${esc(f.name)}"></label>
    ${marketplaceSelect('Jenis biaya','type',f.type,[['percent','Persentase'],['fixed','Nominal tetap']],f.id)}
    ${f.type==='percent'?marketplaceInput('Tarif (%)','rate',f.rate,'percent',f.id):marketplaceInput('Nominal (Rp)','fixed',f.fixed,'money',f.id)}
    <div class="mc-wide">${f.type==='percent'?marketplaceSelect('Dasar potongan','base',f.base,[['net','Setelah diskon penjual'],['gross','Harga barang sebelum diskon']],f.id):marketplaceSelect('Dikenakan per','unit',f.unit,[['order','Pesanan'],['unit','Unit']],f.id)}</div>
    <label class="mc-check"><input type="checkbox" data-mc-fee="${f.id}" data-mc-key="capped" ${f.capped?'checked':''}>Batas biaya</label>${f.capped?marketplaceInput('Maks. / pesanan, sebelum PPN (Rp)','cap',f.cap,'money',f.id):'<span></span>'}
    <label class="mc-check"><input type="checkbox" data-mc-fee="${f.id}" data-mc-key="taxed" ${f.taxed?'checked':''}>PPN tambahan</label>${f.taxed?marketplaceInput('PPN atas biaya (%)','tax',f.tax,'percent',f.id):'<span></span>'}
    <button class="icon-button mc-delete" data-mc-remove="${f.id}" title="Hapus komponen" aria-label="Hapus ${esc(f.name)}">${icon('trash-2')}</button>
  </div></section>`).join('')||'<div class="mc-empty">Belum ada tarif tersimpan.</div>';}
function marketplaceResults(){
  let error='',price=marketplaceDraft.inputs.price,r=null;
  try{
    MarketplaceFees.validate(marketplaceDraft);
    const s=marketplaceDraft,fees=s.fees[s.market];
    if(!fees.length)throw Error('Tarif marketplace belum diatur.');
    if(s.mode==='deductions'&&s.inputs.discount>s.inputs.price*s.inputs.qty)throw Error('Diskon penjual melebihi total harga barang.');
    if(s.mode==='target'){price=MarketplaceFees.solve(s.inputs,fees);if(price===null)throw Error('Target belum dapat dicapai dengan tarif ini.');}
    r=MarketplaceFees.calculate(s.inputs,fees,price);
  }catch(err){error=err.message;}
  const fmt=n=>r?money(n):'-',i=marketplaceDraft.inputs;
  const row=(label,value)=>`<div class="mc-result-row"><span>${label}</span><strong>${value}</strong></div>`;
  const html=`<h2>Hasil ${marketplaceDraft.market==='shopee'?'Shopee':'Tokopedia'}</h2>${marketplaceDraft.mode==='target'?`<div class="mc-stat"><span>Harga jual / unit</span><strong id="mcPrice">${fmt(price)}</strong></div>`:''}<div class="mc-stat"><span>Dana bersih diterima</span><strong id="mcNet">${fmt(r?.net)}</strong></div><div class="mc-stat"><span>Laba setelah biaya</span><strong id="mcProfit" class="${r?.profit<0?'red-text':'green'}">${fmt(r?.profit)}</strong>${row('Margin',r?marketplacePercent(r.margin):'-')}</div>${row('Total potongan',fmt(r?.totalFee))}${row('Potongan efektif',r?marketplacePercent(r.effective):'-')}${row('Laba / unit',fmt(r?.profit/i.qty))}<details open><summary>Rincian perhitungan</summary>${row('Harga barang',fmt(r?.gross))}${row('Diskon penjual',r?'- '+money(i.discount):'-')}${row('Setelah diskon',fmt(r?.base))}${row('Potongan marketplace',r?'- '+money(r.totalFee):'-')}${row('Dana diterima',fmt(r?.net))}${row('Total HPP',r?'- '+money(i.cost*i.qty):'-')}${row('Packing + ongkir',r?'- '+money(i.packing+i.shipping):'-')}</details><p class="mc-note">Estimasi per pesanan</p>`;
  return {html,error,rows:r?.rows||[]};
}
function updateMarketplaceResults(){
  const root=el('marketplaceCalculator');if(!root||!marketplaceDraft)return;
  const result=marketplaceResults();el('mcResults').innerHTML=result.html;el('mcError').textContent=result.error;
  root.querySelectorAll('[data-mc-amount]').forEach(e=>{const row=result.rows.find(r=>r.id===e.dataset.mcAmount);e.textContent=row?money(row.amount):'-';});
}
function refreshMarketplaceFees(){el('mcFees').innerHTML=marketplaceFeeRows();el('mcAdd').disabled=marketplaceDraft.fees[marketplaceDraft.market].length>=12;updateMarketplaceResults();refreshIcons();}
function marketplaceCalculatorView(){
  marketplaceDraft=structuredClone(business.marketplaceCalculator||MarketplaceFees.defaults());
  const s=marketplaceDraft,i=s.inputs,target=s.mode==='target',result=marketplaceResults();
  return `<section id="marketplaceCalculator"><div class="mc-top"><div class="view-tabs" aria-label="Marketplace">${[['shopee','Shopee'],['tokopedia','Tokopedia']].map(([id,name])=>`<button data-mc-market="${id}" aria-pressed="${s.market===id}" class="${s.market===id?'active':''}">${name}</button>`).join('')}</div><button class="button" data-mc-save title="Simpan pengaturan kalkulator">${icon('save')}Simpan</button></div>
  <div class="mc-mode" aria-label="Mode kalkulator">${[['deductions','Hitung potongan'],['target','Cari harga jual']].map(([id,name])=>`<button data-mc-mode="${id}" aria-pressed="${s.mode===id}">${name}</button>`).join('')}</div>
  <div class="mc-layout"><section aria-label="Transaksi dan tarif"><div class="mc-inputs">
    ${marketplaceInput('HPP / unit (Rp)','cost',i.cost)}${marketplaceInput('Jumlah unit','qty',i.qty,'integer')}
    ${target?marketplaceInput('Target laba / pesanan (Rp)','target',i.target)+marketplaceSelect('Pembulatan harga','rounding',i.rounding,[[1,'Rp 1'],[100,'Rp 100'],[1000,'Rp 1.000']]):`<div class="mc-wide">${marketplaceInput('Harga jual / unit (Rp)','price',i.price)}</div>`}
    <div class="mc-wide">${marketplaceInput('Diskon / voucher penjual per pesanan (Rp)','discount',i.discount)}</div>
    ${marketplaceInput('Packing per pesanan (Rp)','packing',i.packing)}${marketplaceInput('Ongkir penjual per pesanan (Rp)','shipping',i.shipping)}
  </div><div class="section-heading mc-fee-heading"><h2>Potongan marketplace</h2><button id="mcAdd" class="icon-button" data-mc-add title="Tambah komponen biaya" aria-label="Tambah komponen biaya" ${s.fees[s.market].length>=12?'disabled':''}>${icon('plus')}</button></div><div id="mcFees">${marketplaceFeeRows()}</div>
  <div class="mc-rounding">${marketplaceSelect('Pembulatan tiap potongan','feeRounding',i.feeRounding,[[1,'Ke atas / Rp 1'],[0,'Terdekat / Rp 1'],[-1,'Ke bawah / Rp 1']])}</div><p id="mcError" class="form-error" role="alert">${esc(result.error)}</p></section>
  <aside id="mcResults" class="mc-results" aria-label="Hasil kalkulator" aria-live="polite">${result.html}</aside></div></section>`;
}
moduleViews.marketplace=marketplaceCalculatorView;
function marketplaceRepaint(){el('main').innerHTML=heading()+marketplaceCalculatorView();updateMarketplaceResults();refreshIcons();}
function marketplaceReadInput(input){
  if(input.type==='checkbox')return input.checked;
  if(input.dataset.mcKey==='name')return input.value;
  if(input.tagName==='SELECT')return ['rounding','feeRounding'].includes(input.dataset.mcKey)?Number(input.value):input.value;
  if(input.dataset.mcKind==='money'){
    const parsed=parseMoneyInput(input.value.replaceAll('.',''));
    if(parsed===null)return NaN;
    const pos=input.selectionStart,tail=input.value.slice(pos).replaceAll('.','').length;
    if(parsed!==''){
      const [whole,decimal]=input.value.replaceAll('.','').split(',');
      input.value=Number(whole).toLocaleString('id-ID')+(decimal!==undefined?','+decimal:'');
      let caret=input.value.length,remaining=tail;while(caret>0&&remaining){caret--;if(input.value[caret]!=='.')remaining--;}
      input.setSelectionRange(caret,caret);
    }
    return Number(parsed);
  }
  return Number(input.value.replace(',','.'));
}
function marketplaceChange(e){
  const input=e.target;if(!input.closest('#marketplaceCalculator')||!input.dataset.mcKey)return;
  const key=input.dataset.mcKey,fee=marketplaceDraft.fees[marketplaceDraft.market].find(f=>f.id===input.dataset.mcFee);
  if(input.dataset.mcFee&&!fee)return;
  (fee||marketplaceDraft.inputs)[key]=marketplaceReadInput(input);
  try{saveMarketplaceCalculator();input.setCustomValidity('');}catch(err){input.setCustomValidity?.(err.message);}
  if(fee&&['on','type','base','unit','capped','taxed'].includes(key))refreshMarketplaceFees();
  else{
    if(fee){const row=input.closest('[data-mc-row]');row.querySelector('[data-mc-name]').textContent=fee.name;row.querySelector('[data-mc-description]').textContent=marketplaceFeeDescription(fee);}
    updateMarketplaceResults();
  }
}
document.addEventListener('input',e=>{if(e.target.tagName==='INPUT'&&e.target.type!=='checkbox')marketplaceChange(e);});
document.addEventListener('change',e=>{if(e.target.tagName==='SELECT'||e.target.type==='checkbox')marketplaceChange(e);});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-mc-market],[data-mc-mode],[data-mc-edit],[data-mc-remove],[data-mc-add],[data-mc-save]');if(!b||!marketplaceDraft)return;
  try{
    if(b.hasAttribute('data-mc-edit')){marketplaceExpanded=marketplaceExpanded===b.dataset.mcEdit?null:b.dataset.mcEdit;refreshMarketplaceFees();return;}
    if(b.hasAttribute('data-mc-market')){MarketplaceFees.validate(marketplaceDraft);marketplaceDraft.market=b.dataset.mcMarket;marketplaceExpanded=null;}
    if(b.hasAttribute('data-mc-mode')){MarketplaceFees.validate(marketplaceDraft);marketplaceDraft.mode=b.dataset.mcMode;}
    if(b.hasAttribute('data-mc-add')){const fees=marketplaceDraft.fees[marketplaceDraft.market];if(fees.length>=12)return;const id=nextId('fee');fees.push(MarketplaceFees.fee(id));marketplaceExpanded=id;}
    if(b.hasAttribute('data-mc-remove')){marketplaceDraft.fees[marketplaceDraft.market]=marketplaceDraft.fees[marketplaceDraft.market].filter(f=>f.id!==b.dataset.mcRemove);marketplaceExpanded=null;}
    saveMarketplaceCalculator();
    if(b.hasAttribute('data-mc-save')){await flushMarketplaceCalculator();if(!storageFailed)toast('Kalkulator tersimpan di perangkat. Status cloud ada di bawah.');}
    else marketplaceRepaint();
  }catch(err){el('mcError').textContent=err.message;}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushMarketplaceCalculator();});
document.addEventListener('click',e=>{if(e.target.closest('[data-nav],[data-go],[data-cloud],[data-work]'))flushMarketplaceCalculator();},true);
window.addEventListener('beforeunload',()=>{flushMarketplaceCalculator();});
