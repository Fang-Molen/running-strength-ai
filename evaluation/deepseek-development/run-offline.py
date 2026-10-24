"""One local-only batch, preserving per-stage stdout/stderr and exit status."""
import argparse,json,subprocess,os,shutil
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--stages',nargs='+',choices=['sixty-local','ab-contract','p0-contract','evaluation-service','server-boundary','emit-preparation']);args=parser.parse_args()
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[2]
node=shutil.which('node');assert node,'Node required'
shim=root/'evaluation/deepseek-development/no-network.mjs'
commands=[('sixty-local',['evaluation/deepseek-development/run-local.ts','--output',str(out/'local')]),('ab-contract',['evaluation/deepseek-development/prepare-chain-ab.test.ts']),('p0-contract',['evaluation/deepseek-development/p0-remediation.test.ts']),('evaluation-service',['evaluation/deepseek-development/evaluation-service.test.ts']),('server-boundary',['src/lib/coach/deepseek-server-boundary.test.ts']),('emit-preparation',['evaluation/deepseek-development/prepare-offline.ts','--output',str(out)])]
results=[]
for name,parts in commands:
 if args.stages and name not in args.stages:continue
 command=[node,'--import',str(shim),'--import','./scripts/test-register.mjs',*parts]
 try:
  p=subprocess.run(command,cwd=root,capture_output=True,text=True,timeout=240)
  (out/(name+'.log')).write_text(p.stdout+p.stderr)
  row={'name':name,'command':command,'exitCode':p.returncode}
 except subprocess.TimeoutExpired as e:
  (out/(name+'.log')).write_bytes((e.stdout or b'')+(e.stderr or b''));row={'name':name,'command':command,'exitCode':None,'error':'TIMEOUT_240_SECONDS'}
 results.append(row);(out/('regression-execution-log.json' if args.stages else 'execution-log.json')).write_text(json.dumps(results,indent=2));print(json.dumps(row),flush=True)
raise SystemExit(1 if any(r['exitCode']!=0 for r in results) else 0)
