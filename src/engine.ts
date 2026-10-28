import Decimal from 'decimal.js';
export type Config = {sku:string;region:string;instances:number;hours:number;storage:number;egress:number};
export type Rate = {meterId:string;skuName:string;armSkuName:string;productName:string;armRegionName:string;unitOfMeasure:string;retailPrice:number;currencyCode:string;effectiveStartDate:string;type:string;isPrimaryMeterRegion:boolean};
export type Snapshot = {id:string;name:string;created:string;config:Config;rates:Rate[];fetched:string};
export function validate(c:Config){
 if(!/^[A-Za-z0-9_ -]{1,100}$/.test(c.sku)||!/^[a-z0-9]{1,40}$/.test(c.region)) throw Error('SKU o región no válidos');
 for(const k of ['instances','hours','storage','egress'] as const) if(!Number.isFinite(c[k])||c[k]<0) throw Error('Los consumos deben ser números positivos');
 if(!Number.isInteger(c.instances)||c.instances<1||c.instances>100000||c.hours>744) throw Error('Instancias: 1–100000; horas: 0–744');
}
export function compute(c:Config,r:Rate){validate(c);if(r.unitOfMeasure!=='1 Hour'||r.type!=='Consumption'||r.currencyCode!=='USD'||!Number.isFinite(r.retailPrice)||r.retailPrice<0) throw Error('Tarifa incompatible');
 const hourly=new Decimal(r.retailPrice).mul(c.instances);const monthly=hourly.mul(c.hours);
 return {hourly:hourly.toFixed(6),daily:monthly.div(30).toFixed(2),monthly:monthly.toFixed(2),annual:monthly.mul(12).toFixed(2)};
}
export function eligible(r:Rate,c:Config){return r.armSkuName===c.sku&&r.armRegionName===c.region&&r.unitOfMeasure==='1 Hour'&&r.type==='Consumption'&&r.currencyCode==='USD'&&r.isPrimaryMeterRegion&&!/windows|spot|low priority/i.test(r.productName+' '+r.skuName);}
export function parseSnapshot(input:unknown):Snapshot {
 const s=input as Snapshot;if(!s||typeof s.id!=='string'||typeof s.name!=='string'||!Number.isFinite(Date.parse(s.created))||!Number.isFinite(Date.parse(s.fetched))||!Array.isArray(s.rates)||s.rates.length>10000) throw Error('Presupuesto inválido');validate(s.config);
 for(const r of s.rates) if(!r||typeof r.meterId!=='string'||typeof r.productName!=='string'||typeof r.skuName!=='string'||typeof r.armSkuName!=='string'||typeof r.armRegionName!=='string'||!Number.isFinite(r.retailPrice)||r.retailPrice<0||!Number.isFinite(Date.parse(r.effectiveStartDate))) throw Error('Tarifa inválida');
 return s;
}
export function csv(rows:string[][]){return '\uFEFF'+rows.map(row=>row.map(v=>'"'+(/^[=+@-]/.test(v)?"'":'')+v.replaceAll('"','""')+'"').join(',')).join('\r\n');}
