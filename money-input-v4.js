'use strict';
function moneyInputText(value){
  if(value==='')return '';
  return new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(Number(value));
}
function parseMoneyInput(text){
  const value=String(text).trim();
  if(!value)return '';
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(value))return null;
  const n=Number(value.replaceAll('.','').replace(',','.'));
  return Number.isFinite(n)&&n<=1e12?String(n):null;
}
function moneyField(label,name,value,extra){
  return `<label class="form-field"><span>${label}</span><input type="hidden" name="${name}" value="${esc(value)}" ${extra}><input type="text" inputmode="decimal" autocomplete="off" data-money="${name}" value="${esc(moneyInputText(value))}" ${extra}></label>`;
}
function linkedMoneyInput(input){
  const name=input.dataset.money;
  if(!name)return null;
  const sibling=input.previousElementSibling;
  if(sibling?.tagName==='INPUT'&&sibling.type==='hidden'&&sibling.name===name)return sibling;
  return [...(input.form?.elements||[])].find(control=>control.name===name)||null;
}
function validateMoneyInput(input){
  const raw=linkedMoneyInput(input);if(!raw)return;
  input.disabled=raw.disabled;
  const value=parseMoneyInput(input.value),n=Number(value);
  const invalid=value===null||(value!==''&&((raw.hasAttribute('min')&&n<Number(raw.min||raw.getAttribute('min')))||(raw.hasAttribute('max')&&n>Number(raw.max||raw.getAttribute('max')))));
  input.setCustomValidity(invalid?'Masukkan nominal yang valid, contoh 1.250.000 atau 1.250,50.':'');
  raw.value=value===null?'':value;
}
function syncMoneyInputs(root=document){
  root.querySelectorAll('[data-money]').forEach(input=>{const raw=linkedMoneyInput(input);if(raw&&document.activeElement!==input){input.value=moneyInputText(raw.value);input.disabled=raw.disabled;input.setCustomValidity('');}});
}
document.addEventListener('input',e=>{
  const input=e.target;if(!input.dataset?.money)return;
  const position=input.selectionStart,tail=input.value.slice(position).replace(/\./g,'').length;
  const value=parseMoneyInput(input.value);
  validateMoneyInput(input);
  if(value!==null&&value!==''){
    const [whole,decimal]=input.value.replaceAll('.','').split(',');
    input.value=Number(whole).toLocaleString('id-ID')+(decimal!==undefined?','+decimal:'');
    let caret=input.value.length,remaining=tail;
    while(caret>0&&remaining){caret--;if(input.value[caret]!=='.')remaining--;}
    try{input.setSelectionRange(caret,caret);}catch{}
  }
},true);
document.addEventListener('change',()=>syncMoneyInputs());
document.addEventListener('submit',e=>{
  for(const input of e.target.querySelectorAll('[data-money]'))if(!input.disabled)validateMoneyInput(input);
  if(!e.target.checkValidity()){e.preventDefault();e.stopImmediatePropagation();e.target.reportValidity();}
},true);

const calculatorState={entry:'0',value:null,operator:null,fresh:true};
function calculatorKey(key){
  const s=calculatorState;
  if(s.entry==='Error'&&key!=='clear')Object.assign(s,{entry:'0',value:null,operator:null,fresh:true});
  if(key==='clear'){Object.assign(s,{entry:'0',value:null,operator:null,fresh:true});}
  else if(key==='back'){s.entry=s.entry.length>1?s.entry.slice(0,-1):'0';s.fresh=false;}
  else if(key==='sign'){if(Number(s.entry))s.entry=String(-Number(s.entry));}
  else if(key==='percent'){s.entry=String(Number(s.entry)/100);}
  else if(/^[0-9.]$/.test(key)){
    if(s.fresh){s.entry=key==='.'?'0.':key;s.fresh=false;}
    else if(key==='.'&&!s.entry.includes('.'))s.entry+='.';
    else if(key!=='.'&&s.entry.replace(/[-.]/g,'').length<15)s.entry=s.entry==='0'?key:s.entry+key;
  }else if(['+','-','*','/','='].includes(key)){
    const b=Number(s.entry);
    if(s.operator&&s.value!==null&&!s.fresh){
      const a=s.value,result=s.operator==='+'?a+b:s.operator==='-'?a-b:s.operator==='*'?a*b:b===0?NaN:a/b;
      if(!Number.isFinite(result)){Object.assign(s,{entry:'Error',value:null,operator:null,fresh:true});return s.entry;}
      s.entry=String(Number(result.toPrecision(14)));
    }
    s.value=Number(s.entry);s.operator=key==='='?null:key;s.fresh=true;
  }
  return s.entry;
}
function calculatorRefresh(){
  const s=calculatorState,display=el('calculatorDisplay');
  display.textContent=s.entry==='Error'?'Tidak dapat dihitung':Number(s.entry).toLocaleString('id-ID',{maximumFractionDigits:12})+(s.entry.endsWith('.')?',':'');
}
function openCalculator(){
  const d=el('calculator');
  d.querySelector('.calculator-keys').innerHTML=[['clear','AC'],['sign','+/-'],['percent','%'],['/','/'],['7','7'],['8','8'],['9','9'],['*','x'],['4','4'],['5','5'],['6','6'],['-','-'],['1','1'],['2','2'],['3','3'],['+','+'],['back',icon('delete')],['0','0'],['.',','],['=','=']].map(([key,label])=>`<button type="button" data-calc-key="${key}" title="${key==='back'?'Hapus satu angka':key==='clear'?'Bersihkan':label}" aria-label="${key==='back'?'Hapus satu angka':key==='clear'?'Bersihkan':label}" class="${key==='='?'primary':''}">${label}</button>`).join('');
  calculatorRefresh();d.showModal();refreshIcons();
}
document.addEventListener('click',e=>{
  const action=e.target.closest('[data-calculator],[data-calc-key]');if(!action)return;
  if(action.dataset.calculator==='open')openCalculator();
  else if(action.dataset.calculator==='close')el('calculator').close();
  else{calculatorKey(action.dataset.calcKey);calculatorRefresh();}
});
document.addEventListener('keydown',e=>{
  if(!el('calculator')?.open)return;
  const key=e.key==='Enter'?'=':e.key==='Backspace'?'back':e.key==='Delete'?'clear':e.key===','?'.':e.key;
  if(/^[0-9.+*/=\-%]$/.test(key)||['back','clear'].includes(key)){e.preventDefault();calculatorKey(key==='%'?'percent':key);calculatorRefresh();}
});


