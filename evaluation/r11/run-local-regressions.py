"""One OS process per file: preserves test isolation and captures child output in restricted IPC environments."""
from pathlib import Path
import subprocess,json,concurrent.futures
root=Path('/workspace/fangkun/evidence/r11/isolated');root.mkdir(exist_ok=True)
files=list(Path('src/lib/core').glob('*.test.ts'))+list(Path('src/lib/core').glob('*.test.tsx'))+list(Path('src/lib/core').glob('*.test.mjs'))+list(Path('src/lib/ui').glob('*.test.ts'))+list(Path('src/lib/strength').glob('*.test.ts'))+list(Path('src/lib/nutrition').glob('*.test.ts'))
def run(p):
 with (root/(p.name+'.log')).open('w') as out:
  r=subprocess.run(['node','--import','./scripts/test-register.mjs',str(p)],stdout=out,stderr=subprocess.STDOUT)
 return {'file':str(p),'exitCode':r.returncode}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 results=[]
 for r in pool.map(run,files):
  results.append(r)
  if r['exitCode']:print(r,flush=True)
(root/'results.json').write_text(json.dumps(results,indent=2))
print('files',len(results),'failures',sum(r['exitCode']!=0 for r in results),flush=True)
