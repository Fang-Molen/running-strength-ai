import {TRAINING_DRAFT_KEY,type TrainingDraft} from './training-editor';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const trainingDraftKey=(date:string,templateId?:string)=>`${TRAINING_DRAFT_KEY}:${date}:${templateId?`template:${templateId}`:'new'}`;
function parse(raw:string|null):TrainingDraft|null{
 try{const d=JSON.parse(raw??'null');return d&&typeof d.id==='string'&&typeof d.date==='string'&&Array.isArray(d.exercises)?d:null;}catch{return null;}
}
/** Each entry date/template owns a draft; legacy drafts are read only on their actual date. */
export function readTrainingDraft(store:Store|null,date:string,templateId?:string):TrainingDraft|null{
 if(!store)return null;
 try{const scoped=parse(store.getItem(trainingDraftKey(date,templateId)));if(scoped)return scoped;
  const legacy=templateId?null:parse(store.getItem(TRAINING_DRAFT_KEY));return legacy?.date===date?legacy:null;
 }catch{return null;}
}
export function saveTrainingDraft(store:Store|null,date:string,draft:TrainingDraft,templateId?:string){
 if(!store)return false;
 try{store.setItem(trainingDraftKey(date,templateId),JSON.stringify(draft));return true;}catch{return false;}
}
export function clearSavedTrainingDraft(store:Store|null,date:string,id:string,templateId?:string){
 if(!store)return;
 try{const key=trainingDraftKey(date,templateId);if(parse(store.getItem(key))?.id===id)store.removeItem(key);
  if(parse(store.getItem(TRAINING_DRAFT_KEY))?.id===id)store.removeItem(TRAINING_DRAFT_KEY);
 }catch{/* The saved course remains valid if optional draft cleanup fails. */}
}
