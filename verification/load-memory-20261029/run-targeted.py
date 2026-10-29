from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,os,re,json,time
root=Path(__file__).resolve().parents[2];out=Path(__file__).resolve().parent
patterns=[r'load-.*test',r'online-.*test',r'context-period.*test',r'quick-log.*test',r'pet-capture.*test',r'analysis-evidence.*test',r'recovery-host.*test',r'import-log-correction.*test',r'storage-journal.*test',r'training-record-sync.*test']
files=sorted(p for base in ['src/lib','src/components','server/coach-deepseek'] for p in (root/base).rglob('*test.ts*') if any(re.search(pattern,p.name) for pattern in patterns))
env=dict(os.environ,FK_NO_TEST_PLAN='1',FK_CAPTURE_LOAD_MEMORY='1',FANGKUN_DEEPSEEK_ENABLED='false')
for key in ['DATABASE_URL','DEEPSEEK_API_KEY','XAI_API_KEY']:env.pop(key,None)
(out/'final-tests').mkdir(exist_ok=True)
def run(p):
 name=str(p.relative_to(root));log=out/'final-tests'/(name.replace('/','__')+'.log');start=time.monotonic()
 with log.open('w') as f:r=subprocess.run(['node','--import','./evaluation/deepseek-development/no-network.mjs','--import','./scripts/test-register.mjs',name],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=90)
 s=log.read_text();counts={k:int(m[-1]) if (m:=re.findall(r'(?:ℹ|#) '+k+r' (\d+)',s)) else None for k in ['tests','pass','fail','skipped']}
 return dict(file=name,exit=r.returncode,seconds=round(time.monotonic()-start,3),**counts)
start=time.monotonic()
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,files))
summary={'files':len(results),'filePass':sum(x['exit']==0 for x in results),'fileFail':sum(x['exit']!=0 for x in results),'tests':sum(x['tests'] or 0 for x in results),'pass':sum(x['pass'] or 0 for x in results),'fail':sum(x['fail'] or 0 for x in results),'seconds':round(time.monotonic()-start,3),'results':results}
(out/'final-tests.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='results'}));print(json.dumps([r for r in results if r['exit']]))
raise SystemExit(1 if summary['fileFail'] else 0)
