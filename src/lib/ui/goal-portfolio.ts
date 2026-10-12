import { GOALS, type GoalId } from './sport-goal.ts'
export const GOAL_PORTFOLIO_KEY = 'fr255-goal-portfolio-v1'
type Storage = {getItem(key:string):string|null;setItem(key:string,value:string):void}
const valid = new Set<string>(GOALS.map(g=>g.id))
export function normalizeSupportingGoals(raw:unknown, primary:GoalId):GoalId[] {
 if (!Array.isArray(raw)) return []
 return [...new Set(raw.filter((x):x is GoalId=>typeof x==='string'&&valid.has(x)&&x!==primary))]
}
export function loadSupportingGoals(storage:Pick<Storage,'getItem'>, primary:GoalId):GoalId[] {
 try { const raw=storage.getItem(GOAL_PORTFOLIO_KEY);return normalizeSupportingGoals(raw?JSON.parse(raw):[],primary) } catch{return []}
}
export function saveSupportingGoals(storage:Storage, goals:GoalId[], primary:GoalId):boolean {
 const next=JSON.stringify(normalizeSupportingGoals(goals,primary))
 try {storage.setItem(GOAL_PORTFOLIO_KEY,next);return storage.getItem(GOAL_PORTFOLIO_KEY)===next}catch{return false}
}
