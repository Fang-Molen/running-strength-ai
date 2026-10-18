// @ts-nocheck -- supplied display ordering pure functions
/** Pure display preference only: no training event or plan mutation. */
export const DEFAULT_HOME_ORDER=Object.freeze(['daily-training','strength-library','nutrition-health']);
export function parseHomeOrder(value){
 if(!Array.isArray(value)||value.length!==3||new Set(value).size!==3||!DEFAULT_HOME_ORDER.every(x=>value.includes(x)))return [...DEFAULT_HOME_ORDER];
 return [...value];
}
export function moveModule(order,id,newIndex){
 const value=parseHomeOrder(order);
 if(!value.includes(id)||!Number.isInteger(newIndex)||newIndex<0||newIndex>=value.length)return value;
 return [...value.filter(x=>x!==id).slice(0,newIndex),id,...value.filter(x=>x!==id).slice(newIndex)];
}
export function loadOrder(store){try{return parseHomeOrder(JSON.parse(store.getItem('fk-home-module-order-v1')||'null'));}catch{return [...DEFAULT_HOME_ORDER]}}
export function saveOrder(store,order){const normalized=parseHomeOrder(order);store.setItem('fk-home-module-order-v1',JSON.stringify(normalized));return normalized}
