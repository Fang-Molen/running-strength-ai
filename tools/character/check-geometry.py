"""Independent geometry/texture guard checks on the built GLB; no rendering or prediction."""
from pathlib import Path
import argparse,json,hashlib
from importlib.util import spec_from_file_location,module_from_spec
import numpy as np
from PIL import Image
spec=spec_from_file_location('athlete_builder',Path(__file__).with_name('build-athlete.py'));b=module_from_spec(spec);spec.loader.exec_module(b)
parser=argparse.ArgumentParser();parser.add_argument('output_folder');args=parser.parse_args();out=Path(args.output_folder);out.mkdir(exist_ok=True,parents=True)
g=b.Glb(b.ROOT/'public/demo3d/models/athlete.glb');p=b.world_positions(g,0);pr=g.j['meshes'][0]['primitives'][0];faces=g.accessor(pr['indices'],False).reshape(-1,3);matrix=b.mesh_rest_transform(g,0)[:3,:3]
deltas=[g.accessor(t['POSITION'])@matrix.T for t in pr['targets']]
base_cross=np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]]);base_area=np.linalg.norm(base_cross,axis=1);valid=base_area>1e-9
rng=np.random.default_rng(72);weights=list(np.eye(4))+[rng.dirichlet(np.ones(4)) for _ in range(24)]
results=[]
for w in weights:
 d=sum(value*delta for value,delta in zip(w,deltas));q=p+d;cross=np.cross(q[faces[:,1]]-q[faces[:,0]],q[faces[:,2]]-q[faces[:,0]])
 orientation=(base_cross*cross).sum(1)/(np.maximum(base_area,1e-12)*np.maximum(np.linalg.norm(cross,axis=1),1e-12))
 flips=int(((orientation<0)&valid).sum());collapsed=int(((np.linalg.norm(cross,axis=1)<1e-10)&valid).sum())
 assert flips==0,('new reversed face',w,flips)
 assert collapsed==0,('new collapsed face',w,collapsed)
 assert np.max(np.linalg.norm(d[p[:,1]<=.16],axis=1))==0,'foot moved'
 assert np.max(np.linalg.norm(d[p[:,1]>=1.735],axis=1))==0,'head moved'
 results.append({'weights':w.tolist(),'reversedFaces':flips,'collapsedFaces':collapsed,'minimumOrientationDot':float(orientation[valid].min())})
body=g.image(0);rgba=np.array(body);assert np.all(rgba[:,:,3]==255);assert g.j['materials'][0]['alphaMode']=='OPAQUE'
regions=np.array(Image.open(b.ROOT/'public/demo3d/models/regions.png').convert('RGB'));guard=(regions[:,:,1]>191)&(regions[:,:,0]==0)
assert guard.sum()>10000;assert np.all(rgba[guard,3]==255);assert np.max(rgba[guard,:3])<50
for i in [1,4]:assert g.j['materials'][i]['alphaMode']=='MASK'
report={'modelSHA256':hashlib.sha256(g.source).hexdigest(),'testedWeightCombinations':len(weights),'allSampledCombinationsHaveNoNewReversedOrCollapsedFaces':True,'feetAndHeadMorphDisplacement':0,'opaqueBodyTextureTexels':int(rgba.shape[0]*rgba.shape[1]),'opaqueUnlabelledPelvicGuardTexels':int(guard.sum()),'guardMaximumChannel8bit':int(rgba[guard,:3].max()),'limits':'Finite sampled combinations and base topology checks; not a proof of no self-intersections in every animated pose.','samples':results}
(out/'geometry-check.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='samples'},indent=2))
