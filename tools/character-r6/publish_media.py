#!/usr/bin/env python3
"""Fail-closed R6 media publication: exact identity + third-party approval evidence + SHA256.
No automatic acceptance of generated output. Dry-run unless --write.
"""
import argparse,csv,hashlib,json,re,shutil,struct,sys
from pathlib import Path
ROLE={'female':'fk-female-20261017','male':'fk-male-20261017'}
REV={'model':['rights','identity','rig','morph','mobile'],'video':['rights','identity','biomechanics','equipment','mobile']}
def glb_info(data):
 if data[:4]!=b'glTF' or len(data)<32 or int.from_bytes(data[4:8],'little')!=2 or int.from_bytes(data[8:12],'little')!=len(data):raise ValueError('not a GLB 2.0 binary')
 at=12;gl=None
 while at+8<=len(data):
  n,t=struct.unpack_from('<II',data,at);at+=8
  if at+n>len(data):raise ValueError('malformed GLB chunk')
  if t==0x4e4f534a:gl=json.loads(data[at:at+n].decode('utf8').strip(' \0'))
  at+=n
 if not gl:raise ValueError('GLB missing JSON')
 if any(x.get('uri') for x in gl.get('buffers',[])) or any(x.get('uri') and not x['uri'].startswith('data:') for x in gl.get('images',[])):raise ValueError('GLB must be self-contained; external resources forbidden')
 skins=gl.get('skins') or [];meshes=gl.get('meshes') or [];a=gl.get('accessors') or [];morphs=set()
 vertices=0;faces=0
 for m in meshes:
  names=(m.get('extras') or {}).get('targetNames') or []
  for p in m.get('primitives') or []:
   targets=p.get('targets') or []
   morphs.update(name for i,name in enumerate(names) if i<len(targets) and 'POSITION' in targets[i])
   pos=p.get('attributes',{}).get('POSITION');idx=p.get('indices')
   if pos is not None and pos<len(a):vertices+=a[pos].get('count',0)
   if idx is not None and idx<len(a):faces+=a[idx].get('count',0)//3
 if not skins or max(len(s.get('joints',[])) for s in skins)<20:raise ValueError('missing production skin and 20+ bones')
 if not any('skin' in n and 'mesh' in n and any('JOINTS_0' in p.get('attributes',{}) and 'WEIGHTS_0' in p.get('attributes',{}) for p in meshes[n['mesh']].get('primitives',[])) for n in gl.get('nodes',[])):raise ValueError('missing actually skinned mesh')
 if not (1000<=vertices<=170000 and 1000<=faces<=240000):raise ValueError('mesh exceeds mobile polygon budget or invalid geometry')
 if not set(['slender','lean','muscular','adipose']).issubset(morphs):raise ValueError('health body-shape morph targets absent')
 if not gl.get('materials'):raise ValueError('missing materials')
 return {'skin_count':len(skins),'vertices':vertices,'triangles':faces,'morphs':sorted(morphs)}
def check_evidence(repo,ev,kind):
 sex=ev.get('gender')
 if sex not in ROLE or ev.get('status')!='APPROVED':raise ValueError('not an approved Fangkun male/female character')
 key='id' if kind=='model' else 'characterId'
 if ev.get(key)!=ROLE[sex]:raise ValueError('wrong character identity')
 if not isinstance(ev.get('reviewer'),str) or len(ev['reviewer'].strip())<4 or re.search('TODO|TBD|PENDING|待填',ev['reviewer'],re.I):raise ValueError('human reviewer required')
 for label in ('licenseEvidence','qaEvidence'):
  val=ev.get(label)
  if not isinstance(val,str) or not re.fullmatch(r'docs/media-qa/[a-zA-Z0-9_./-]+\.(?:json|pdf|md)',val) or '..' in val or not (repo/val).is_file() or not (repo/val).resolve().is_relative_to((repo/'docs/media-qa').resolve()):raise ValueError('missing rights or QA evidence')
 if not isinstance(ev.get('reviews'),dict) or any(ev['reviews'].get(k)!='PASS' for k in REV[kind]):raise ValueError('not all manual audit gates PASS')
 if kind=='video' and not isinstance(ev.get('exerciseId'),str):raise ValueError('missing exerciseId')
 if kind=='video':
  with (repo/'docs/character-r6/153-动作覆盖原表.csv').open(encoding='utf8') as f:ids={r['ID'] for r in csv.DictReader(f)}
  if ev['exerciseId'] not in ids:raise ValueError('unknown exerciseId')
 if kind=='model' and (not isinstance(ev.get('version'),int) or ev['version']<1):raise ValueError('invalid version')
