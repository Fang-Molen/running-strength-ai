/** New visual release is independent of training facts and dormant until asset review. */
import pending from './pending-registry.json' with {type:'json'};
export type Review='PENDING'|'DRAFT'|'APPROVED'|'REJECTED';
export type MediaFile={path:string;sha256:string;bytes:number};
export type CharacterAsset={characterId:string;assetVersion:string;rigVersion:string;glb:MediaFile;license:string;source:string;review:Review};
export type Frame=MediaFile&{characterId:string;modelSHA256:string;clipId:string;seconds:number};
export type ExerciseMedia={exerciseId:string;characterId:string;assetVersion:string;review:Review;character:CharacterAsset|null;clipId:string|null;motion:{resource:MediaFile;rigVersion:string;key:string;review:Review}|null;duration:number|null;frames:Frame[];cover:Frame|null;primary:string[];secondary:string[];license:string;source:string;reviewEvidence:string[]};
export type MediaRequest={exerciseId:string;characterId:string;assetVersion:string};
export type MediaResolution={state:'unavailable'|'ready3d'|'ready2d';reason:string;entry:ExerciseMedia|null;can3d:boolean;can2d:boolean};
const key=(r:MediaRequest)=>JSON.stringify([r.exerciseId,r.characterId,r.assetVersion]);
export const pendingStrengthIds=Object.freeze(pending.exercises.map(x=>x.exerciseId));
export const localAsset=(file:MediaFile)=>/^\/media-v2\/[a-zA-Z0-9_./-]+$/.test(file.path)&&!file.path.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(file.sha256)&&Number.isSafeInteger(file.bytes)&&file.bytes>0;
export function inspectMedia(entry:ExerciseMedia):string[]{
 const errors:string[]=[];if(!entry.exerciseId||!entry.characterId||!entry.assetVersion)errors.push('missing identity/version');
 if(entry.review!=='APPROVED'||!entry.reviewEvidence.length)errors.push('media review pending');
 if(!entry.license||!entry.source)errors.push('missing provenance');
 const c=entry.character;
 if(!c||c.review!=='APPROVED'||c.characterId!==entry.characterId||c.assetVersion!==entry.assetVersion||!c.rigVersion||!localAsset(c.glb)||!c.license||!c.source)errors.push('character unavailable or mismatched');
 if(!entry.clipId||!entry.duration||!Number.isFinite(entry.duration)||entry.duration<=0)errors.push('motion unavailable');
 const frames=[...entry.frames,...(entry.cover?[entry.cover]:[])];
 if(frames.some(f=>!localAsset(f)||f.characterId!==entry.characterId||f.modelSHA256!==c?.glb.sha256||f.clipId!==entry.clipId||!Number.isFinite(f.seconds)||f.seconds<0||f.seconds>(entry.duration??0)))errors.push('frames do not match model/motion');
 if(entry.frames.length&& (entry.frames.length<4||entry.frames.length>6||entry.frames.some((f,i)=>i>0&&f.seconds<=entry.frames[i-1].seconds)))errors.push('keyframes must contain 4–6 ordered phases');
 return errors;
}
export function resolveMedia(request:MediaRequest,entries:readonly ExerciseMedia[]):MediaResolution{
 const matches=entries.filter(e=>key(e)===key(request));
 if(matches.length!==1)return {state:'unavailable',entry:null,can3d:false,can2d:false,reason:matches.length?'资源版本重复，暂不可用':'此人物的动作示范待补充'};
 const entry=matches[0],errors=inspectMedia(entry);
 if(errors.length)return {state:'unavailable',entry:null,can3d:false,can2d:false,reason:'示范待补充：资源或审校尚未完成'};
 const motion=entry.motion,can3d=!!motion&&motion.review==='APPROVED'&&motion.key===entry.clipId&&motion.rigVersion===entry.character?.rigVersion&&localAsset(motion.resource),can2d=entry.frames.length>=4;
 return {state:can3d?'ready3d':can2d?'ready2d':'unavailable',entry:can3d||can2d?entry:null,can3d,can2d,reason:can3d||can2d?'':'动作资源待补充'};
}
export type PlaybackState={phase:'loading'|'ready3d'|'ready2d'|'unavailable'|'error';mode:'3d'|'2d';progress:number;playing:boolean;reason:string;request:MediaRequest};
export function playbackState(request:MediaRequest,resolution:MediaResolution):PlaybackState{return {phase:resolution.can3d?'loading':resolution.can2d?'ready2d':'unavailable',mode:resolution.can3d?'3d':'2d',progress:0,playing:false,reason:resolution.reason,request:{...request}}}
export function switchMediaMode(state:PlaybackState,resolution:MediaResolution,mode:'3d'|'2d'):PlaybackState{
 if(resolution.entry&&key(resolution.entry)!==key(state.request))return state;
 if(mode==='3d'&&!resolution.can3d||mode==='2d'&&!resolution.can2d)return {...state,playing:false,reason:mode==='3d'?'此人物的3D示范待补充':'同人物2D关键帧待补充'};
 return {...state,mode,phase:mode==='3d'?'loading':'ready2d',playing:false,reason:''};
}
export function mediaLoaded(state:PlaybackState,request:MediaRequest):PlaybackState{return key(state.request)===key(request)&&state.phase==='loading'?{...state,phase:'ready3d',reason:''}:state}
export function mediaFailed(state:PlaybackState,resolution:MediaResolution,request:MediaRequest):PlaybackState{if(key(request)!==key(state.request)||resolution.entry&&key(resolution.entry)!==key(state.request))return state;return {...state,playing:false,mode:resolution.can2d?'2d':'3d',phase:resolution.can2d?'ready2d':'error',reason:resolution.can2d?'3D加载失败，已切换同角色2D关键帧':'3D加载失败；示范待补充，可查看动作说明'}}
export function seekMedia(state:PlaybackState,progress:number):PlaybackState{return {...state,progress:Number.isFinite(progress)?Math.min(1,Math.max(0,progress)):state.progress,playing:false}}
export function frameAt(entry:ExerciseMedia,progress:number):Frame|null{if(!entry.frames.length||!entry.duration)return null;const seconds=Math.min(1,Math.max(0,progress))*entry.duration;return entry.frames.reduce((best,f)=>Math.abs(f.seconds-seconds)<Math.abs(best.seconds-seconds)?f:best)}
/** There are no approved new GLBs in the handoff. Never promote its PENDING template. */
export const approvedMedia:readonly ExerciseMedia[]=Object.freeze([]);
export const visualRelease={version:'fk-visual-v2-20261017',enabled:false,status:'BLOCKED_ASSETS',reason:'New male/female/soft-muscle GLBs and reviewed keyframes have not been delivered or approved.'} as const;
