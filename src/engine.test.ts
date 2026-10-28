import {describe,it,expect} from 'vitest';
import {compute,eligible,parseSnapshot,csv,type Rate} from './engine';
const c={sku:'Standard_D4s_v5',region:'westeurope',instances:2,hours:730,storage:100,egress:0};
// Tarifa sintética exclusiva de pruebas; nunca incluida en producción.
const r:Rate={meterId:'test',skuName:'D4s v5',armSkuName:c.sku,productName:'Virtual Machines Dsv5 Series',armRegionName:c.region,unitOfMeasure:'1 Hour',retailPrice:0.1,currencyCode:'USD',effectiveStartDate:'2026-01-01',type:'Consumption',isPrimaryMeterRegion:true};
describe('cálculo y selección',()=>{
 it('mantiene precisión decimal y anualiza',()=>{expect(compute(c,r).monthly).toBe('146.00');expect(compute(c,r).annual).toBe('1752.00')});
 it('rechaza horas e instancias inválidas',()=>{expect(()=>compute({...c,hours:745},r)).toThrow();expect(()=>compute({...c,instances:1.5},r)).toThrow()});
 it('rechaza unidades distintas y valores no finitos',()=>{expect(()=>compute(c,{...r,unitOfMeasure:'1 GB'})).toThrow();expect(()=>compute(c,{...r,retailPrice:NaN})).toThrow()});
 it('excluye Windows, Spot y regiones distintas',()=>{expect(eligible(r,c)).toBe(true);expect(eligible({...r,skuName:'Spot'},c)).toBe(false);expect(eligible({...r,productName:'Windows'},c)).toBe(false);expect(eligible({...r,armRegionName:'eastus'},c)).toBe(false)});
 it('rechaza importaciones sin estructura',()=>expect(()=>parseSnapshot({})).toThrow());
 it('escapa CSV y fórmulas',()=>expect(csv([['=1+1','a"b']])).toContain('"\'=1+1","a""b"'));
});
