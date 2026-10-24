export type Card = {id:string;tasks:string[];population:string;required:string[];[key:string]:unknown}
export function retrieve<T extends Card>(cards:T[],input:Record<string,unknown> & {task:string}):{question:string;task:string;matched:T[];needsInput:{id:string;missing:string[]}[];excluded:{id:string;reason:string}[];status:string;autoExecute:false}
export function scaleRange(ref:{unit:string;range:number[]},weightKg:number):{range:number[];unit:string;status:'REFERENCE_NOT_PRESCRIPTION'}
export function nutritionTotal(items:Record<string,number|null>[],nutrient:string):{knownSum:number;missing:number;status:'PARTIAL'|'COMPLETE'}
