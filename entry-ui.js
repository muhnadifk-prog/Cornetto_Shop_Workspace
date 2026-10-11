'use strict';
function dayFirstDate(iso){return /^\d{4}-\d{2}-\d{2}$/.test(iso||'')?iso.split('-').reverse().join('/'):'';}
function parseDayFirstDate(value){
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if(!match)return '';
  const iso=`${match[3]}-${match[2]}-${match[1]}`;
  return CardSchedule.validDate(iso)?iso:'';
}
function dayFirstField(label,name,iso){return `<label class="form-field"><span>${esc(label)} (dd/mm/yyyy)</span><input type="hidden" name="${name}" value="${esc(iso)}"><input type="text" data-date="${name}" inputmode="numeric" placeholder="dd/mm/yyyy" value="${dayFirstDate(iso)}" maxlength="10" required autocomplete="off"></label>`;}
function validateDayFirstInput(input){
  if(/^\d{8}$/.test(input.value))input.value=input.value.replace(/^(\d{2})(\d{2})(\d{4})$/,'$1/$2/$3');
  const iso=parseDayFirstDate(input.value),valid=iso&&iso>='2000-01-01'&&iso<=TODAY;
  input.setCustomValidity(valid?'':'Isi tanggal valid dengan format dd/mm/yyyy, tidak melebihi hari ini.');
  input.previousElementSibling.value=valid?iso:'';
}
document.addEventListener('input',e=>{if(e.target.matches('[data-date]'))validateDayFirstInput(e.target);},true);
document.addEventListener('submit',e=>{
  e.target.querySelectorAll('[data-date]').forEach(validateDayFirstInput);
  if(!e.target.checkValidity()){e.preventDefault();e.stopImmediatePropagation();e.target.reportValidity();}
},true);

function addSaleProductSearch(form){
  const select=form.elements.productId;
  const options=Array.from(select.options,o=>({value:o.value,label:o.textContent}));
  select.required=true;
  const label=document.createElement('label');label.className='form-field sale-product-search';
  label.innerHTML='<span>Cari produk / IMEI</span><input type="search" placeholder="Nama, varian, atau IMEI..." aria-label="Cari produk untuk penjualan" autocomplete="off"><small role="status" aria-live="polite"></small>';
  select.closest('label').before(label);
  const input=label.querySelector('input'),status=label.querySelector('small');
  input.addEventListener('input',()=>{
    const words=input.value.toLocaleLowerCase('id').trim().split(/\s+/),selected=select.value;
    const matches=options.filter(o=>words.every(w=>o.label.toLocaleLowerCase('id').includes(w)));
    select.innerHTML='<option value="">'+(matches.length?'Pilih produk':'Tidak ada produk yang cocok')+'</option>'+matches.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    select.value=matches.some(o=>o.value===selected)?selected:'';
    status.textContent=matches.length+' produk cocok';
    if(select.value)return;
    if(form.id==='saleForm'){
      el('available').textContent='Belum ada produk dipilih';
      el('estimatedFee').textContent='-';el('estimatedProfit').textContent='-';
    }else{el('editSaleCost').textContent='-';el('editSaleProfit').textContent='-';}
  });
}
const saleFormWithoutSearch=saleForm;
saleForm=function(productId){saleFormWithoutSearch(productId);const f=el('saleForm');if(f)addSaleProductSearch(f);};
const editSaleWithoutSearch=editSaleForm;
editSaleForm=function(id){editSaleWithoutSearch(id);const f=el('saleEditForm');if(f)addSaleProductSearch(f);};
const estimateWithProduct=updateEstimate;
updateEstimate=function(){const f=el('saleForm');if(f&&productById(f.elements.productId.value))estimateWithProduct();};

document.addEventListener('change',e=>{
  const f=e.target.form;if(f?.id!=='stockForm'||!['payMethod','date'].includes(e.target.name)&&!e.target.dataset.date)return;
  const card=cards.find(c=>c.id===f.elements.payMethod.value),purchase=f.elements.date.value;
  if(!card||!CardSchedule.validDate(purchase))return;
  const month=purchase.slice(0,7);
  f.elements.firstMonth.value=card.statementDay&&statementOn(month,card.statementDay)<purchase?statementOn(month,1,1).slice(0,7):month;
  updateInstallmentFields(f);
});
