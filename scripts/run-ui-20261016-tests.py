from pathlib import Path
import subprocess,json,re,sys
root=Path(__file__).resolve().parents[1]
out=Path('/workspace/fangkun/evidence/ui-20261016/unit');out.mkdir(parents=True,exist_ok=True)
node='/tmp/fangkun-r189-node22/node-v22.22.0-linux-x64/bin/node'
files=['src/lib/ui/fangkun-ui-20261016.test.ts','src/lib/ui/fieldwork.test.ts','src/lib/core/coach-fieldwork-context.test.ts','src/lib/core/coach-fuel.test.ts','src/lib/core/trial.test.ts','src/lib/core/backup-inspection.test.ts','src/lib/nutrition/timing.test.ts','src/lib/nutrition/vitals.test.ts','src/lib/strength/demo-fieldwork.test.ts','src/lib/running-technique/catalogue.test.ts','src/lib/core/coach-local-first.test.ts','src/lib/core/coach-red-flags.test.ts']
results=[]
for f in files:
 p=out/(Path(f).stem+'-final.log')
 with p.open('w') as stream:r=subprocess.run([node,'--import','./scripts/test-register.mjs',f],cwd=root,stdout=stream,stderr=subprocess.STDOUT)
 txt=p.read_text();counts={k:int(re.search(r'^# '+k+r' (\d+)',txt,re.M).group(1)) if re.search(r'^# '+k+r' (\d+)',txt,re.M) else 0 for k in ['tests','pass','fail','skipped','cancelled']}
 item={'file':f,'exitCode':r.returncode,'log':str(p),**counts};results.append(item);print(json.dumps(item),flush=True)
(out/'summary.json').write_text(json.dumps(results,indent=2));sys.exit(any(x['exitCode'] for x in results))
