"""Build a rig-compatible illustrative athlete from the bundled CC0 MakeHuman mesh.

No image-to-mesh claim and no body-fat/weight calibration. Source GLB is read only.
"""
from __future__ import annotations
import argparse, hashlib, io, json, struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
TYPES={5120:np.dtype('i1'),5121:np.dtype('u1'),5122:np.dtype('<i2'),5123:np.dtype('<u2'),5125:np.dtype('<u4'),5126:np.dtype('<f4')}
SIZES={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
CHANNELS=('slender','lean','muscular','adipose')

class Glb:
    def __init__(self,path):
        self.source=Path(path).read_bytes();magic,version,total=struct.unpack_from('<III',self.source)
        assert magic==0x46546c67 and version==2 and total==len(self.source)
        length,kind=struct.unpack_from('<II',self.source,12);assert kind==0x4e4f534a
        self.j=json.loads(self.source[20:20+length]);blen,bkind=struct.unpack_from('<II',self.source,20+length);assert bkind==0x004e4942
        self.bin=bytearray(self.source[28+length:28+length+blen])
    def accessor(self,index,normalized=True):
        a=self.j['accessors'][index];v=self.j['bufferViews'][a['bufferView']];dt=TYPES[a['componentType']];n=SIZES[a['type']]
        x=np.ndarray((a['count'],n),dtype=dt,buffer=self.bin,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',n*dt.itemsize),dt.itemsize)).copy()
        if normalized and a.get('normalized'):
            info=np.iinfo(dt);x=np.maximum(x.astype(np.float64)/info.max,-1) if info.min<0 else x.astype(np.float64)/info.max
        return x
    def append(self,data,target=None):
        self.bin.extend(b'\0'*((-len(self.bin))%4));offset=len(self.bin);self.bin.extend(data)
        v={'buffer':0,'byteOffset':offset,'byteLength':len(data)}
        if target:v['target']=target
        self.j['bufferViews'].append(v);return len(self.j['bufferViews'])-1
    def add_accessor(self,array,typ='VEC3',target=34962):
        a=np.asarray(array,dtype='<f4');view=self.append(a.tobytes(),target)
        self.j['accessors'].append({'bufferView':view,'componentType':5126,'count':len(a),'type':typ,'min':a.min(axis=0).tolist(),'max':a.max(axis=0).tolist()})
        return len(self.j['accessors'])-1
    def image(self,index):
        im=self.j['images'][index];v=self.j['bufferViews'][im['bufferView']]
        return Image.open(io.BytesIO(self.bin[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGBA')
    def replace_image(self,index,image):
        out=io.BytesIO();image.save(out,format='PNG',compress_level=9)
        self.j['images'][index].update(bufferView=self.append(out.getvalue()),mimeType='image/png')
    def save(self,path):
        self.j['buffers'][0]['byteLength']=len(self.bin);jb=json.dumps(self.j,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4)
        bb=bytes(self.bin);bb+=b'\0'*((-len(bb))%4);total=12+8+len(jb)+8+len(bb)
        Path(path).write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(bb),0x004e4942)+bb)

def quaternion_matrix(q):
    x,y,z,w=q;n=x*x+y*y+z*z+w*w;s=2/n if n else 0
    return np.array([[1-s*(y*y+z*z),s*(x*y-z*w),s*(x*z+y*w)],[s*(x*y+z*w),1-s*(x*x+z*z),s*(y*z-x*w)],[s*(x*z-y*w),s*(y*z+x*w),1-s*(x*x+y*y)]])

def node_worlds(j):
    parents={c:i for i,n in enumerate(j['nodes']) for c in n.get('children',[])};cache={}
    def world(i):
        if i in cache:return cache[i]
        n=j['nodes'][i]
        if 'matrix'in n:m=np.array(n['matrix']).reshape(4,4).T
        else:
            m=np.eye(4);m[:3,:3]=quaternion_matrix(n.get('rotation',[0,0,0,1]))@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0])
        cache[i]=world(parents[i])@m if i in parents else m;return cache[i]
    return {i:world(i) for i in range(len(j['nodes']))}

def mesh_rest_transform(g,mesh_index):
    n=next(n for n in g.j['nodes'] if n.get('mesh')==mesh_index);skin=g.j['skins'][n['skin']];worlds=node_worlds(g.j)
    ibm=g.accessor(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
    transforms=np.stack([worlds[i]@m for i,m in zip(skin['joints'],ibm)])
    assert np.max(np.abs(transforms-transforms[0]))<2e-6,'Unexpected nonuniform rest skinning'
    return transforms[0]

def world_positions(g,mesh_index):
    pr=g.j['meshes'][mesh_index]['primitives'][0];p=g.accessor(pr['attributes']['POSITION']);m=mesh_rest_transform(g,mesh_index)
    return p@m[:3,:3].T+m[:3,3]

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)

def bump(y,center,radius):
    t=np.clip(1-((y-center)/radius)**2,0,1);return t*t

def recompute_normals(p,faces):
    tri=p[faces];fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);n=np.zeros_like(p,dtype=np.float64)
    for c in range(3):np.add.at(n,faces[:,c],fn)
    return n/np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-12)

