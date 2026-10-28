"""Local builds and isolated browser harness. No real keys, accounts or deployments."""
import json,os,pathlib,subprocess,time,urllib.request
root=pathlib.Path(__file__).resolve().parents[2];out=pathlib.Path(__file__).resolve().parent
env=os.environ.copy()
for k in ['DATABASE_URL','DEEPSEEK_API_KEY','XAI_API_KEY']:env.pop(k,None)
env.update(FANGKUN_DEEPSEEK_ENABLED='false',PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/usr/bin/chromium',BROWSER_SMOKE_BLOCK_SW='1')
results=[]
def run(name,args):
    with (out/(name+'.log')).open('w') as log:
        result=subprocess.run(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
    results.append({'name':name,'command':args,'exit':result.returncode})
    (out/'runtime-results.json').write_text(json.dumps(results,indent=2)+'\n');print(name,result.returncode,flush=True)
    return result.returncode==0
def wait_http(url):
    for _ in range(100):
        try:urllib.request.urlopen(url,timeout=1);return
        except Exception:time.sleep(.2)
    raise RuntimeError('local service unavailable: '+url)
children=[]
try:
    # Environment-only script tests already passed; retain their earlier log.
    static=run('build-authorized',['npm','run','build'])
    subprocess.run(['sh','/workspace/startup.sh'],env=env,check=True)
    for name,args in [('harness',['node','--import','./scripts/test-register.mjs',str(out/'browser/browser-harness.ts')])]:
        log=(out/(name+'-runtime.log')).open('w');children.append(subprocess.Popen(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True))
    wait_http('http://127.0.0.1:8080');wait_http('http://127.0.0.1:8095/__test/status')
    if any(p.poll() is not None for p in children):raise RuntimeError('current harness exited; never reuse a different process')
    run('browser-flows',['node',str(out/'browser/flows.mjs')])
    dev=run('smoke-dev',['node','scripts/browser-smoke.mjs','http://127.0.0.1:8080','/workspace/screenshots/fangkun-repairs-dev.png'])
    if static:
        run('preview-start',['npm','run','preview:restart'])
        run('smoke-built',['node','scripts/browser-smoke.mjs','http://127.0.0.1:8081','/workspace/screenshots/fangkun-repairs-built.png','--baseline','/workspace/screenshots/fangkun-repairs-dev.json'])
        run('preview-stop',['npm','run','preview:stop'])
    if run('build-server-authorized',['npm','run','build:server']):run('node-runtime',['node',str(out/'node-runtime-probe.mjs')])
finally:
    import signal
    for child in children:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
raise SystemExit(any(r['exit'] for r in results))
