from pathlib import Path
import os,re,json,time,subprocess
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parents[2];out=Path(__file__).resolve().parent/'related-tests';out.mkdir(exist_ok=True)
patterns=[r'load-.*test',r'online-.*test',r'context-period.*test',r'context-distance.*test',r'quick-log.*test',r'pet-capture.*test',r'analysis-evidence.*test',r'recovery-host.*test',r'import-log-correction.*test',r'storage-journal.*test',r'training-record-sync.*test',r'answer-.*test',r'question-calculation.*test',r'plan-reference.*test',r'assertion-policy.*test',r'strict-json.*test',r'coach-block-alias.*test']
files=sorted(p for base in ['src/lib','src/components','server/coach-deepseek'] for p in (root/base).rglob('*test.ts*') if any(re.search(pattern,p.name) for pattern in patterns))
env=dict(os.environ,FK_NO_TEST_PLAN='1',FANGKUN_DEEPSEEK_ENABLED='false')
for k in ['DATABASE_URL','DEEPSEEK_API_KEY','XAI_API_KEY']:env.pop(k,None)
def run(p):
 name=str(p.relative_to(root));start=time.monotonic();log=out/(name.replace('/','__')+'.log')
 with log.open('w') as f:r=subprocess.run(['node','--import','./evaluation/deepseek-development/no-network.mjs','--import','./scripts/test-register.mjs',name],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 attempts=1
 if r.returncode==-5:
  log.with_suffix('.v8-fatal.log').write_text(log.read_text())
  with log.open('w') as f:r=subprocess.run(['node','--import','./evaluation/deepseek-development/no-network.mjs','--import','./scripts/test-register.mjs',name],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
  attempts=2
 s=log.read_text();counts={k:int(m[-1]) if (m:=re.findall(r'(?:ℹ|#) '+k+r' (\d+)',s)) else 0 for k in ['tests','pass','fail']}
 return dict(file=name,exit=r.returncode,attempts=attempts,seconds=round(time.monotonic()-start,3),**counts)
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,files))
githead=(root/'.git/HEAD').read_text().strip();commit=(root/'.git'/githead[5:]).read_text().strip() if githead.startswith('ref: ') else githead
a={'candidate_commit':commit,'files':len(results),'tests':sum(r['tests'] for r in results),'pass':sum(r['pass'] for r in results),'fail':sum(r['fail'] for r in results),'fileFail':sum(r['exit']!=0 for r in results),'results':results};(out.parent/'related-tests.json').write_text(json.dumps(a,indent=2)+'\n');print(json.dumps({k:v for k,v in a.items() if k!='results'}));print(json.dumps([r for r in results if r['exit']]))
raise SystemExit(bool(a['fileFail']))
