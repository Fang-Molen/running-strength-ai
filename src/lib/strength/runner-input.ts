export function runnerInput(weightText:string, amountText:string, mode:'reps'|'seconds') {
  if(!weightText.trim() || !amountText.trim())return null;
  const weight=Number(weightText), amount=Number(amountText);
  if(!Number.isFinite(weight)||weight<0||!Number.isFinite(amount)||amount<=0||(mode==='reps'&&!Number.isInteger(amount)))return null;
  return {weight,amount};
}
/** A restored rest cursor already points at the pending target. Do not skip it. */
export function nextRunnerCursor(rows: {key:string;handled:boolean}[], cursor:number, target:string|null) {
  const restored=rows.findIndex(x=>x.key===target&&!x.handled);
  return restored>=0?restored:rows.findIndex((x,i)=>i>cursor&&!x.handled);
}
