'use strict';
const MarketplaceFees=(()=>{
  const markets=['shopee','tokopedia'];
  function defaults(){return {version:1,market:'shopee',mode:'deductions',inputs:{cost:0,qty:1,price:0,target:0,rounding:1000,feeRounding:1,discount:0,packing:0,shipping:0},fees:{shopee:[],tokopedia:[]}};}
  function fee(id){return {id,name:'Biaya tambahan',on:true,type:'percent',rate:0,base:'net',fixed:0,unit:'order',capped:false,cap:0,taxed:false,tax:0};}
  const amount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12;
  function validate(s){
    if(!s||s.version!==1||!markets.includes(s.market)||!['deductions','target'].includes(s.mode)||!s.inputs||!s.fees)throw Error('Pengaturan kalkulator tidak valid.');
    const i=s.inputs;
    if(!Number.isInteger(i.qty)||i.qty<1||i.qty>999)throw Error('Jumlah unit harus 1 sampai 999.');
    for(const k of ['cost','price','target','discount','packing','shipping'])if(!amount(i[k]))throw Error('Nominal harus antara Rp 0 dan Rp 1 triliun.');
    if(![1,100,1000].includes(i.rounding)||![-1,0,1].includes(i.feeRounding))throw Error('Pembulatan tidak valid.');
    for(const market of markets){
      const fees=s.fees[market],ids=new Set();
      if(!Array.isArray(fees)||fees.length>12)throw Error('Maksimal 12 komponen biaya per marketplace.');
      for(const f of fees){
        if(!f||typeof f.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(f.id)||ids.has(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>80)throw Error('Nama atau ID komponen biaya tidak valid.');
        ids.add(f.id);
        if(!['percent','fixed'].includes(f.type)||!['net','gross'].includes(f.base)||!['order','unit'].includes(f.unit)||['on','capped','taxed'].some(k=>typeof f[k]!=='boolean'))throw Error('Aturan komponen biaya tidak valid.');
        if(!amount(f.rate)||f.rate>100||!amount(f.tax)||f.tax>100)throw Error('Persentase harus antara 0 dan 100.');
        if(!amount(f.fixed)||!amount(f.cap))throw Error('Nominal komponen biaya tidak valid.');
      }
    }
    return s;
  }
  function calculate(inputs,fees,price=inputs.price){
    const gross=price*inputs.qty,base=Math.max(0,gross-inputs.discount);
    const rows=fees.map(f=>{
      let amount=0;
      if(f.on){
        amount=f.type==='fixed'?f.fixed*(f.unit==='unit'?inputs.qty:1):(f.base==='gross'?gross:base)*f.rate/100;
        if(f.capped)amount=Math.min(amount,f.cap);
        if(f.taxed)amount*=1+f.tax/100;
        const round=inputs.feeRounding===-1?Math.floor:inputs.feeRounding===0?Math.round:Math.ceil;
        amount=round(Math.round(amount*1e6)/1e6);
      }
      return {id:f.id,amount};
    });
    const totalFee=rows.reduce((s,r)=>s+r.amount,0),net=base-totalFee,profit=net-inputs.cost*inputs.qty-inputs.packing-inputs.shipping;
    return {gross,base,rows,totalFee,net,profit,margin:base?profit/base*100:0,effective:base?totalFee/base*100:0};
  }
  function solve(inputs,fees){
    let low=Math.ceil(inputs.discount/inputs.qty),high=Math.max(1,low,inputs.cost);
    while(calculate(inputs,fees,high).profit<inputs.target&&high<1e12)high=Math.min(1e12,high*2);
    if(calculate(inputs,fees,high).profit<inputs.target)return null;
    while(low<high){const mid=Math.floor((low+high)/2);if(calculate(inputs,fees,mid).profit>=inputs.target)high=mid;else low=mid+1;}
    const price=Math.ceil(low/inputs.rounding)*inputs.rounding;
    return price<=1e12&&calculate(inputs,fees,price).profit>=inputs.target?price:null;
  }
  return {defaults,fee,validate,calculate,solve};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=MarketplaceFees;