def bone_weights(g,mesh_index):
    pr=g.j['meshes'][mesh_index]['primitives'][0];n=next(n for n in g.j['nodes'] if n.get('mesh')==mesh_index);skin=g.j['skins'][n['skin']]
    joints=g.accessor(pr['attributes']['JOINTS_0'],False).astype(int);weights=g.accessor(pr['attributes']['WEIGHTS_0']);weights/=np.maximum(weights.sum(1)[:,None],1e-12)
    names=[g.j['nodes'][i]['name'] for i in skin['joints']]
    return joints,weights,names

def regional_targets(g):
    p=world_positions(g,0);joints,weights,names=bone_weights(g,0);worlds=node_worlds(g.j)
    centers={n['name']:worlds[i][:3,3] for i,n in enumerate(g.j['nodes'])}
    def group(*bones):return np.sum(weights*np.isin(joints,[names.index(n) for n in bones]),axis=1)
    torso=group('pelvis','spine_01','spine_02','spine_03')
    y=p[:,1];x=p[:,0];z=p[:,2]
    chest=bump(y,1.54,.23);waist=bump(y,1.28,.23);hips=bump(y,1.08,.20)
    # Restrict torso displacement to its own skinning influence; hands at the same height stay unchanged.
    torso_profiles={
      'slender':(-.12*chest-.11*waist-.08*hips,-.12*chest-.14*waist-.10*hips),
      'lean':(-.025*chest-.105*waist-.05*hips,-.035*chest-.18*waist-.065*hips),
      'muscular':(.12*chest-.025*waist+.025*hips,.20*chest-.025*waist+.04*hips),
      'adipose':(.10*chest+.30*waist+.18*hips,.14*chest+.55*waist+.27*hips),
    }
    targets={}
    for name,(rx,rz) in torso_profiles.items():
        d=np.zeros_like(p);d[:,0]=x*rx*torso
        # Front/back bulk follows the torso center, with a little extra anterior abdomen volume.
        center_z=-.005
        d[:,2]=(z-center_z)*rz*torso
        if name=='adipose':d[:,2]+=.020*waist*torso*smooth(.01,.09,z)
        targets[name]=d
    parts=[('upperarm','lowerarm',{'slender':-.18,'lean':-.055,'muscular':.30,'adipose':.16}),
           ('lowerarm','hand',{'slender':-.12,'lean':-.035,'muscular':.14,'adipose':.09}),
           ('thigh','calf',{'slender':-.15,'lean':-.065,'muscular':.20,'adipose':.23}),
           ('calf','foot',{'slender':-.13,'lean':-.045,'muscular':.22,'adipose':.09})]
    for start,end,factors in parts:
        for side in ['l','r']:
            a=centers[start+'_'+side];b=centers[end+'_'+side];axis=b-a;length=np.linalg.norm(axis);axis/=length
            along=(p-a)@axis;u=np.clip(along/length,0,1);on_axis=a+np.outer(along,axis);radial=p-on_axis
            influence=group(start+'_'+side)
            # Regional smooth bell leaves joint creases and extremities close to their original dimensions.
            bell=.28+.72*np.sin(np.pi*u)**2
            if start=='upperarm':bell=.42+.58*np.sin(np.pi*u)**2
            influence*=bell*smooth(.16,.27,y)
            for name,factor in factors.items():targets[name]+=radial*(influence*factor)[:,None]
    # Preserve head/neck, fingers, wrists and the complete feet exactly; never alter height globally.
    safe=(y>.16)&(y<1.735)
    for name in targets:targets[name]*=safe[:,None]
    return p,targets

