"""Run repository npm-test scope plus domain suite once, in isolated files; retain full Node TAP/spec output."""
from pathlib import Path
import subprocess,json,re,glob,shlex,os
root=Path.cwd();out=Path('/workspace/fangkun/evidence/r13/full-regression');out.mkdir(exist_ok=True)
pkg=json.loads((root/'package.json').read_text());files=set()
def expand(script):
 for part in pkg['scripts'][script].split('&&'):
  tokens=shlex.split(part.strip())
  if tokens[:2]==['npm','run']:expand(tokens[2]);continue
  for token in tokens:
   if '.test.' in token:
    files.update(glob.glob(token,recursive=True))
expand('test');expand('test:domain')
results=[]
# Gate tests expect these keys to be absent, not empty strings. No credentials enter tests.
test_env=os.environ.copy()
for key in ['DATABASE_URL','AI_MODEL_CALLS_ENABLED','XAI_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY']:
 test_env.pop(key,None)
for index,file in enumerate(sorted(files)):
 log=out/(file.replace('/','__')+'.log')
 cmd=['node']+(['--import','./scripts/test-register.mjs'] if file.endswith(('.ts','.tsx')) else [])+[file]
 with log.open('w') as stream:
  try:r=subprocess.run(cmd,stdout=stream,stderr=subprocess.STDOUT,timeout=150,env=test_env);code=r.returncode
  except subprocess.TimeoutExpired:code=124
 text=log.read_text();summary={k:int(v) for k,v in re.findall(r'^[ℹ#] (tests|pass|fail|cancelled|skipped|todo) (\d+)$',text,re.M)}
 results.append({'file':file,'exitCode':code,'log':log.name,**summary})
 (out/'results.json').write_text(json.dumps(results,indent=2))
 if code:print('FAILED',file,code,flush=True)
 if (index+1)%25==0:print('PROGRESS',index+1,len(files),flush=True)
print(json.dumps({'files':len(results),'failedFiles':sum(r['exitCode']!=0 for r in results),'tests':sum(r.get('tests',0) for r in results),'pass':sum(r.get('pass',0) for r in results),'fail':sum(r.get('fail',0) for r in results)}),flush=True)
