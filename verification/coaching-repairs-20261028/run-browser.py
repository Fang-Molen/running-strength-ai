"""Replay current browser flow against a fresh synthetic server; no paid calls."""
import os,subprocess,pathlib,time,urllib.request,signal,json
out=pathlib.Path(__file__).resolve().parent
root=out.parents[1]
env=os.environ.copy()
for k in ['DATABASE_URL','DEEPSEEK_API_KEY','XAI_API_KEY']:env.pop(k,None)
env['FANGKUN_DEEPSEEK_ENABLED']='false'
with (out/'harness-current.log').open('w') as log:
 p=subprocess.Popen(['node','--import','./scripts/test-register.mjs',str(out/'browser/browser-harness.ts')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 try:
  for _ in range(100):
   if p.poll() is not None:raise RuntimeError('current harness failed')
   try:urllib.request.urlopen('http://127.0.0.1:8095/__test/status',timeout=1);break
   except Exception:time.sleep(.2)
  with (out/'browser-current.log').open('w') as f:r=subprocess.run(['node',str(out/'browser/flows.mjs')],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180)
  print('browser exit',r.returncode);(out/'browser-current.exit').write_text(str(r.returncode)+'\n')
 finally:
  if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
raise SystemExit(r.returncode)
