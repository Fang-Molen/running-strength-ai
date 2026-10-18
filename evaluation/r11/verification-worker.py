"""Bounded local verification worker. No deployment or model endpoint is available here.
The network permission is needed for Node child IPC and loopback browser/server communication.
Commands are a fixed allowlist; new shell commands cannot be submitted through stdin.
"""
import subprocess,json,sys,os,datetime
from pathlib import Path
root=Path('/workspace/fangkun/evidence/r11');root.mkdir(exist_ok=True,parents=True)
env=os.environ.copy();env['npm_config_cache']='/tmp/fangkun-npm-cache';env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']='/usr/bin/chromium';env['BROWSER_SMOKE_TIMEOUT_MS']='120000'
commands={
 'ci':['npm','ci','--offline','--no-audit'],
 'test':['npm','test'],
 'domain':['npm','run','test:domain'],
 'strict':['npx','--no-install','tsc','--noEmit','--strict'],
 'build':['npm','run','build'],
 'start':['sh','/workspace/startup.sh'],
 'browser':['node','evaluation/r11/browser-e2e.mjs'],
 'smoke-dev':['node','scripts/browser-smoke.mjs','http://127.0.0.1:8080/','/workspace/screenshots/fangkun-r11/dev.png'],
 'preview':['npm','run','preview:restart'],
 'smoke-prod':['node','scripts/browser-smoke.mjs','http://127.0.0.1:8081/','/workspace/screenshots/fangkun-r11/production.png','--baseline','/workspace/screenshots/fangkun-r11/dev.json'],
 'metrics':['node','--import','./scripts/test-register.mjs','evaluation/r11/metrics.ts'],
}
print('READY: '+','.join(commands)+',stop',flush=True)
for line in sys.stdin:
 key=line.strip()
 if key=='stop':break
 if key not in commands:print('REJECTED unknown verification operation',flush=True);continue
 logname='npm-ci' if key=='ci' else key
 dest=root/(logname+'.log')
 if dest.exists():dest.rename(root/(logname+'-prior-'+datetime.datetime.now().strftime('%H%M%S')+'.log'))
 print('START '+key,flush=True)
 with dest.open('w') as out:
  result=subprocess.run(commands[key],stdout=out,stderr=subprocess.STDOUT,env=env)
 status={'command':commands[key],'exitCode':result.returncode,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 (root/(logname+'.status.json')).write_text(json.dumps(status))
 print('FINISHED '+key+' '+str(result.returncode),flush=True)
