/** Global typography preference; never changes athlete records or model permissions. */
export const FONT_SCALE_KEY='fk-font-scale-v89';
export type FontScale='standard'|'large'|'extra';
export function normalizeFontScale(value:unknown):FontScale{return value==='large'||value==='extra'?value:'standard'}
export function readFontScale(storage?:Pick<Storage,'getItem'>):FontScale{try{return normalizeFontScale(storage?.getItem(FONT_SCALE_KEY))}catch{return 'standard'}}
export function writeFontScale(storage:Pick<Storage,'setItem'|'getItem'>,value:FontScale):boolean{try{if(normalizeFontScale(value)!==value)return false;storage.setItem(FONT_SCALE_KEY,value);return storage.getItem(FONT_SCALE_KEY)===value}catch{return false}}
