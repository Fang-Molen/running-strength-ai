import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {FoodEntrySheet} from './food-entry-sheet';
import {setStoreBackend} from '../lib/core/storage';
import {setEventContext} from '../lib/core/events';
import {storeFoodCaptureDraft} from '../lib/nutrition/food-capture';
import {emptyFoodDraft} from '../lib/nutrition/entry-workflow';

test('reopened sheet renders saved draft date meal and honest online-search fallback',()=>{
 const data=new Map<string,string>();const backend={keys:()=>[...data.keys()],getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}};
 setStoreBackend(backend);setEventContext({athleteId:'synthetic-food-sheet'});
 try{
  storeFoodCaptureDraft({version:1,athleteId:'synthetic-food-sheet',requestId:'synthetic-sheet-request',date:'2026-10-20',meal:'晚餐',draft:{...emptyFoodDraft(),name:'合成晚餐',amount:'150',values:{kcal:'210',protein:'',carb:'',fat:'',fiber:''}}});
  const html=renderToStaticMarkup(<FoodEntrySheet meal="午餐" onClose={()=>{}} onSaved={()=>{}}/>);
  assert.match(html,/value="合成晚餐"/);assert.match(html,/value="2026-10-20"/);assert.match(html,/<option selected="">晚餐<\/option>/);
  assert.match(html,/在线食物搜索未配置/);assert.match(html,/用户自填/);assert.match(html,/生熟.*未标注/);
 }finally{setStoreBackend(null);setEventContext({athleteId:'local'})}
});
