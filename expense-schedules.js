'use strict';
const expenseFrequency={monthly:'Bulanan',weekly:'Mingguan',yearly:'Tahunan'};
function addCalendarDays(iso,days){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function scheduledDate(version,index){
  if(version.frequency==='weekly')return addCalendarDays(version.startDate,index*7);
  return statementOn(version.startDate.slice(0,7),Number(version.startDate.slice(8)),index*(version.frequency==='yearly'?12:1));
}
function scheduleOccurrences(schedule,until){
  const rows=[],seen=new Set();
  for(const v of schedule.versions){
    if(v.pausedBeforeStart)continue;
    const end=[until,v.endDate,v.through].filter(Boolean).sort()[0];
    for(let i=0;i<6000;i++){
      const due=scheduledDate(v,i);if(due>end)break;
      if(due<v.from||seen.has(due))continue;seen.add(due);
      rows.push({id:'scheduled-'+schedule.id+'-'+due,date:due,dueDate:due,name:v.name,category:v.category,amount:v.amount,scheduleId:schedule.id,source:'scheduled-expense',paymentStatus:'unconfirmed',bookKey:'scheduled:'+schedule.id+':'+due});
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
function scheduledExpenseRows(state,today=TODAY){
  const corrections=new Map((state.business.scheduledExpenseCorrections||[]).map(r=>[r.scheduleId+':'+r.dueDate,r]));
  return (state.business.expenseSchedules||[]).flatMap(s=>scheduleOccurrences(s,today).flatMap(row=>{
    const edit=corrections.get(s.id+':'+row.dueDate);return edit?.deleted?[]:[{...row,...edit}];
  }));
}
function nextScheduledDate(schedule,today=TODAY){
  if(!schedule.active)return '';
  const until=[addCalendarDays(today,370),schedule.versions.at(-1).startDate].sort().at(-1);
  return scheduleOccurrences(schedule,until).find(r=>r.dueDate>today)?.dueDate||'';
}
function validateExpenseSchedules(state){
  const schedules=state.business.expenseSchedules||[],corrections=state.business.scheduledExpenseCorrections||[],ids=new Set();
  if(!Array.isArray(schedules)||schedules.length>500||!Array.isArray(corrections))throw Error('Jadwal beban tidak valid.');
  for(const s of schedules){
    if(!/^[a-zA-Z0-9_-]+$/.test(s.id)||ids.has(s.id)||typeof s.active!=='boolean'||!Array.isArray(s.versions)||!s.versions.length||s.versions.length>500)throw Error('Identitas jadwal beban tidak valid.');ids.add(s.id);
    let previous='';
    for(const v of s.versions){
      if(typeof v.name!=='string'||!v.name.trim()||v.name.length>200||typeof v.category!=='string'||!v.category.trim()||v.category.length>100||!installmentMoney(v.amount)||v.amount<=0||!Object.hasOwn(expenseFrequency,v.frequency)||!CardSchedule.validDate(v.startDate)||v.startDate<'2000-01-01'||v.startDate>'2099-12-31'||!CardSchedule.validDate(v.from)||v.from<v.startDate||(v.endDate&&(!CardSchedule.validDate(v.endDate)||v.endDate<v.startDate||v.endDate>'2099-12-31'))||(v.through&&(!CardSchedule.validDate(v.through)||v.through<v.from))||(previous&&previous>=v.from))throw Error('Rincian jadwal beban tidak valid.');
      previous=v.through||'9999-12-31';
    }
    if(!s.active&&!s.versions.at(-1).through)throw Error('Jadwal nonaktif harus memiliki batas riwayat.');
  }
  const keys=new Set();
  for(const r of corrections){
    const key=r.scheduleId+':'+r.dueDate,s=schedules.find(s=>s.id===r.scheduleId);
    if(keys.has(key)||!s||!CardSchedule.validDate(r.dueDate)||r.dueDate>TODAY||!scheduleOccurrences(s,r.dueDate).some(x=>x.dueDate===r.dueDate)||(!r.deleted&&(!CardSchedule.validDate(r.date)||r.date>TODAY||!installmentMoney(r.amount)||r.amount<=0||typeof r.name!=='string'||typeof r.category!=='string')))throw Error('Koreksi beban terjadwal tidak valid.');keys.add(key);
  }
}
function prepareExpenseSchedule(state,id,d,baseline,action='save',today=TODAY){
  const next=structuredClone(state);next.business.expenseSchedules??=[];
  let schedule=next.business.expenseSchedules.find(s=>s.id===id);
  if(id&&(!schedule||JSON.stringify(schedule)!==baseline))throw Error('Jadwal berubah. Buka kembali jadwal.');
  const tomorrow=addCalendarDays(today,1);
  if(action==='save'){
    const version={name:String(d.name||'').trim(),category:String(d.category||'').trim(),amount:Number(d.amount),frequency:d.frequency,startDate:d.startDate,endDate:d.endDate||'',from:d.startDate};
    if(schedule){
      // Freeze elapsed occurrences before changing future dates or amounts.
      schedule.versions=schedule.versions.filter(v=>v.from<=today).map(v=>({...v,through:v.through&&v.through<today?v.through:today}));
      version.from=version.startDate>tomorrow?version.startDate:tomorrow;
      if(version.endDate&&version.endDate<version.from)throw Error('Tanggal akhir jadwal baru harus setelah hari ini.');
      schedule.versions.push(version);schedule.active=true;delete schedule.archived;
    }else{schedule={id:nextId('schedule'),active:true,versions:[version]};next.business.expenseSchedules.push(schedule);}
  }else if(action==='pause'||action==='archive'){
    if(!schedule)throw Error('Jadwal tidak ditemukan.');
    const history=schedule.versions.filter(v=>v.from<=today).map(v=>({...v,through:v.through&&v.through<today?v.through:today}));
    if(!history.length){const v=schedule.versions.at(-1);history.push({...v,through:v.from,pausedBeforeStart:true});}
    schedule.versions=history;schedule.active=false;if(action==='archive')schedule.archived=true;
  }else if(action==='resume'){
    if(!schedule||schedule.active)throw Error('Jadwal sudah aktif.');
    const v={...schedule.versions.at(-1),from:tomorrow};delete v.through;delete v.pausedBeforeStart;
    if(v.startDate>v.from)v.from=v.startDate;
    if(v.endDate&&v.endDate<v.from)throw Error('Tanggal akhir telah lewat. Edit tanggal akhir terlebih dahulu.');
    schedule.versions=schedule.versions.filter(v=>!v.pausedBeforeStart);schedule.versions.push(v);schedule.active=true;delete schedule.archived;
  }
  validateSnapshot(next);return next;
}
function expenseSchedulesView(){
  const schedules=(business.expenseSchedules||[]).filter(s=>!s.archived);
  return `<section class="scheduled-expenses"><div class="section-heading"><h2>Jadwal beban</h2><button class="button primary" data-expense-schedule="new">${icon('plus')}Buat jadwal</button></div>${schedules.map(s=>{const v=s.versions.at(-1),next=nextScheduledDate(s),count=scheduleOccurrences(s,TODAY).length;return `<article class="expense-schedule-row"><div><h3>${esc(v.name)}</h3><p>${esc(v.category)} / ${expenseFrequency[v.frequency]} / ${s.active?'Aktif':'Dijeda'}</p><p>Berikutnya: ${next?dayFirstDate(next):'-'} / ${count} catatan</p></div><strong>${money(v.amount)}</strong><div class="books-actions"><button class="icon-button" data-expense-schedule="edit" data-id="${s.id}" title="Edit jadwal" aria-label="Edit jadwal ${esc(v.name)}">${icon('pencil')}</button><button class="icon-button" data-expense-schedule="${s.active?'pause':'resume'}" data-id="${s.id}" title="${s.active?'Jeda':'Aktifkan'} jadwal" aria-label="${s.active?'Jeda':'Aktifkan'} jadwal ${esc(v.name)}">${icon(s.active?'pause':'play')}</button><button class="icon-button danger" data-expense-schedule="archive" data-id="${s.id}" title="Hentikan jadwal" aria-label="Hentikan jadwal ${esc(v.name)}">${icon('archive')}</button></div></article>`;}).join('')||'<p class="empty">Belum ada jadwal beban.</p>'}</section>`;
}
function expenseScheduleForm(id='',action='save'){
  const s=(business.expenseSchedules||[]).find(s=>s.id===id),v=s?.versions.at(-1)||{};
  const edit=action==='save',title=edit?(s?'Edit jadwal beban':'Buat jadwal beban'):action==='pause'?'Jeda jadwal?':action==='resume'?'Aktifkan jadwal?':'Hentikan jadwal?';
  openDrawer(title,`<form id="expenseScheduleForm" data-id="${id}" data-action="${action}">${edit?`${field('Keterangan','name','text',v.name||'','required maxlength="200"')}${field('Kategori','category','text',v.category||'Operasional','required maxlength="100"')}${field('Nominal setiap jadwal (Rp)','amount','number',v.amount||'','required min="0.01" step="0.01"')}${selectField('Pengulangan','frequency',Object.entries(expenseFrequency).map(([key,label])=>`<option value="${key}" ${key===v.frequency?'selected':''}>${label}</option>`).join(''))}<div class="field-pair">${field('Tanggal pertama','startDate','date',v.startDate||TODAY,'required min="2000-01-01" max="2099-12-31"')}${field('Tanggal terakhir','endDate','date',v.endDate||'','min="2000-01-01" max="2099-12-31"')}</div><p class="book-edit-notice">${s?'Perubahan berlaku untuk jadwal setelah hari ini. Catatan sebelumnya tetap.':'Beban otomatis masuk laporan pada tanggal terjadwal, termasuk tanggal yang sudah lewat.'} Pembayaran belum dikonfirmasi.</p>`:`<strong>${esc(v.name)}</strong><p class="book-edit-notice">${action==='resume'?'Pencatatan otomatis dilanjutkan untuk jadwal setelah hari ini.':'Jadwal setelah hari ini dihentikan. Catatan sebelumnya tetap tersedia.'}</p>`}${formFooter(edit?'Simpan jadwal':action==='resume'?'Aktifkan jadwal':action==='pause'?'Jeda jadwal':'Hentikan jadwal')}</form>`,'BEBAN TERJADWAL');
  el('expenseScheduleForm').dataset.baseline=JSON.stringify(s);
}
document.addEventListener('click',e=>{const a=e.target.closest('[data-expense-schedule]');if(!a)return;const action=a.dataset.expenseSchedule;expenseScheduleForm(a.dataset.id||'',['new','edit'].includes(action)?'save':action);});
document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id!=='expenseScheduleForm')return;e.preventDefault();if(f.dataset.saving)return;
  f.dataset.saving='true';const button=f.querySelector('[type="submit"]');button.disabled=true;let saving=false;
  try{await saveQueue;if(storageFailed)throw Error('Penyimpanan belum siap.');const next=prepareExpenseSchedule(snapshot(),f.dataset.id,Object.fromEntries(new FormData(f)),f.dataset.baseline,f.dataset.action);savePending++;saving=true;updateStorageBadge();await persist(next);applyState(next);closeDrawer();render();toast('Jadwal beban tersimpan.');}catch(err){formError(err.message);}finally{if(saving)savePending--;updateStorageBadge();delete f.dataset.saving;if(button.isConnected)button.disabled=false;}
});
function refreshBusinessDate(){
  if(!db||document.hidden||document.querySelector('dialog[open]'))return;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
  if(today!==TODAY){TODAY=today;el('todayLabel').textContent=new Date(TODAY+'T12:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});render();}
}
window.addEventListener('focus',refreshBusinessDate);
document.addEventListener('visibilitychange',refreshBusinessDate);
if(typeof setInterval==='function')setInterval(refreshBusinessDate,60000);
