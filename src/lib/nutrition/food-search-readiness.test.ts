import test from 'node:test';
import assert from 'node:assert/strict';
import {foodResultDetails, foodSearchReadiness} from './food-search-readiness';
import type {FoodRow} from './food-db';
const food:FoodRow={i:'synthetic',n:'合成花生',a:[],g:0,b:'g',p:[100,null,null,null,null],s:{g:null,u:'份',v:null},pt:[],src:'U',st:'REFERENCE'};
test('local catalogue does not claim online search readiness or guess missing product metadata',()=>{
 assert.equal(foodSearchReadiness.configured,false);assert.equal(foodSearchReadiness.provider,null);
 const details=foodResultDetails(food);
 assert.equal(details.source,'本地食物库');assert.equal(details.brand,'未标注');assert.equal(details.region,'未标注');assert.equal(details.preparation,'未标注');assert.equal(details.basis,'每100g');
});
test('explicit product brand region and raw/cooked qualifier survive presentation',()=>{
 const details=foodResultDetails({...food,n:'合成花生（熟）',br:'合成品牌',rg:'合成地区',b:'serv'});
 assert.equal(details.brand,'合成品牌');assert.equal(details.region,'合成地区');assert.equal(details.preparation,'熟');assert.equal(details.basis,'每份');
});