def inspect_video(path):
 import subprocess
 p=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate:format=duration','-of','json',str(path)],capture_output=True,text=True,check=True)
 dat=json.loads(p.stdout);streams=dat.get('streams',[])
 v=[x for x in streams if x.get('codec_type')=='video']
 if len(v)!=1 or any(x.get('codec_type')=='audio' for x in streams):raise ValueError('must have one video track without audio')
 if v[0].get('codec_name')!='h264' or v[0].get('pix_fmt')!='yuv420p':raise ValueError('expected H264 yuv420p')
 fps=v[0].get('r_frame_rate','0/1').split('/');rate=int(fps[0])/max(1,int(fps[1]))
 seconds=float(dat['format']['duration'])
 if not(23.9<=rate<=30.1 and 3<=seconds<=18):raise ValueError('fps or duration outside accepted range')
 if min(v[0]['width'],v[0]['height'])<320 or path.stat().st_size>15000000:raise ValueError('mobile video size invalid')
 return {'duration':seconds,'fps':rate}
def publish(repo,asset,evidence,kind,write=False):
 ev=json.loads(evidence.read_text('utf8'));check_evidence(repo,ev,kind)
 data=asset.read_bytes();sha=hashlib.sha256(data).hexdigest()
 if ev.get('sha256')!=sha:raise ValueError('approval does not match exact media hash')
 qa_path=repo/ev['qaEvidence']
 if qa_path.suffix!='.json':raise ValueError('QA must provide a machine-readable JSON receipt referencing visual evidence')
 qa=json.loads(qa_path.read_text('utf8'))
 identity='id' if kind=='model' else 'characterId'
 if any(qa.get(k)!=ev.get(k) for k in ['sha256','gender',identity,'reviewer','reviews']) or qa.get('status')!='APPROVED' or (kind=='video' and qa.get('exerciseId')!=ev.get('exerciseId')):raise ValueError('QA receipt identity/hash/reviews mismatch')
 if kind=='model':
  if len(data)>32*1024*1024:raise ValueError('model exceeds mobile byte budget')
  for legacy in (repo/'public/demo3d').rglob('*.glb'):
   if legacy.is_file() and hashlib.sha256(legacy.read_bytes()).hexdigest()==sha:raise ValueError('legacy avatar cannot be republished as the frozen new character')
 metrics=glb_info(data) if kind=='model' else inspect_video(asset)
 manifest=repo/('public/fangkun-character/manifest.json' if kind=='model' else 'public/fangkun-video/manifest-r6.json')
 schema='fangkun-character-v1' if kind=='model' else 'fangkun-video-v2'
 obj=json.loads(manifest.read_text('utf8')) if manifest.is_file() else {'schema':schema,'assets':[]}
 if obj.get('schema')!=schema or not isinstance(obj.get('assets'),list):raise ValueError('invalid current manifest')
 sex=ev['gender'];name=(f'{sex}-v{ev["version"]}-' if kind=='model' else f'{re.sub("[^a-z0-9-]","-",ev["exerciseId"].lower())}-{sex}-')+sha[:12]+('.glb' if kind=='model' else '.mp4')
 folder='models' if kind=='model' else 'assets'
 url=f'/fangkun-character/{folder}/{name}' if kind=='model' else f'/fangkun-video/{folder}/{name}'
 if any(x.get('gender')==sex and (kind=='model' or x.get('exerciseId')==ev['exerciseId']) for x in obj['assets']):raise ValueError('published entry exists; explicit replacement review required')
 entry={k:ev[k] for k in (['id','gender','version'] if kind=='model' else ['exerciseId','gender','characterId'])}
 entry.update(status='APPROVED',url=url,sha256=sha,reviewer=ev['reviewer'],licenseEvidence=ev['licenseEvidence'],qaEvidence=ev['qaEvidence'],reviews=ev['reviews'])
 if not write:return {'state':'DRY_RUN','metrics':metrics,'entry':entry}
 target=repo/('public'+url)
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(asset,target);obj['assets'].append(entry);manifest.parent.mkdir(parents=True,exist_ok=True)
 tmp=manifest.with_suffix('.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n','utf8');tmp.replace(manifest)
 return {'state':'WRITTEN','metrics':metrics,'entry':entry}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--file',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True);p.add_argument('--type',choices=['model','video'],required=True);p.add_argument('--write',action='store_true');a=p.parse_args()
 try:print(json.dumps(publish(a.repo.resolve(),a.file.resolve(),a.evidence.resolve(),a.type,a.write),ensure_ascii=False,indent=2))
 except Exception as e:print('BLOCKED:',str(e),file=sys.stderr);sys.exit(2)
