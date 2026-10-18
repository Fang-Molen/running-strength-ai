import {useEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {parseDecimalDraft,type DecimalRules} from '@/lib/ui/decimal-draft';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'|'min'|'max'|'onBlur'> & DecimalRules & {
 value:number|null|undefined;onCommit:(value:number|null)=>void;onDraftState?:(pending:boolean)=>void;
};
/** Draft stays a string until blur/Enter. Escape restores the committed value. */
export function DecimalInput({value,onCommit,onDraftState,min,max,integer,nullable,...props}:Props){
 const initial=Number.isFinite(value)?String(value):'';
 const [draft,setDraft]=useState(initial),[error,setError]=useState('');
 const el=useRef<HTMLInputElement>(null),focused=useRef(false),latest=useRef({onCommit,onDraftState});latest.current={onCommit,onDraftState};
 useEffect(()=>{if(!focused.current){setDraft(initial);setError('');el.current?.setCustomValidity('')}},[initial]);
 const validate=(raw:string)=>{const result=parseDecimalDraft(raw,{min,max,integer,nullable});el.current?.setCustomValidity(result.ok?'':result.reason);return result};
 const commit=()=>{const result=validate(draft);if(!result.ok){setError(result.reason);latest.current.onDraftState?.(true);return false}
  setError('');latest.current.onCommit(result.value);latest.current.onDraftState?.(false);return true;};
 return <><input {...props} ref={el} type="text" inputMode={integer?'numeric':'decimal'} value={draft} aria-invalid={error?true:undefined}
  onFocus={e=>{focused.current=true;props.onFocus?.(e)}}
  onChange={e=>{const raw=e.target.value;setDraft(raw);setError('');validate(raw);latest.current.onDraftState?.(raw!==initial)}}
  onBlur={()=>{focused.current=false;commit()}}
  onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setDraft(initial);setError('');el.current?.setCustomValidity('');latest.current.onDraftState?.(false)}else if(e.key==='Enter'){e.preventDefault();el.current?.blur()}props.onKeyDown?.(e)}}/>
  {error?<span className="block text-xs text-amber-400" role="alert">{error}</span>:null}</>;
}