def bake_portable_style(g):
    body=np.array(g.image(0).resize((2048,2048),Image.Resampling.LANCZOS))
    regions=np.array(Image.open(ROOT/'public/demo3d/models/regions.png').convert('RGB'))
    yy,xx=np.indices(body.shape[:2]);weave=1+.032*(np.cos(xx*np.pi*.67)+np.cos(yy*np.pi*.67))
    fabric=regions[:,:,1]>64;shorts=regions[:,:,1]>191
    color=np.zeros_like(body[:,:,:3],dtype=float);color[:]=[36,38,41];color[shorts]=[28,30,33]
    mask=Image.fromarray((fabric*255).astype('uint8'));inner=np.array(mask.filter(ImageFilter.MinFilter(5)))>0
    seam=fabric&~inner
    color*=weave[:,:,None];color[seam]*=.83
    body[:,:,:3][fabric]=np.clip(color[fabric],0,255).astype('uint8');body[:,:,3]=255
    g.replace_image(0,Image.fromarray(body))
    rough=np.full_like(body,255);rough[:,:,:3]=[255,143,0];rough[fabric,:3]=[255,230,0]
    output=io.BytesIO();Image.fromarray(rough).save(output,format='PNG',compress_level=9)
    g.j['images'].append({'name':'athlete_skin_cloth_roughness','mimeType':'image/png','bufferView':g.append(output.getvalue())})
    g.j['textures'].append({'source':len(g.j['images'])-1})
    bodymat=g.j['materials'][0];bodymat.update(alphaMode='OPAQUE',doubleSided=True)
    bodymat['pbrMetallicRoughness'].update(roughnessFactor=1,metallicFactor=0,metallicRoughnessTexture={'index':len(g.j['textures'])-1})
    for image_index in [1,5]:
        im=np.array(g.image(image_index));rgb=im[:,:,:3].astype(float)/255
        linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
        strand=np.clip((linear*np.array([.2126,.7152,.0722])).sum(2)*3,0,1)
        black=np.array([.010,.011,.013])+strand[:,:,None]*np.array([.035,.036,.038])
        im[:,:,:3]=np.clip((1.055*np.power(black,1/2.4)-.055)*255,0,255).astype('uint8')
        g.replace_image(image_index,Image.fromarray(im))
    for i,mat in enumerate(g.j['materials']):
        if i in [1,4]:mat.update(alphaMode='MASK',alphaCutoff=.35)
        else:mat['alphaMode']='OPAQUE'
        mat['pbrMetallicRoughness']['metallicFactor']=0
    g.j['materials'][4]['pbrMetallicRoughness']['roughnessFactor']=.76
    g.j['materials'][1]['pbrMetallicRoughness']['roughnessFactor']=.86
    g.j['materials'][2]['pbrMetallicRoughness']['roughnessFactor']=.24

def compact_views(g):
    used={a['bufferView'] for a in g.j['accessors'] if 'bufferView'in a}|{im['bufferView'] for im in g.j['images'] if 'bufferView'in im}
    old_bin=bytes(g.bin);old_views=g.j['bufferViews'];g.bin=bytearray();g.j['bufferViews']=[];mapping={}
    for i,v in enumerate(old_views):
        if i not in used:continue
        start=v.get('byteOffset',0);mapping[i]=g.append(old_bin[start:start+v['byteLength']],v.get('target'))
        if 'byteStride'in v:g.j['bufferViews'][-1]['byteStride']=v['byteStride']
    for a in g.j['accessors']:
        if 'bufferView'in a:a['bufferView']=mapping[a['bufferView']]
    for im in g.j['images']:
        if 'bufferView'in im:im['bufferView']=mapping[im['bufferView']]

