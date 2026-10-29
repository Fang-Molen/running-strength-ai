export const PET_CAPTURE_OPEN='fk-pet-capture-open'
export const PET_CAPTURE_SELECTED='fk-pet-capture-selected'
export type CaptureAction='menu'|'food'|'feedback'|'body'
export function openPetCapture(action:CaptureAction='menu',occurrenceId?:string|null){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(PET_CAPTURE_OPEN,{detail:{action,occurrenceId}}))}
export function selectPetTraining(occurrenceId:string|null){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(PET_CAPTURE_SELECTED,{detail:{occurrenceId}}))}
