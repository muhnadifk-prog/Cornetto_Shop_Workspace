'use strict';
let selectedChartKey='';
function performanceSeries(rows,start,end,monthly=false){
  const buckets=new Map(),cursor=new Date(start+'T12:00:00Z');
  if(monthly)cursor.setUTCDate(1);
  while(cursor.toISOString().slice(0,10)<=end){
    const key=cursor.toISOString().slice(0,monthly?7:10);
    buckets.set(key,{key,revenue:0,profit:0,units:0,transactions:0});
    if(monthly)cursor.setUTCMonth(cursor.getUTCMonth()+1);else cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  for(const s of rows){const b=buckets.get(s.date.slice(0,monthly?7:10));if(b){b.revenue+=revenue(s);b.profit+=profit(s);b.units+=s.qty;b.transactions++;}}
  return [...buckets.values()];
}
function performanceView(){
  return `<div class="section-heading performance-heading"><div><h2>Performa penjualan</h2><p>${periodLabel()}</p></div><div class="segmented" aria-label="Metrik grafik">${[['revenue','Omzet'],['profit','Laba transaksi'],['units','Unit terjual']].map(([key,label])=>`<button data-metric="${key}" aria-pressed="${graphMetric===key}" class="${graphMetric===key?'active':''}">${label}</button>`).join('')}</div></div><div class="legend"><span><b></b>${graphMetric==='units'?'Unit terjual':graphMetric==='profit'?'Laba transaksi':'Omzet'}</span><span>${graphMetric==='units'?'Dalam unit':'Dalam juta rupiah'}</span></div><div class="chart"><canvas id="chart" tabindex="0" role="img" aria-label="Performa penjualan" aria-describedby="chartReadout"></canvas><span id="chartTooltip" class="chart-tooltip" hidden></span></div><div class="chart-selection"><label>Tanggal <input id="chartDate" type="date" aria-label="Tanggal performa penjualan"></label><output id="chartReadout" aria-live="polite"></output></div>`;
}
drawChart=function(){
  const c=el('chart');if(!c)return;
  const rows=periodSales(),monthly=period==='all';
  const start=monthly?(rows.map(s=>s.date).sort()[0]||TODAY):periodStart(),end=periodEnd();
  const entries=performanceSeries(rows,start,end,monthly);if(!entries.length)return;
  const metric=['revenue','profit','units'].includes(graphMetric)?graphMetric:'revenue',divisor=metric==='units'?1:1e6;
  if(!entries.some(b=>b.key===selectedChartKey))selectedChartKey=(entries.findLast(b=>b.transactions)||entries.at(-1)).key;
  let selected=entries.findIndex(b=>b.key===selectedChartKey),hover=-1;
  const rect=c.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=window.devicePixelRatio||1;
  c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);
  const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
  const values=entries.map(b=>b[metric]/divisor),lo=Math.min(0,...values),hi=Math.max(1,...values),range=hi-lo;
  const step=metric==='units'?Math.max(1,Math.ceil(range/4)):range/4;
  const bottom=Math.floor(lo/step)*step,top=Math.ceil(hi/step)*step;
  const left=48,right=18,X=i=>entries.length===1?(left+w-right)/2:left+i/(entries.length-1)*(w-left-right),Y=v=>h-32-(v-bottom)/(top-bottom)*(h-48);
  const valueLabel=b=>metric==='units'?b.units.toLocaleString('id-ID')+' unit':money(b[metric]);
  const keyLabel=b=>monthly?new Date(b.key+'-01T12:00:00Z').toLocaleDateString('id-ID',{month:'long',year:'numeric'}):dayFirstDate(b.key);
  function paint(){
    ctx.clearRect(0,0,w,h);ctx.font='11px Segoe UI';ctx.textBaseline='middle';ctx.lineWidth=1;ctx.setLineDash([]);
    for(let v=bottom;v<=top+step/100;v+=step){const y=Y(v);ctx.fillStyle='#68766d';ctx.textAlign='left';ctx.fillText((Math.abs(v)<1e-8?0:v).toLocaleString('id-ID',{maximumFractionDigits:metric==='units'?0:2}),0,y);ctx.strokeStyle='#e1e7e3';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();}
    ctx.beginPath();ctx.strokeStyle='#187457';ctx.lineWidth=2;values.forEach((v,i)=>i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));ctx.stroke();
    const active=hover<0?selected:hover;
    ctx.setLineDash([4,4]);ctx.strokeStyle='#8a9691';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(active),8);ctx.lineTo(X(active),h-32);ctx.stroke();ctx.setLineDash([]);
    values.forEach((v,i)=>{ctx.beginPath();ctx.arc(X(i),Y(v),i===active?6:2.5,0,Math.PI*2);ctx.fillStyle=i===active?'#197398':'#187457';ctx.fill();if(i===active){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}});
    ctx.fillStyle='#68766d';ctx.textAlign='center';const every=Math.max(1,Math.ceil(entries.length/(w<450?3:6)));
    entries.forEach((b,i)=>{if(i%every===0||i===entries.length-1&&entries.length-1-Math.floor((entries.length-1)/every)*every>every/2)ctx.fillText(monthly?b.key.slice(2):date(b.key),Math.max(48,Math.min(w-34,X(i))),h-10);});
    const b=entries[active];el('chartReadout').textContent=`${keyLabel(b)} / ${valueLabel(b)} / ${b.transactions} transaksi`;
    c.setAttribute('aria-label',`Performa penjualan: ${keyLabel(b)}, ${valueLabel(b)}`);
    c.dataset.selectedKey=entries[selected].key;
  }
  const pick=e=>entries.length===1?0:Math.max(0,Math.min(entries.length-1,Math.round((e.clientX-c.getBoundingClientRect().left-left)/(w-left-right)*(entries.length-1))));
  function select(i){selected=i;selectedChartKey=entries[i].key;hover=-1;el('chartDate').value=monthly?entries[i].key+'-01':entries[i].key;paint();}
  c.onpointermove=e=>{if(e.pointerType!=='touch'){hover=pick(e);paint();}};
  c.onpointerleave=()=>{hover=-1;paint();};c.onclick=e=>select(pick(e));
  c.onkeydown=e=>{let i=selected;if(e.key==='ArrowLeft')i--;else if(e.key==='ArrowRight')i++;else if(e.key==='Home')i=0;else if(e.key==='End')i=entries.length-1;else return;e.preventDefault();select(Math.max(0,Math.min(entries.length-1,i)));};
  const dateInput=el('chartDate');dateInput.min=start;dateInput.max=end;
  dateInput.onchange=()=>{const key=dateInput.value.slice(0,monthly?7:10),i=entries.findIndex(b=>b.key===key);if(i>=0)select(i);};
  select(selected);
};
window.addEventListener('resize',()=>{if(view==='dashboard')drawChart();});
