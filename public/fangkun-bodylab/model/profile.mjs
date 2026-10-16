/* FANGKUN BODYLAB: deterministic, continuous anthropometric-inspired SILHOUETTE model.
   Not a medical prediction or 3D scan. No height/weight/BF can reveal exact body shape. */
export const LIMITS = Object.freeze({heightCm:[140,210],massKg:[35,160],bodyFatPct:{male:[6,42],female:[12,48]}});
export const DEFAULTS = Object.freeze({male:{sex:'male',heightCm:174,massKg:68,bodyFatPct:18,frame:0},female:{sex:'female',heightCm:165,massKg:75,bodyFatPct:30,frame:0}});
export function clamp(n,min,max){return Math.min(max,Math.max(min,n));}
export function normalize(input={}){
 const sex=input.sex==='female'?'female':'male';const def=DEFAULTS[sex];
 const num=(k)=>Number.isFinite(Number(input[k]))?Number(input[k]):def[k];
 return {sex,heightCm:clamp(num('heightCm'),...LIMITS.heightCm),massKg:clamp(num('massKg'),...LIMITS.massKg),bodyFatPct:clamp(num('bodyFatPct'),...LIMITS.bodyFatPct[sex]),frame:clamp(num('frame'),-1,1)};
}
export function computeProfile(input={}){
 const v=normalize(input), h=v.heightCm/100, female=v.sex==='female', bf=v.bodyFatPct/100;
 const referenceBF=female?.27:.18;
 const referenceMass=(female?21.6:22.5)*h*h;
 const size=Math.pow(v.massKg/referenceMass,.47)*Math.pow(h/1.7,.22);
 const lean=v.massKg*(1-bf), fat=v.massKg*bf;
 const leanFactor=clamp(Math.pow((lean/referenceMass)/(1-referenceBF),.17),.83,1.18);
 const fatDiff=bf-referenceBF;
 const frameFactor=1+v.frame*.075;
 const soft=(a,b=1)=>clamp(1+a*fatDiff*b,.79,1.32);
 const radii={
  shoulder:(female?.198:.225)*Math.pow(h/1.7,.38)*frameFactor*clamp(leanFactor,.90,1.13),
  chest:(female?.179:.201)*size*soft(.12)*frameFactor,
  underChest:(female?.170:.180)*size*soft(.35),
  waist:(female?.148:.164)*size*soft(1.18),
  hip:(female?.208:.192)*size*soft(.90)*clamp(1-v.frame*.025,.95,1.05),
  thigh:(female?.082:.084)*size*soft(.66),
  knee:(female?.049:.051)*size*soft(.33),
  calf:(female?.058:.060)*size*soft(.22),
  upperArm:(female?.047:.053)*size*soft(.67)*leanFactor**.25,
  forearm:(female?.034:.038)*size*soft(.27),
  neck:(female?.061:.066)*Math.pow(h/1.7,.36)*clamp(leanFactor,.93,1.08),
  bellyDepth:(female?.118:.128)*size*soft(1.35),
  chestDepth:(female?.126:.127)*size*soft(.23),
  hipDepth:(female?.143:.129)*size*soft(.72),
 };
 // Limits are only for visualization; inputs do not identify actual anthropometric circumferences.
 const showDelta=(other)=>({massKg:+(other.massKg-v.massKg).toFixed(1),heightCm:+(other.heightCm-v.heightCm).toFixed(1),bodyFatPct:+(other.bodyFatPct-v.bodyFatPct).toFixed(1)});
 return {...v,heightM:h,bmi:v.massKg/(h*h),fatMassKg:fat,leanMassKg:lean,size,leanFactor,fatDiff,radii,showDelta};
}
export function compareMessage(p,q){
 const sameSex=p.sex===q.sex,dm=q.massKg-p.massKg,dh=q.heightCm-p.heightCm,db=q.bodyFatPct-p.bodyFatPct;
 if(!sameSex)return '不同基础体型并排示意；不代表男女体型可以由同一公式精确互换。';
 if(dh!==0&&dm===0)return '同体重不同身高：身高影响四肢和躯干长度，也会改变相对围度；仅为连续形态示意。';
 if(db!==0&&dm===0)return '同体重不同体脂率：脂肪量与去脂体重比例不同，腰臀、四肢与肌肉轮廓呈现不同。';
 if(dm!==0)return `${Math.abs(dm).toFixed(1)} kg 的体重变化被连续呈现为相对细微的围度变化；实际改变发生在哪里，取决于脂肪、肌肉、水分及个人分布。`;
 return '两侧参数一致；可修改任意滑块，比较体型如何连续响应。';
}
export const PRESETS = Object.freeze({
 weight: {sex:'female',left:{heightCm:165,massKg:75,bodyFatPct:30,frame:0},right:{heightCm:165,massKg:72,bodyFatPct:30,frame:0}},
 bodyfat:{sex:'female',left:{heightCm:165,massKg:65,bodyFatPct:22,frame:0},right:{heightCm:165,massKg:65,bodyFatPct:34,frame:0}},
 height:{sex:'female',left:{heightCm:158,massKg:60,bodyFatPct:26,frame:0},right:{heightCm:176,massKg:60,bodyFatPct:26,frame:0}},
 maleweight:{sex:'male',left:{heightCm:176,massKg:77,bodyFatPct:19,frame:0},right:{heightCm:176,massKg:74,bodyFatPct:19,frame:0}}
});
