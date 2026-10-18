"""Run repository npm-test scope plus domain suite once, in isolated files; retain full Node TAP/spec output."""
from pathlib import Path
import subprocess,json,re,glob,shlex,os,shutil
from concurrent.futures import ThreadPoolExecutor,as_completed
root=Path.cwd();out=Path(os.environ.get('R185_EVIDENCE_DIR','/workspace/fangkun/evidence/r185/full-regression'));out.mkdir(parents=True,exist_ok=True)
pkg=json.loads((root/'package.json').read_text());files=set()
def expand(script):
 for part in pkg['scripts'][script].split('&&'):
  tokens=shlex.split(part.strip())
  if tokens[:2]==['npm','run']:expand(tokens[2]);continue
  for token in tokens:
   if '.test.' in token:
    files.update(glob.glob(token,recursive=True))
expand('test');expand('test:domain')
if os.environ.get('R185_TEST_FILES'):files=set(os.environ['R185_TEST_FILES'].split(','))
results=[]
# Gate tests expect these keys to be absent, not empty strings. No credentials enter tests.
test_env=os.environ.copy()
node=os.environ.get('R185_NODE') or shutil.which('node')
assert node, 'Node runtime required'
test_env['PATH']=str(Path(node).parent)+os.pathsep+test_env.get('PATH','')
for key in ['DATABASE_URL','AI_MODEL_CALLS_ENABLED','XAI_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY']:
 test_env.pop(key,None)
def run_file(file):
 log=out/(file.replace('/','__')+'.log')
 cmd=[node]+(['--import','./scripts/test-register.mjs'] if file.endswith(('.ts','.tsx')) else [])+[file]
 with log.open('w') as stream:
  try:r=subprocess.run(cmd,stdout=stream,stderr=subprocess.STDOUT,timeout=150,env=test_env);code=r.returncode
  except subprocess.TimeoutExpired:code=124
 text=log.read_text();summary={k:int(v) for k,v in re.findall(r'^[ℹ#] (tests|pass|fail|cancelled|skipped|todo) (\d+)$',text,re.M)}
 return {'file':file,'exitCode':code,'log':log.name,**summary}
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(run_file,file) for file in sorted(files)]):
  r=future.result();results.append(r)
  (out/'results.json').write_text(json.dumps(sorted(results,key=lambda r:r['file']),indent=2))
  if r['exitCode']:print('FAILED',r['file'],r['exitCode'],flush=True)
  if len(results)%25==0:print('PROGRESS',len(results),len(files),flush=True)
print(json.dumps({'files':len(results),'failedFiles':sum(r['exitCode']!=0 for r in results),'tests':sum(r.get('tests',0) for r in results),'pass':sum(r.get('pass',0) for r in results),'fail':sum(r.get('fail',0) for r in results)}),flush=True)

raise SystemExit(1 if any(r['exitCode'] or r.get('fail',0) or r.get('cancelled',0) for r in results) else 0)
