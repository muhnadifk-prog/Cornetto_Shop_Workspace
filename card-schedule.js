'use strict';
var CardSchedule=(()=>{
  const iso=d=>d.toISOString().slice(0,10);
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&iso(d)===value;
  }
  function validRule(c){return Number.isInteger(c.statementDay)&&c.statementDay>=1&&c.statementDay<=31&&Number.isInteger(c.dueAfterDays)&&c.dueAfterDays>=1&&c.dueAfterDays<=60;}
  function cycles(c,today,count=1){
    if(!validRule(c)||!validDate(today))return [];
    const base=new Date(today+'T12:00:00Z'),result=[];
    // UTC calendar arithmetic avoids timezone shifts; a short month clamps the statement day.
    for(let offset=-3;result.length<count&&offset<count+3;offset++){
      const month=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+offset,1,12));
      const last=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0,12)).getUTCDate();
      const statement=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),Math.min(c.statementDay,last),12));
      const due=new Date(statement);due.setUTCDate(due.getUTCDate()+c.dueAfterDays);
      if(iso(due)>=today)result.push({statement:iso(statement),due:iso(due)});
    }
    return result;
  }
  function due(c,today){return c.dueMode==='cycle'?(cycles(c,today)[0]?.due||''):(c.due||'');}
  return {validDate,validRule,cycles,due};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CardSchedule;
function cardToday(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});}
function cardDue(c){return CardSchedule.due(c,cardToday());}
function cardDate(value){return value?new Date(value+'T12:00:00Z').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Belum diisi';}
function cardScheduleSummary(c){return c.dueMode==='cycle'?`<div class="credit-meta"><span>Cetak tgl ${c.statementDay}</span><span>H+${c.dueAfterDays} hari kalender</span></div>`:'';}
function cardScheduleFields(c){
  const recurring=c?c.dueMode==='cycle':true;
  return `${selectField('Aturan jatuh tempo','dueMode',`<option value="cycle" ${recurring?'selected':''}>Tanggal cetak + H+</option><option value="manual" ${!recurring?'selected':''}>Tanggal manual</option>`)}<div class="field-pair" data-schedule-cycle ${recurring?'':'hidden'}>${field('Tanggal cetak bulanan','statementDay','number',c?.statementDay??'',`min="1" max="31" step="1" ${recurring?'required':'disabled'}`)}${field('Jatuh tempo H+ (hari kalender)','dueAfterDays','number',c?.dueAfterDays??'',`min="1" max="60" step="1" ${recurring?'required':'disabled'}`)}</div><div data-schedule-manual ${recurring?'hidden':''}>${field('Jatuh tempo manual','due','date',c?.due||'',recurring?'disabled':'')}</div><p class="form-hint" data-schedule-note ${recurring?'':'hidden'}>Tanggal cetak yang tidak tersedia memakai akhir bulan. Belum termasuk penyesuaian hari libur bank.</p><div id="cardSchedulePreview" class="schedule-preview" aria-live="polite">${recurring?cardSchedulePreview(c||{}):''}</div>`;
}
function cardSchedulePreview(c){
  const rows=CardSchedule.cycles(c,cardToday(),3);
  return rows.length?`<h3>Jadwal berikutnya</h3><table><thead><tr><th>Cetak</th><th>Jatuh tempo</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${cardDate(r.statement)}</td><td>${cardDate(r.due)}</td></tr>`).join('')}</tbody></table>`:'';
}
function updateCardScheduleForm(f){
  const recurring=f.elements.dueMode.value==='cycle';
  f.querySelector('[data-schedule-cycle]').hidden=!recurring;f.querySelector('[data-schedule-manual]').hidden=recurring;f.querySelector('[data-schedule-note]').hidden=!recurring;
  for(const name of ['statementDay','dueAfterDays']){f.elements[name].disabled=!recurring;f.elements[name].required=recurring;}
  f.elements.due.disabled=recurring;
  f.querySelector('#cardSchedulePreview').innerHTML=recurring?cardSchedulePreview({statementDay:Number(f.elements.statementDay.value),dueAfterDays:Number(f.elements.dueAfterDays.value)}):'';
}
if(typeof document!=='undefined'){
  for(const event of ['input','change'])document.addEventListener(event,e=>{const f=e.target.closest('#cardForm');if(f&&['dueMode','statementDay','dueAfterDays'].includes(e.target.name))updateCardScheduleForm(f);});
}

