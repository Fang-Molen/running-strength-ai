"""Local CC0 derivatives: paired illustrative adult characters, shared rig and clips.
Not a scan, physique prediction, clinical model or personal likeness reconstruction.
"""
import importlib.util,json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('builder',Path(__file__).with_name('build-athlete.py')); b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
root=Path(__file__).resolve().parents[2];source=root/'public/demo3d/models/athlete.glb'
for sex,name in [('male','athlete-male'),('female','athlete-female')]:
 g=b.Glb(source)
 if sex=='female':
  p=b.world_positions(g,0);joints,weights,names=b.bone_weights(g,0)
  torso=np.sum(weights*np.isin(joints,[names.index(n) for n in ['pelvis','spine_01','spine_02','spine_03']]),axis=1)
  x,y,z=p.T;d=np.zeros_like(p)
  # Modest authored silhouette variation within the shared adult skeleton.
  d[:,0]=x*(.08*b.bump(y,1.08,.20)-.07*b.bump(y,1.48,.25))*torso
  d[:,2]=(.012*b.bump(y,1.5,.13)*b.smooth(.015,.07,z)+z*.06*b.bump(y,1.1,.2))*torso
  pr=g.j['meshes'][0]['primitives'][0];base=g.accessor(pr['attributes']['POSITION']);faces=g.accessor(pr['indices'],False).reshape(-1,3)
  delta=d@np.linalg.inv(b.mesh_rest_transform(g,0)[:3,:3]).T;new=base+delta
  pr['attributes']['POSITION']=g.add_accessor(new);pr['attributes']['NORMAL']=g.add_accessor(b.recompute_normals(new,faces))
 # Same white/charcoal trainers and material finish on both figures. Keep UV detail.
 im=np.array(g.image(4));rgb=im[:,:,:3].astype(float);lum=rgb@np.array([.2126,.7152,.0722]);neutral=np.clip(90+.66*lum,0,245)
 im[:,:,:3]=np.stack([neutral,neutral*.99,neutral*.96],axis=2).astype('uint8');g.replace_image(4,Image.fromarray(im))
 # Portable embedded textures, bounded to phone-friendly dimensions (no remote textures).
 for i in range(len(g.j['images'])):
  im=g.image(i);im.thumbnail((1024,1024));g.replace_image(i,im)
 g.j['asset']['generator']='Fangkun v74 UI integrated paired reference characters'
 g.j.setdefault('extras',{})['fangkunReference']={'sexPresentation':sex,'illustrationOnly':True,'same53BoneRig':True,'physiqueCalibration':False,'personalLikenessVerified':False}
 b.compact_views(g);dest=source.with_name(name+'.glb');g.save(dest)
 meta={'model':name+'.glb','sexPresentation':sex,'source':'athlete.glb','sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,'license':'CC0-1.0','limitations':['Authored adult visual reference; not individual anatomy or a validated body-composition prediction.','Shared bone lengths and exercise clips; not sex-specific biomechanical certification.','Original design face identity and loose garment simulation are not reproduced.']}
 dest.with_suffix('.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2));print(name,dest.stat().st_size)
