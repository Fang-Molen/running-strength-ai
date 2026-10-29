"""Read-only source version check. Never reads browser records, secrets or production."""
from pathlib import Path
import hashlib,json,subprocess,sys
root=Path(__file__).resolve().parents[2]
expected=json.loads((root/'docs/load-memory-20261029/TEST-WORKSPACE.json').read_text())
r=subprocess.run(['git','rev-parse','HEAD'],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
actual_head=r.stdout.decode().strip() if r.returncode==0 else None
missing=[];changed=[]
for item in expected['files']:
 p=root/item['path']
 if not p.is_file():missing.append(item['path'])
 elif hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:changed.append(item['path'])
has_baseline=bool(actual_head) and subprocess.run(['git','merge-base','--is-ancestor',expected['baseline'],actual_head],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
match=has_baseline and not missing and not changed
print(json.dumps({'readyToTestThisSnapshot':match,'head':actual_head,'baseline':expected['baseline'],'baselineIsAncestor':has_baseline,'expectedCodeSignature':expected['codeSignature'],'checkedFiles':len(expected['files']),'missingFiles':missing,'differentFiles':changed,'dataScope':'Synthetic fixtures included; browser localStorage/IndexedDB and real user records are not automatically shared.','limits':['Paid DeepSeek calls authorized only for the supplied synthetic campaign, after configuration','No production migration, merge, PR, release or deployment']},ensure_ascii=False,indent=2))
sys.exit(0 if match else 2)
