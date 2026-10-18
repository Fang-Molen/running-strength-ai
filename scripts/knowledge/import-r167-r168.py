"""Reproducible, offline candidate intake. Reads only supplied research artifacts, never athlete data."""
import sys,json,hashlib,re
from pathlib import Path
import openpyxl
source=Path(sys.argv[1]);workbook=Path(sys.argv[2]);dest=Path(sys.argv[3])
for row in json.loads((source/'MANIFEST.json').read_text()):
 data=(source/row['file']).read_bytes()
 assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256'],row['file']
framework=[json.loads(x) for x in (source/'260子题_研究知识框架.jsonl').read_text().splitlines()]
w=openpyxl.load_workbook(workbook,read_only=True,data_only=True);rows=list(w['规则表v2'].values)
rules=[dict(zip(rows[0],r)) for r in rows[1:] if r[0]]
cards=[]
for block in re.split(r'\n## ',(source/'R166_12张证据关联候选卡_原样继承.md').read_text())[1:]:
 lines=block.strip().splitlines();title=lines[0];fields={}
 for line in lines[1:]:
  m=re.match(r'\*\*(.+?)：\*\*\s*(.*)',line)
  if m:fields[m[1]]=m[2]
 cards.append({'id':'R166:'+re.search(r'D\d+-S\d+',title)[0],'title':title,'status':'DRAFT_REVIEW_REQUIRED','claim':fields['任务与科学理解'],'observation':fields['实施/观察'],'counterevidence':fields['反证及冲突'],'boundary':fields['适用边界'],'source':fields['继承来源'],'automaticExecution':False})
# Deliberately omit the historical green/yellow/red thresholds and original automatic actions from runtime data.
adapted=[{'id':'R168:'+r['编号'],'domain':r['维度'],'condition':r['条件'],'step':r['适用步骤'],'stage':r['适用周期'],'population':r['适用人群'],'nature':r['规则性质'],'summary':r['量化计算口径/说明'],'missing':r['缺失处理'],'boundary':r['修订后的动作约束'],'counterevidence':r['反证与适用边界'],'source':r['来源'],'status':'RESEARCH_CANDIDATE_NOT_VALIDATED','automaticExecution':False} for r in rules]
assert len(framework)==260 and len(rules)==132 and len(cards)==12
out={'version':'FK-R13-R167-R168-READONLY-1','workbookSha256':hashlib.sha256(workbook.read_bytes()).hexdigest(),'independentlyVerified':0,'framework':framework,'cards':cards,'rules':adapted}
dest.write_text('/* Generated from supplied R167/R168 artifacts; candidate references only. */\nexport const candidateIntake = '+json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'framework':260,'candidateCards':12,'candidateRules':132,'verifiedNewEvidence':0,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}))
