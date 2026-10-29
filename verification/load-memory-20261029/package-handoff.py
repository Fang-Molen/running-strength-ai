"""Small cumulative handoff; read-only against source and raw user data."""
from pathlib import Path
import subprocess,zipfile,hashlib,json,datetime
root=Path(__file__).resolve().parents[2];out=Path('/workspace/fangkun-load-memory-delivery-20261029');out.mkdir(exist_ok=True)
base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip()
with zipfile.ZipFile('/workspace/Fangkun-GPT-Work-Handoff.zip') as z:old=json.loads(z.read('MANIFEST.json'))
paths={f['path'] for f in old['files']}
paths.update(filter(None,subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=root).decode().splitlines()))
paths.update(filter(None,subprocess.check_output(['git','ls-files','--others','--exclude-standard','src','server','scripts'],cwd=root).decode().splitlines()))
for folder in ['docs/load-memory-20261029','verification/load-memory-20261029']:
 paths.update(str(p.relative_to(root)) for p in (root/folder).rglob('*') if p.is_file())
paths.update(['docs/load-ui-codex-handoff.md','docs/load-evidence-research-handoff.md','docs/load-evidence-prototype-plan.md','docs/phased-plan-20261028/PRE-LOAD-MEMORY-SNAPSHOT.md'])
excluded=[];files=[]
sha=lambda data:hashlib.sha256(data).hexdigest()
for name in sorted(paths):
 p=root/name
 if not p.is_file() or name.startswith(('test-fixtures/private/','.env','.git/','node_modules/','.output/','.nitro/','verification/load-memory-20261029/pre-package/')) or '__pycache__' in p.parts or p.suffix in ['.pyc','.zip']:
  excluded.append(name);continue
 raw=p.read_bytes();b=subprocess.run(['git','show',base+':'+name],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 target=out/'changes'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
 files.append({'path':name,'action':'modify' if b.returncode==0 else 'add','baseSha256':sha(b.stdout) if b.returncode==0 else None,'sha256':sha(raw),'bytes':len(raw)})
manifest={'baseline':base,'repo':'Fang-Molen/fangkun','sourceBranch':'codex/coaching-repairs-20261028','localBranch':'codex/phased-plan-local-20261028','uncommitted':True,'fullSource':False,'cumulative':True,'includesPreviousHandoffChanges':True,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'excluded':excluded,'files':files}
(out/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(out/'CURRENT-TASK.md').write_text((root/'docs/load-memory-20261029/CURRENT-TASK.md').read_text())
(out/'START-HERE.md').write_text('''# GPT Work 接续入口

先读 CURRENT-TASK.md，再读 changes/docs/load-memory-20261029/EXECUTION.md 和 ACCEPTANCE.md。

这是基于9263254的**累计增量包**：包含此前交接成果及本轮负荷/曲线/记忆修改，不是完整源码。不要先套旧小包再覆盖此包；同工作区直接接续，不重置。独立工作区从 Fang-Molen/fangkun 的 codex/coaching-repairs-20261028 分支取源码，核对完整基线提交。

MANIFEST.json记录每个文件的基线及当前SHA256。先运行 `python3 restore.py /目标仓库` 只检查；全部可安全匹配后用 `--apply` 合入。已是目标版本则跳过；现有不同修改会拒绝覆盖，需要人工整合。不会删除数据、清理工作区、安装依赖或联网。

最新：34文件318项回归、类型检查通过；真实HTTP控制器内假模型通过。完整验收尚缺本轮浏览器和预渲染产物（本地监听EPERM），研究全文核对部分未完成。旧截图/旧构建不能替代本轮验收。没有推送、部署、生产迁移或付费调用。

用户只需此交接包，不需重发全量源码。若工作区和GitHub都不可访问，再索取原完整包。\n''')
zip_path=Path('/workspace/Fangkun-GPT-Work-Load-Memory-Handoff.zip')
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name in ['START-HERE.md','CURRENT-TASK.md','MANIFEST.json','restore.py']+(['RESTORE-VERIFIED.json'] if (out/'RESTORE-VERIFIED.json').exists() else []):z.write(out/name,name)
 for row in files:z.write(out/'changes'/row['path'],'changes/'+row['path'])
with zipfile.ZipFile(zip_path) as z:
 assert z.testzip() is None
 for row in files:assert sha(z.read('changes/'+row['path']))==row['sha256']
assert zip_path.stat().st_size<15000000
report={'zip':str(zip_path),'bytes':zip_path.stat().st_size,'sha256':sha(zip_path.read_bytes()),'sourceFiles':len(files),'crc':'PASS','allFileHashes':'PASS','baseline':base,'fullSource':False}
(out/'PACKAGE-VERIFIED.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
zip_path.with_suffix('.sha256').write_text(report['sha256']+'  '+zip_path.name+'\n')
print(json.dumps(report))
