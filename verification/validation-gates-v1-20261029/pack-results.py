"""Create the requested delivery ZIP, excluding environments, credentials and caches."""
from pathlib import Path
import tempfile,shutil,subprocess,json,hashlib,zipfile,os
root=Path(__file__).resolve().parents[2];p=root/'verification/validation-gates-v1-20261029';meta=json.loads((p/'CODE-VERSION.json').read_text());base,freeze=meta['baseline'],meta['frozen_candidate']
stage=Path(tempfile.mkdtemp(prefix='fangkun-v1-delivery-'));folder=stage/'Fangkun_回答校验V1_修复与验收结果';folder.mkdir()
shutil.copytree(p,folder/'verification/validation-gates-v1-20261029',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
for directory in ['completion-run','baseline-before-repair','repair']:
 shutil.copytree(root/'verification/new-questions-20261029'/directory,folder/'historical-real-tests'/directory,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
shutil.copyfile(root/'verification/new-questions-20261029/SUMMARY.md',folder/'historical-real-tests/SUMMARY.md')
changed=subprocess.check_output(['git','diff','--name-only',base,freeze],cwd=root,text=True).splitlines()
for name in changed:
 blob=subprocess.run(['git','show',freeze+':'+name],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if blob.returncode:continue
 f=folder/'changed-files'/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(blob.stdout)
patch=subprocess.check_output(['git','diff','--binary',base,freeze],cwd=root);(folder/'source.patch').write_bytes(patch)
for name in ['TESTING-HANDOFF.md','docs/load-memory-20261029/CURRENT-TASK.md','docs/superpowers/plans/2026-10-29-answer-validation-v1.md']:
 f=folder/name;f.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/name,f)
original=Path('/tmp/codex-remote-attachments/01a185d5-e89e-7710-aabc-5e6bccd9e0f2/AE421E34-C059-4334-9FFE-0B87D3C56CF0/1-Fangkun_校验关卡完善与Codex执行包_V1_20261029.zip')
if original.exists():shutil.copyfile(original,folder/'original-user-package.zip')
(folder/'README_先读结果.md').write_text(f'''# 方坤回答校验V1交付\n\n已执行本轮修复、50题离线控制器注入、9条旧真实回复重放、403项相关回归、23项工具自检及浏览器检查。没有新增真实DeepSeek请求，不把模拟测试当真实生成。\n\n**整体未放行：33题工程记录门槛符合，17题待完成；7题专业审核未签。** 逐题/逐criterion和未测/阻塞项详见 `verification/validation-gates-v1-20261029/SUMMARY.md`、`PER-CASE.md`、`review-results.jsonl`。没有合并、PR、发布或部署。\n\n新增真实用量0请求/0 tokens/增量API费0；历史真实105请求/312,883 tokens独立保留，账单金额NA。Codex会话账单不可读取，未冒充0。旧预算封存不变。\n\n代码冻结 `{freeze}`，基线 `{base}`，分支 `test/load-memory-20261029`。`source.patch`是基线到冻结代码的完整补丁，`changed-files/`保存这些提交的文件。它是变更与证据交付包，不是含所有未改动大资源/node_modules的整仓库；已有仓库检出基线后可先`git apply --check source.patch`再按需应用，或直接获取指定分支的冻结提交。后续交付提交仅增加报告/ZIP。\n\n`historical-real-tests/`保留旧付费原始记录，不能改称当前版本真实生成通过。当前50题实际模拟请求/响应、规范证据、最终正文和原因在`injection-results.jsonl`，所有开发尝试另存；模拟usage缺失仍为未知。原用户题包及哈希保持。\n\n全仓npm test在此前90c1129停于3项补练记录失败；同3项已在基线复现，后续链条未执行。全仓lint未通过。当前相关403项与类型检查/构建/浏览器通过不等于全仓或专业通过。L3真实生成、L5专业签审、外部真实工具/设备和10项标准尚未证实。\n\n每个文件哈希见`MANIFEST.json`。密钥仅从环境读取使用，包中不含密钥值、.env、真实用户数据或生产配置。\n''')
# Check patch applicability against the exact baseline contents of changed files.
checkroot=Path(tempfile.mkdtemp(prefix='fangkun-v1-patch-check-'))
for name in changed:
 blob=subprocess.run(['git','show',base+':'+name],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if blob.returncode:continue
 f=checkroot/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(blob.stdout)
check=subprocess.run(['git','apply','--check',str(folder/'source.patch')],cwd=checkroot,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
assert check.returncode==0,check.stdout.decode()
security={'patch_apply_check':'PASS','baseline':base,'frozen_candidate':freeze,'changed_files':len(changed),'source_patch_sha256':hashlib.sha256(patch).hexdigest()}
(folder/'PACKAGING.json').write_text(json.dumps(security,indent=2)+'\n')
files=sorted(f for f in folder.rglob('*') if f.is_file());key=os.environ.get('DEEPSEEK_API_KEY','').encode();assert key
assert all(key not in f.read_bytes() for f in files),'actual credential found in delivery'
manifest=[{'path':str(f.relative_to(folder)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files]
(folder/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
zip_path=root/'handoff/20261029/Fangkun_回答校验V1_修复与验收结果_20261029.zip';zip_path.parent.mkdir(exist_ok=True,parents=True)
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(folder.rglob('*')):
  if f.is_file():z.write(f,str(f.relative_to(stage)))
with zipfile.ZipFile(zip_path) as z:
 assert z.testzip() is None
 assert all(key not in z.read(n) for n in z.namelist())
 for f in manifest:assert hashlib.sha256(z.read(folder.name+'/'+f['path'])).hexdigest()==f['sha256']
report={'zip':str(zip_path.relative_to(root)),'bytes':zip_path.stat().st_size,'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest(),'files':len(manifest)+1,'archive_integrity':'PASS','manifest_check':'PASS','actual_credential_occurrences':0,**security}
(zip_path.with_suffix('.zip.sha256')).write_text(report['sha256']+'  '+zip_path.name+'\n');(root/'handoff/20261029/V1-DELIVERY.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
