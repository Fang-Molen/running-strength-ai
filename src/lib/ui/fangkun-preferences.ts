import {currentStore} from '../core/storage'
import {currentAthleteId} from '../core/events'
export const HOME_MODULES = ['daily-training','strength-library','nutrition-health'] as const
export type HomeModule = typeof HOME_MODULES[number]
export type BodyScenario = {sex:'male'|'female';left:{heightCm:number;massKg:number;bodyFatPct:number;frame:number};right:{heightCm:number;massKg:number;bodyFatPct:number;frame:number}}
export type UIPreferences = {homeOrder:HomeModule[];favorites:string[];bodyScenario:BodyScenario|null}
const key=()=>`fr255-fieldwork-view-v1:${encodeURIComponent(currentAthleteId())}`
export function normalizeOrder(value:unknown):HomeModule[]{return Array.isArray(value)&&value.length===3&&new Set(value).size===3&&HOME_MODULES.every(x=>value.includes(x))?[...value]:[...HOME_MODULES]}
function validScenario(v:BodyScenario|null):boolean{return v===null||!!v&&['male','female'].includes(v.sex)&&[v.left,v.right].every(p=>!!p&&typeof p.heightCm==='number'&&p.heightCm>=140&&p.heightCm<=210&&typeof p.massKg==='number'&&p.massKg>=35&&p.massKg<=160&&typeof p.bodyFatPct==='number'&&p.bodyFatPct>0&&p.bodyFatPct<60&&typeof p.frame==='number'&&p.frame>=-1&&p.frame<=1)}
export function readUIPreferences():UIPreferences{
 const initial={homeOrder:[...HOME_MODULES],favorites:[],bodyScenario:null}
 try{const v=JSON.parse(currentStore()?.getItem(key())||'null');if(v?.schema!==1)return initial
 return {homeOrder:normalizeOrder(v.data.homeOrder),favorites:Array.isArray(v.data.favorites)?v.data.favorites.filter((x:unknown)=>typeof x==='string').slice(0,129):[],bodyScenario:v.data.bodyScenario&&validScenario(v.data.bodyScenario)?v.data.bodyScenario:null}}catch{return initial}
}
/** Extend the existing athlete-scoped view preferences, never measurement or plan data. */
export function saveUIPreferences(update:Partial<UIPreferences>):boolean{
 try{const box=currentStore();if(!box)return false;const raw=box.getItem(key());const saved=raw?JSON.parse(raw):{schema:1,data:{}};if(saved?.schema!==1||!saved.data||typeof saved.data!=='object')return false
 const value={...readUIPreferences(),...update};if(!validScenario(value.bodyScenario)||value.favorites.length>129||value.favorites.some(x=>typeof x!=='string'))return false
 const next=JSON.stringify({...saved,data:{...saved.data,...value,homeOrder:normalizeOrder(value.homeOrder)}});box.setItem(key(),next);return box.getItem(key())===next}catch{return false}
}
