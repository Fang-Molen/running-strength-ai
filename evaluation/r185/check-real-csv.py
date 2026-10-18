"""Read-only attachment consistency checks; extract private CSV for local adapter replay only."""
from pathlib import Path
import zipfile,hashlib,json,csv,io,datetime,statistics,os,sys
p=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/codex-remote-attachments/01a130be-e350-77d6-8c1e-c68aa7793017/DE598605-BDBE-49B6-BB2A-014D23053C79/1-周期性数据.zip')
out=Path(os.environ.get('R185_EVIDENCE_DIR','/workspace/fangkun/evidence/r185')); private=Path(os.environ.get('R185_PRIVATE_DATA_DIR','/workspace/fangkun/private-r185'));private.mkdir(exist_ok=True,mode=0o700)
original=p.read_bytes(); sha=hashlib.sha256(original).hexdigest();tables={};inventory=[];checks=[]
def check(name,ok):checks.append({'name':name,'status':'PASS' if ok else 'FAIL'})
with zipfile.ZipFile(io.BytesIO(original)) as z:
 for info in z.infolist():
  raw=z.read(info);inventory.append({'extension':Path(info.filename).suffix,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
  if info.filename.lower().endswith('.csv'):
   rows=list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))));header=next(iter(rows[0]))
   key='weekly' if header=='week_start' else 'questions' if 'question' in rows[0] else 'cycles' if 'cycle_type' in rows[0] else 'gaps'
   tables[key]=rows;(private/(key+'.csv')).write_bytes(raw)
w=tables['weekly'];cycles=tables['cycles'];refs=[]
check('unique_week_start',len({r['week_start'] for r in w})==len(w))
check('continuous_seven_day_weeks',all((datetime.date.fromisoformat(b['week_start'])-datetime.date.fromisoformat(a['week_start'])).days==7 for a,b in zip(w,w[1:])))
check('running_activity_count_not_more_than_all',all(float(r['running_sessions'])<=float(r['activity_count']) for r in w))
check('gap_markers_consistent',all((r['data_gap']=='True')==(float(r['activity_count'])==0) for r in w))
for c in cycles:
 rows=[r for r in w if r['cycle_id']==c['cycle_id']];total=sum(int(float(r['activity_count'])) for r in rows);runs=sum(int(float(r['running_sessions'])) for r in rows);rhrs=[float(r['rhr_mean']) for r in rows if r['rhr_mean'] not in ('','NaN','nan')];mean=statistics.mean(rhrs) if rhrs else None
 ok=(len(rows)==int(c['weeks']) and total==int(c['activity_count']) and runs==int(c['running_sessions']) and c['planned_goal']=='UNKNOWN' and c['deload_verified']=='UNKNOWN' and c['periodization_inferred']=='NO' and c['start']==rows[0]['week_start'] and c['end']==rows[-1]['week_end'])
 check(c['cycle_id']+':window_counts_dates_and_no_inferred_plan',ok)
 refs.append({'cycleId':c['cycle_id'],'weeks':len(rows),'activities':total,'runningActivities':runs,'meanWeeklyRhr':mean,'rhrWeeks':len(rhrs)})
check('questions_match_windows',{r['cycle_id'] for r in tables['questions']}=={r['cycle_id'] for r in cycles})
check('original_zip_unchanged',hashlib.sha256(p.read_bytes()).hexdigest()==sha)
(private/'expected.json').write_text(json.dumps(refs))
report={'zipSha256Before':sha,'zipSha256After':hashlib.sha256(p.read_bytes()).hexdigest(),'inventory':inventory,'weeks':len(w),'observationWindows':len(cycles),'activityCount':sum(int(float(r['activity_count'])) for r in w),'runningActivityCount':sum(int(float(r['running_sessions'])) for r in w),'confirmedTrainingSessions':None,'checks':checks,'skip':[{'name':n,'status':'SKIP','reason':'Original FIT/activity/identity/device data absent from supplied ZIP'} for n in ['FIT_session','FIT_lap','FIT_record','activity_file_deduplication','confirmed_training_structure','athlete_device_protocol_baseline']],'note':'Derived CSV internal consistency only; not independent verification of Garmin raw truth.'}
(out/'real-csv-intake.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'checks':len(checks),'pass':sum(r['status']=='PASS' for r in checks),'fail':sum(r['status']=='FAIL' for r in checks),'skip':len(report['skip'])}))
