"""Reproducible full source/resource archives; never modifies the source tree."""
from pathlib import Path
import subprocess,zipfile,hashlib,json,io,os
root=Path(__file__).resolve().parents[2]
out=Path('/workspace/fangkun-delivery-phased-20261028')
out.mkdir(exist_ok=True)
files=set(filter(None,subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=root).decode().split('\0')))
# Private fixtures remain untouched in the working repository. Historical screenshots
# and logs are not needed to rebuild and have not been independently privacy reviewed.
excluded=[];selected=[]
for name in sorted(files):
 p=root/name
 skip=(not p.is_file() or name.startswith('test-fixtures/private/') or name.startswith('verification/') and not name.startswith(('verification/phased-plan-20261028/','verification/implementation-20261028/personal/panel-fixture.')) or name.startswith('docs/') and p.suffix.lower() in ('.png','.jpg','.webp','.docx','.pdf') or '__pycache__' in p.parts or p.name.startswith('.env') or p.suffix in ('.pyc','.zip') or name.startswith(('.git/','node_modules/','.output/','.nitro/')))
 if skip:excluded.append(name)
 else:selected.append(name)
manifest=[];parts=[];limit=14_500_000;current=None;index=0
for name in selected:
 data=(root/name).read_bytes()
 # Exact single member compressed size plus a conservative central-directory reserve.
 probe=io.BytesIO()
 with zipfile.ZipFile(probe,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:z.writestr(name,data)
 estimate=len(probe.getvalue())+256
 if estimate>limit:raise RuntimeError('Individual file exceeds package limit: '+name)
 if current is None or current.fp.tell()+estimate>limit:
  if current:current.close()
  index+=1;path=out/f'fangkun-full-{index:02}.zip';parts.append(path)
  current=zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=6)
 current.writestr('fangkun/'+name,data)
 manifest.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'package':parts[-1].name})
if current:current.close()
packages=[]
for path in parts:
 assert path.stat().st_size<=15_000_000
 with zipfile.ZipFile(path) as z:
  assert z.testzip() is None
 packages.append({'file':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
manifest_bytes=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
(out/'FILES.json').write_bytes(manifest_bytes)
(out/'PACKAGES.json').write_text(json.dumps({'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'sourceManifestSha256':hashlib.sha256(manifest_bytes).hexdigest(),'packages':packages,'excluded':excluded},ensure_ascii=False,indent=2))
(out/'SHA256SUMS.txt').write_text(''.join(f"{p['sha256']}  {p['file']}\n" for p in packages)+hashlib.sha256(manifest_bytes).hexdigest()+'  FILES.json\n')
print(json.dumps({'files':len(manifest),'packages':len(packages),'bytes':sum(p['bytes'] for p in packages),'manifestSha256':hashlib.sha256(manifest_bytes).hexdigest()}),flush=True)
