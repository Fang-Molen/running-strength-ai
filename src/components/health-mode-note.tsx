import {healthModeSummary} from '@/lib/health/mode'
import {loadHealthSnapshot} from '@/lib/health/snapshot'
import {loadWatch} from '@/lib/ui/watch-mode'
export function HealthModeNote({day}:{day:string}){
 const info=healthModeSummary(loadWatch(),loadHealthSnapshot(day))
 return <details className="mt-1 text-xs text-muted"><summary className="min-h-9 cursor-pointer py-2">{info.label} · 当天可用{info.available}项{info.conflicts?` · ${info.conflicts}项待核对`:''}</summary><p>{info.description}</p><p className="mt-1">{info.reminder}</p></details>
}
