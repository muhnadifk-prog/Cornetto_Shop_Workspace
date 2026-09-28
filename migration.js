'use strict';
(function(root){
  const text = v => v == null ? '' : String(v);
  function amount(v,label){ const n=Number(v); if(!Number.isFinite(n)||n<0||n>1e15)throw Error('Nominal tidak valid: '+label); return n; }
  function iso(v,label){const s=text(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Tanggal tidak valid: '+label);return s;}
  function rows(b,key){if(!Array.isArray(b[key]))throw Error('Daftar '+key+' tidak ditemukan.');return b[key];}
  function unique(list,key){const seen=new Set();for(const r of list){if(!r.id||seen.has(text(r.id)))throw Error('ID kosong/duplikat di '+key);seen.add(text(r.id));}}
  function convert(b,today){
    if(b?.app!=='stock-tracker'||b.version!==5)throw Error('Pilih Backup Lengkap versi 5 dari website lama.');
    for(const k of ['inventory','sales','marketplaces','expenses','ledger','creditCards','ccPayments'])rows(b,k);
    for(const k of ['inventory','sales','creditCards','ccPayments','expenses','ledger'])unique(b[k],k);
    const warnings=[], supplierMap=new Map(), productMap=new Map(), cardMap=new Map(), channelMap=new Map();
    const channels=b.marketplaces.map((c,i)=>{const out={id:'channel-'+i,name:text(c.name)||'Tanpa channel',fee:amount(c.fee,'tarif channel'),color:/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#187457',logo:/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(c.logo||'')?c.logo:'',active:true};if(out.fee>100)throw Error('Tarif channel melebihi 100%.');if(channelMap.has(out.name))throw Error('Nama channel duplikat.');channelMap.set(out.name,out);return out;});
    const cards=b.creditCards.map((c,i)=>{const out={id:'card-'+i,legacyId:text(c.id),bank:text(c.bank),name:text(c.name),limit:amount(c.limit,'limit kartu'),last4:'',due:'',active:true,color:'#5378a0'};cardMap.set(text(c.id),out);return out;});
    const suppliers=[], cardCharges=[];
    const inventory=b.inventory.map((p,i)=>{
      const supplier=text(p.supplier)||'Belum diketahui';
      if(!supplierMap.has(supplier)){const s={id:'supplier-'+suppliers.length,name:supplier,active:true,contact:'',phone:'',note:''};suppliers.push(s);supplierMap.set(supplier,s);}
      const qty=amount(p.qty,'jumlah barang');if(!Number.isInteger(qty))throw Error('Jumlah barang harus bulat.');
      const cost=amount(p.costPrice,'HPP'),date=iso(p.date,'barang masuk');
      const card=cardMap.get(text(p.payMethod));
      const out={id:'product-'+i,legacyId:text(p.id),name:text(p.productName),variant:text(p.imei)||text(p.condition),sku:'CS-'+String(i+1).padStart(4,'0'),imei:text(p.imei),notes:text(p.notes),invoice:p.invoice||null,date,age:Math.max(0,Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000)),cost,price:0,qty,purchasedQty:qty,brand:/iphone|ipad|apple/i.test(p.productName)?'Apple':/samsung/i.test(p.productName)?'Samsung':'Lainnya',supplier,supplierId:supplierMap.get(supplier).id,category:text(p.category),condition:text(p.condition),warranty:text(p.warranty),payMethod:card?card.id:p.payMethod==='tunai'?'cash':'unknown',legacyPayMethod:text(p.payMethod)};
      productMap.set(text(p.id),out);
      if(card)cardCharges.push({id:'charge-'+i,cardId:card.id,productId:out.id,date,amount:cost*qty,note:out.name+' / '+qty+' unit'});
      return out;
    });
    const sales=b.sales.map((s,i)=>{
      const p=productMap.get(text(s.inventoryId));if(!p)throw Error('Penjualan '+text(s.id)+' tidak memiliki barang asal. Impor dihentikan tanpa mengubah data.');
      const qty=amount(s.qty,'jumlah penjualan');if(!Number.isInteger(qty)||qty<1)throw Error('Jumlah penjualan tidak valid.');
      let ch=channelMap.get(text(s.channel));
      if(!ch){ch={id:'channel-'+channels.length,name:text(s.channel)||'Tanpa channel',fee:0,color:'#768079',active:true};channelMap.set(text(s.channel),ch);channels.push(ch);warnings.push('Channel historis '+ch.name+' tidak memiliki tarif; cek biaya transaksi.');}
      const price=amount(s.sellPrice,'harga jual'),fee=s.adminFeeOverride!=null&&s.adminFeeOverride!==''?amount(s.adminFeeOverride,'biaya admin'):price*qty*ch.fee/100;
      p.qty-=qty;p.price=price;
      return {id:'sale-'+i,legacyId:text(s.id),productId:p.id,date:iso(s.date,'penjualan'),price,qty,cost:p.cost,fee,shipping:amount(s.shippingCost||0,'ongkir'),channel:ch.name,channelId:ch.id,buyer:text(s.buyer),status:'unknown',notes:text(s.notes),invoice:s.invoice||null,orderId:text(s.orderId)};
    });
    for(const p of inventory)if(p.qty<0)warnings.push('Stok minus: '+p.name+' ('+p.qty+' unit). Tidak dikoreksi otomatis.');
    const missing=inventory.filter(p=>p.payMethod==='unknown').length;
    if(missing)warnings.push(missing+' barang tidak memiliki sumber pembayaran yang bisa dipastikan.');
    if(sales.length)warnings.push(sales.length+' penjualan belum memiliki status pencairan pada backup.');
    if(cards.length)warnings.push('Jatuh tempo dan 4 digit kartu tidak ada pada backup. Saldo hanya dari pembelian/pembayaran tercatat.');
    const cardPayments=b.ccPayments.map((p,i)=>{const c=cardMap.get(text(p.cardId));if(!c)throw Error('Pembayaran kartu tanpa kartu asal.');return {id:'payment-'+i,legacyId:text(p.id),cardId:c.id,date:iso(p.date,'pembayaran kartu'),amount:amount(p.amount,'pembayaran kartu'),note:text(p.note)};});
    const expenses=b.expenses.map((e,i)=>({id:'expense-'+i,legacyId:text(e.id),date:iso(e.date,'beban'),name:text(e.note)||text(e.category),category:text(e.category),amount:amount(e.amount,'beban')}));
    const ledger=b.ledger.map((e,i)=>({id:'ledger-'+i,legacyId:text(e.id),date:iso(e.date,'pembukuan'),note:text(e.note),type:text(e.type),amount:amount(e.amount,'pembukuan')}));
    const options=(key,fallback)=>Array.isArray(b[key])&&b[key].length?b[key].map(text):fallback;
    const result={app:'cornetto-workspace',version:1,inventory,sales,expenses,ledger,channels,suppliers,cards,cardCharges,cardPayments,taxPayments:[],business:{name:text(b.settings?.businessName)||'Cornetto Shop',owner:'Pemilik',categories:options('categories',['Handphone']),conditions:options('conditions',['Baru','Bekas']),warranties:options('warranties',['Tanpa garansi'])},taxProfile:{type:'person',eligible:false,pkp:!!b.settings?.isPkp,inclusive:true,rate:0.5,verified:false},taxAdjustments:{},inputVat:{},migration:{sourceDate:b.exportedAt,importedAt:new Date().toISOString(),warnings},legacyArchive:b};
    return result;
  }
  root.CornettoMigration={convert};
  if(typeof module!=='undefined')module.exports={convert};
})(typeof window==='undefined'?globalThis:window);
