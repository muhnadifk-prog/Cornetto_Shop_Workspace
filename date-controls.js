'use strict';
function pickerDate(text,format){
  if(text instanceof Date)return text;
  const value=String(text||'').trim(),iso=format==='d/m/Y'?parseDayFirstDate(value):value;
  if(!CardSchedule.validDate(iso))return undefined;
  const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d,12);
}
function pickerDraft(input){
  const fp=input._flatpickr,alt=fp?.altInput;if(!alt)return true;
  let value=alt.value.trim();if(/^\d{8}$/.test(value)){value=value.replace(/^(\d{2})(\d{2})(\d{4})$/,'$1/$2/$3');alt.value=value;}
  const iso=parseDayFirstDate(value),invalid=!!value&&(!iso||(input.min&&iso<input.min)||(input.max&&iso>input.max));
  if(invalid)alt.dataset.invalidDate=value;else delete alt.dataset.invalidDate;
  alt.setCustomValidity(invalid?'Gunakan tanggal valid dd/mm/yyyy dalam rentang yang tersedia.':'');
  input.value=invalid?'':iso;return !invalid;
}
function preserveInvalidDate(fp){
  if(!fp.altInput.dataset.invalidDate)return false;
  fp.altInput.value=fp.altInput.dataset.invalidDate;fp.input.value='';
  fp.altInput.setCustomValidity('Gunakan tanggal valid dd/mm/yyyy dalam rentang yang tersedia.');return true;
}
function syncDateControls(root=document){
  if(typeof flatpickr!=='function')return;
  root.querySelectorAll('input[type="date"]').forEach(input=>{
    if(input._flatpickr)return;
    const label=input.getAttribute('aria-label')||input.closest('label')?.querySelector('span')?.textContent||input.name||'Tanggal';
    flatpickr(input,{locale:'id',dateFormat:'Y-m-d',altInput:true,altFormat:'d/m/Y',allowInput:true,disableMobile:true,static:true,ariaDateFormat:'d F Y',parseDate:pickerDate,errorHandler:()=>{},minDate:input.min||undefined,maxDate:input.max||undefined,
      onReady:(_,value,fp)=>{
        input.dataset.calendar='true';fp.altInput.setAttribute('aria-label',label);fp.altInput.placeholder='dd/mm/yyyy';fp.altInput.inputMode='numeric';fp.altInput.maxLength=10;fp.altInput.autocomplete='off';fp.altInput.dataset.calendarDisplay='true';
        fp.altInput.addEventListener('input',()=>pickerDraft(input));
        const choosingDay=e=>{if(e.target.closest('.flatpickr-day:not(.flatpickr-disabled)')&&(e.type==='pointerdown'||['Enter',' '].includes(e.key))){delete fp.altInput.dataset.invalidDate;fp.altInput.setCustomValidity('');}};
        fp.calendarContainer.addEventListener('pointerdown',choosingDay,true);fp.calendarContainer.addEventListener('keydown',choosingDay,true);
        fp.calendarContainer.setAttribute('aria-label','Kalender '+label);
        fp.monthsDropdownContainer?.setAttribute('aria-label','Bulan');fp.currentYearElement.setAttribute('aria-label','Tahun');
        fp.prevMonthNav.setAttribute('aria-label','Bulan sebelumnya');fp.nextMonthNav.setAttribute('aria-label','Bulan berikutnya');
      },
      onOpen:(_,value,fp)=>{const wrapper=fp.input.parentElement.getBoundingClientRect(),width=fp.calendarContainer.offsetWidth;fp.calendarContainer.style.left=Math.max(-wrapper.left+8,Math.min(0,document.documentElement.clientWidth-wrapper.left-width-8))+'px';},
      onChange:(_,value,fp)=>{if(!preserveInvalidDate(fp))fp.altInput.setCustomValidity('');},
      onClose:(_,value,fp)=>preserveInvalidDate(fp)
    });
  });
  root.querySelectorAll('input[data-calendar]').forEach(input=>{
    const fp=input._flatpickr;if(!fp)return;
    fp.altInput.disabled=input.disabled;fp.altInput.required=input.required;
    if(document.activeElement!==fp.altInput&&fp.altInput.value!==dayFirstDate(input.value)&&!fp.altInput.validity.customError)fp.setDate(input.value,false,'Y-m-d');
  });
}
function destroyDateControls(root){root?.querySelectorAll('input[data-calendar]').forEach(input=>input._flatpickr?.destroy());}
const fieldBeforeDates=field;
field=function(label,name,type,value='',extra=''){return fieldBeforeDates(type==='date'&&!label.includes('dd/mm/yyyy')?label+' (dd/mm/yyyy)':label,name,type,value,extra);};
const renderBeforeDates=render;
render=function(){destroyDateControls(el('main'));renderBeforeDates();syncDateControls(el('main'));};
const drawerBeforeDates=openDrawer;
openDrawer=function(...args){destroyDateControls(el('drawerBody'));drawerBeforeDates(...args);syncDateControls(el('drawerBody'));};
document.addEventListener('change',()=>queueMicrotask(()=>syncDateControls()));
document.addEventListener('submit',e=>{
  e.target.querySelectorAll('input[data-calendar]').forEach(input=>{if(!input.disabled)pickerDraft(input);});
  if(!e.target.checkValidity()){e.preventDefault();e.stopImmediatePropagation();e.target.reportValidity();}
},true);
