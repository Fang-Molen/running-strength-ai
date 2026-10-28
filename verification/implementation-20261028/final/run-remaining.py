import json, os, pathlib, subprocess, time
root=pathlib.Path(__file__).resolve().parents[3]
out=pathlib.Path(__file__).resolve().parent
env=os.environ.copy()
for key in ['DATABASE_URL','DEEPSEEK_API_KEY','XAI_API_KEY']: env.pop(key,None)
env['FANGKUN_DEEPSEEK_ENABLED']='false'
commands=json.loads((root/'package.json').read_text())['scripts']['test'].split(' && ')[3:]
extra=json.loads((out/'extra-test-files.json').read_text())
commands.append('node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 '+' '.join(extra))
results=[]
for i,cmd in enumerate(commands):
 name=f'remaining-{i+1:02}.log';start=time.time()
 with (out/name).open('w') as log:
  result=subprocess.run(cmd,shell=True,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'command':cmd,'exit':result.returncode,'seconds':round(time.time()-start,2),'log':name})
 (out/'remaining-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
 print(f'{i+1}/{len(commands)} exit={result.returncode} {name}',flush=True)
raise SystemExit(any(r['exit'] for r in results))
