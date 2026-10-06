'use strict';
let stockPeriod='all',stockStart='',stockEnd='';
function stockDateRows(){return inventory.filter(p=>(!stockStart&&!stockEnd)||p.date&&(!stockStart||p.date>=stockStart)&&(!stockEnd||p.date<=stockEnd));}
function stockDateControls(){return `<section class="stock-date-filters" aria-label="Filter tanggal masuk"><label class="form-field"><span>Tanggal masuk</span><select id="stockPeriod" aria-label="Periode tanggal masuk">${periodOptions.map(([key,label])=>`<option value="${key}" ${stockPeriod===key?'selected':''}>${label}</option>`).join('')}<option value="custom" ${stockPeriod==='custom'?'selected':''}>Rentang khusus</option></select></label><label class="form-field"><span>Dari tanggal</span><input type="date" id="stockStart" aria-label="Tanggal masuk mulai" value="${stockStart}" max="${TODAY}"></label><span class="date-range-separator" aria-hidden="true">-</span><label class="form-field"><span>Sampai tanggal</span><input type="date" id="stockEnd" aria-label="Tanggal masuk sampai" value="${stockEnd}" max="${TODAY}"></label><button type="button" class="icon-button" data-stock-date-reset title="Hapus filter tanggal" aria-label="Hapus filter tanggal" ${!stockStart&&!stockEnd?'disabled':''}>${icon('rotate-ccw')}</button><p class="form-error" id="stockDateError" role="alert"></p></section>`;}
function updateStockImeiField(f){
  const box=f.querySelector('[data-stock-imei]');if(!box)return;
  const enabled=isPhoneCategory(f.elements.category.value);
  box.hidden=!enabled;f.elements.imei.disabled=!enabled;
}
document.addEventListener('change',e=>{
  if(e.target.form?.id==='stockForm'&&e.target.name==='category')updateStockImeiField(e.target.form);
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
