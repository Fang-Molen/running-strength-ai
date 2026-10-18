import type { FieldworkState, ViewPreferences, SaveReceipt, FieldworkLocale } from '@/lib/ui/fieldwork-host'
import type { DraftInput } from '@/lib/ui/fieldwork-plan-drafts'
export const LANG_NAMES: readonly (readonly [FieldworkLocale,string])[]
export function uiText(locale:FieldworkLocale,key:string):string
export function mountFieldwork(root:HTMLElement,options:{embedded:true;initialPage:'today'|'body'|'nutrition';initialState:FieldworkState;onNavigate:(page:string)=>void;onOpenExercise:(id:string)=>void;onPreferencesChange:(input:Partial<ViewPreferences>)=>void;onPlanAdd:(input:DraftInput)=>Promise<SaveReceipt>;onPlanRemove:(input:{uid:string;expectedRevision:string})=>Promise<SaveReceipt>;onMealAdd:typeof import('@/lib/ui/fieldwork-host').commitFieldworkMeal;onMeasurementAdd:typeof import('@/lib/ui/fieldwork-host').commitFieldworkMeasurement}):{
  navigate:(page:'today'|'body'|'nutrition',notify?:boolean)=>void;updateState:(state:FieldworkState)=>void;setLocale:(locale:FieldworkLocale)=>void;destroy:()=>void
}
