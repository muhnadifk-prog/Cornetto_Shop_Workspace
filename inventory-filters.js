'use strict';
let stockPeriod='all',stockStart='',stockEnd='';
let stockOnlyAvailable=false;
function stockDateRows(){return inventory.filter(p=>!p.deletedAt&&((!stockStart&&!stockEnd)||p.date&&(!stockStart||p.date>=stockStart)&&(!stockEnd||p.date<=stockEnd)));}
function stockDateControls(){return `<section class="stock-date-filters" aria-label="Filter tanggal masuk"><label class="form-field"><span>Tanggal masuk</span><select id="stockPeriod" aria-label="Periode tanggal masuk">${periodOptions.map(([key,label])=>`<option value="${key}" ${stockPeriod===key?'selected':''}>${label}</option>`).join('')}<option value="custom" ${stockPeriod==='custom'?'selected':''}>Rentang khusus</option></select></label><label class="form-field"><span>Dari tanggal</span><input type="date" id="stockStart" aria-label="Tanggal masuk mulai" value="${stockStart}" max="${TODAY}"></label><span class="date-range-separator" aria-hidden="true">-</span><label class="form-field"><span>Sampai tanggal</span><input type="date" id="stockEnd" aria-label="Tanggal masuk sampai" value="${stockEnd}" max="${TODAY}"></label><button type="button" class="icon-button" data-stock-date-reset title="Hapus filter tanggal" aria-label="Hapus filter tanggal" ${!stockStart&&!stockEnd?'disabled':''}>${icon('rotate-ccw')}</button><p class="form-error" id="stockDateError" role="alert"></p></section>`;}
function updateStockImeiField(f){
  const box=f.querySelector('[data-stock-imei]');if(!box)return;
  const enabled=isPhoneCategory(f.elements.category.value);
  const quantity=Number(f.elements.qty.value),count=Number.isInteger(quantity)&&quantity>0&&quantity<=999?quantity:1;
  f.imeiDraft??=[];
  box.querySelectorAll('input').forEach((input,i)=>{f.imeiDraft[i]=input.value;});
  if(Number(box.dataset.count)!==count){
    box.innerHTML=Array.from({length:count},(_,i)=>field(count===1?'IMEI':'IMEI HP '+(i+1),i===0?'imei':'imei'+(i+1),'text',f.imeiDraft[i]||'','inputmode="numeric" minlength="15" maxlength="15" pattern="[0-9]{15}" autocomplete="off"')).join('');
    box.dataset.count=String(count);
  }
  box.hidden=!enabled;box.querySelectorAll('input').forEach(input=>{input.disabled=!enabled;});
}
document.addEventListener('input',e=>{if(e.target.form?.id==='stockForm'&&e.target.name==='qty')updateStockImeiField(e.target.form);});
document.addEventListener('change',e=>{
  if(e.target.form?.id==='stockForm'&&['category','qty'].includes(e.target.name))updateStockImeiField(e.target.form);
  if(e.target.id==='stockPeriod'){
    stockPeriod=e.target.value;
    if(stockPeriod==='all')stockStart=stockEnd='';
    else if(stockPeriod!=='custom'){const range=periodRange(stockPeriod);stockStart=range.start;stockEnd=range.end;}
    page=1;render();return;
  }
  if(['stockStart','stockEnd'].includes(e.target.id)){
    const start=el('stockStart').value,end=el('stockEnd').value;
    const invalid=(start&&!CardSchedule.validDate(start))||(end&&!CardSchedule.validDate(end))||start>TODAY||end>TODAY||(start&&end&&start>end);
    el('stockDateError').textContent=invalid?'Periksa rentang: tanggal awal tidak boleh setelah tanggal akhir atau hari ini. Filter sebelumnya tetap berlaku.':'';
    if(invalid)return;
    stockStart=start;stockEnd=end;stockPeriod=start||end?'custom':'all';page=1;render();
  }
});
document.addEventListener('click',e=>{if(e.target.closest('[data-stock-date-reset]')){stockPeriod='all';stockStart=stockEnd='';page=1;render();}});
