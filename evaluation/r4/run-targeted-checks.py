# Offline deterministic regression; no model or credential access.
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,json,re,shlex,os,sys
root=Path(__file__).resolve().parents[2];out=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/fangkun-r4-verification');out.mkdir(exist_ok=True)
pkg=json.loads((root/'package.json').read_text())
files=[x for x in shlex.split(pkg['scripts']['test:deepseek-remediation']) if x.endswith(('.test.ts','.test.mjs','.test.tsx'))]
files+=['evaluation/deepseek-development/operator-bootstrap.test.ts','evaluation/deepseek-development/bootstrap-cli.test.ts','evaluation/deepseek-development/evaluation-service.test.ts','evaluation/deepseek-development/p0-remediation.test.ts','evaluation/deepseek-development/prepare-chain-ab.test.ts','evaluation/deepseek-development/expanded-service.test.ts','evaluation/deepseek-development/configurable-limits.test.ts','src/lib/coach/deepseek-server-boundary.test.ts']
files += ['evaluation/deepseek-development/protocol-preservation.test.ts','evaluation/r4/acceptance-replay.test.ts']
files += [str(p.relative_to(root)) for p in (root/'src/lib/coach/r4').glob('*.test.ts')]
files=list(dict.fromkeys(x for x in files if (root/x).is_file()))
def run(f):
 cmd=['node','--import','./evaluation/deepseek-development/no-network.mjs','--import','./scripts/test-register.mjs',f]
 r=subprocess.run(cmd,cwd=root,text=True,capture_output=True,timeout=100);text=r.stdout+r.stderr
 log=out/(f.replace('/','__')+'.log');log.write_text(text)
 counts={k:int(m[1]) if (m:=re.search(r'(?:ℹ |# )'+k+r' (\d+)',text)) else None for k in ['tests','pass','fail','skipped']}
 return {'file':f,'exitCode':r.returncode,**counts,'log':log.name}
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,files))
(out/'targeted-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2));print('TOTAL_ASSERTIONS',sum(r['tests'] or 0 for r in results),'FAILED_FILES',[r['file'] for r in results if r['exitCode']])
raise SystemExit(any(r['exitCode'] for r in results))