def build():
    source=ROOT/'public/demo3d/models/human.glb';g=Glb(source)
    p,targets=regional_targets(g);pr=g.j['meshes'][0]['primitives'][0];base=g.accessor(pr['attributes']['POSITION']);faces=g.accessor(pr['indices'],False).reshape(-1,3)
    transform=mesh_rest_transform(g,0);inverse=np.linalg.inv(transform[:3,:3]);base_normals=recompute_normals(base,faces);target_refs=[];metrics={}
    for name in CHANNELS:
        delta=targets[name]@inverse.T;normal_delta=recompute_normals(base+delta,faces)-base_normals
        target_refs.append({'POSITION':g.add_accessor(delta),'NORMAL':g.add_accessor(normal_delta)})
        moved=np.linalg.norm(targets[name],axis=1)
        metrics[name]={'movedVertices':int((moved>1e-7).sum()),'maximumDisplacementMetres':float(moved.max()),'meanMovedDisplacementMetres':float(moved[moved>1e-7].mean()),'feetBelow016mMaximumDisplacement':float(moved[p[:,1]<=.16].max()),'headAbove1735mMaximumDisplacement':float(moved[p[:,1]>=1.735].max())}
    pr['targets']=target_refs;g.j['meshes'][0]['weights']=[0]*4;g.j['meshes'][0]['extras']={'targetNames':list(CHANNELS),'appearanceKind':'illustrative-regional-morphs'}
    # Modest real crown sweep, preserving the CC0 hair-card topology, UVs and original rig.
    hairpr=g.j['meshes'][4]['primitives'][0];hp=world_positions(g,4);hm=mesh_rest_transform(g,4);hc=(hp[:,1]-hp[:,1].min())/(hp[:,1].max()-hp[:,1].min());top=smooth(.52,.97,hc)
    hd=np.column_stack([-.010*top,.014*top,.004*top]);hbase=g.accessor(hairpr['attributes']['POSITION']);hnew=hbase+hd@np.linalg.inv(hm[:3,:3]).T
    hf=g.accessor(hairpr['indices'],False).reshape(-1,3);hn=g.accessor(hairpr['attributes']['NORMAL']);hn+=recompute_normals(hnew,hf)-recompute_normals(hbase,hf);hn/=np.maximum(np.linalg.norm(hn,axis=1)[:,None],1e-12)
    hairpr['attributes']['POSITION']=g.add_accessor(hnew);hairpr['attributes']['NORMAL']=g.add_accessor(hn)
    bake_portable_style(g)
    g.j['asset'].update(generator='Fangkun v72 regional-athlete derivative; NumPy + Pillow',copyright='CC0 MakeHuman/MPFB2 base; Fangkun regional shape targets, hair crown adjustment and style derivatives CC0 1.0')
    g.j.setdefault('extras',{})['fangkunAthlete']={'version':1,'channels':list(CHANNELS),'maxTotalWeight':1,'illustrationOnly':True,'personalLikenessVerified':False}
    compact_views(g)
    dest=ROOT/'public/demo3d/models/athlete.glb';g.save(dest)
    metadata={'version':'fangkun-athlete-v72-1','model':'athlete.glb','sourceModel':'human.glb','sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'modelSHA256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,'license':'CC0-1.0','rig':{'jointCount':53,'boneNamesHierarchyAndBindMatricesUnchanged':True,'uvAndSkinWeightsUnchanged':True,'animationCompatibility':'Existing makeRig/applyPose/motions.js'},'channels':{name:{'range':[0,1],**metrics[name]}for name in CHANNELS},'combination':'Nonnegative weights with total <= 1; normalize if the requested total is greater than 1.','geometry':{'bodyVertices':len(p),'sourceTriangleCount':len(faces),'morphTargetCount':4,'hairCrownMovedVertices':int((top>1e-7).sum()),'hairCrownMaximumDisplacementMetres':float(np.linalg.norm(hd,axis=1).max()),'bodyHeightMetres':float(np.ptp(p[:,1]))},'appearance':{'bodyAlphaMode':'OPAQUE','hairAndEyebrowsAlphaMode':'MASK','hairCrown':'Small actual geometry sweep; original topology and UVs retained','clothing':'Opaque charcoal UV surface treatment, not separate draped clothing meshes'},'limits':['Illustrative shape choices, not a calibrated mapping from kg, body-fat percentage or future training outcomes.','Portrait used as visual direction only; facial identity, exact hair silhouette and personal likeness are not reproduced or verified.','Skeleton lengths and feet are fixed; these controls do not simulate height or pediatric/clinical body changes.','No independent anatomical or clinical validation.']}
    (ROOT/'public/demo3d/models/athlete.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'model':str(dest),'bytes':dest.stat().st_size,'channels':metrics,'hairMaxDisplacement':metadata['geometry']['hairCrownMaximumDisplacementMetres']},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--inspect',action='store_true');args=parser.parse_args()
    if args.inspect:
        g=Glb(ROOT/'public/demo3d/models/human.glb');p=world_positions(g,0);print('body bounds',p.min(0),p.max(0))
        worlds=node_worlds(g.j)
        for i,n in enumerate(g.j['nodes']):
            if n.get('name') in ['pelvis','spine_01','spine_02','spine_03','clavicle_l','upperarm_l','lowerarm_l','thigh_l','calf_l','foot_l','head','neck_01']:print(n['name'],worlds[i][:3,3])
    else:build()
