#!/usr/bin/env python3
"""Blender 4.x starter: manually reviewed joint landmarks -> deform skeleton + auto weights.
Run: blender -b --python blender_bind_landmarks.py -- --input approved.glb --landmarks reviewed.json --output rigged.glb --blend master.blend --report report.json
Not a substitute for retopology / paint weights / exercise motion expertise.
"""
import argparse
import json
import pathlib
import sys
import traceback

try:
    import bpy
except ImportError:
    sys.stderr.write('Needs Blender Python (bpy); run via `blender -b --python ...`\n')
    raise
from mathutils import Vector


def get_args():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--landmarks',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--blend',required=True)
    ap.add_argument('--report',required=True)
    ap.add_argument('--diagnostic-only',action='store_true',help='Bypass human-reviewed flag only for clearly labeled QA prototype output; NO production acceptance')
    return ap.parse_args(argv)

# deliberately basic 23 bones, matched to supported subset of old schema
BONES=[
 ('Root','root','pelvis',None,False),
 ('pelvis','pelvis','spine_01','Root',True),
 ('spine_01','spine_01','spine_02','pelvis',True),
 ('spine_02','spine_02','spine_03','spine_01',True),
 ('spine_03','spine_03','neck','spine_02',True),
 ('neck_01','neck','head','spine_03',True),
 ('head','head','head_top','neck_01',True),
]
for side in ('l','r'):
    BONES.extend([
     (f'clavicle_{side}','spine_03',f'shoulder_{side}','spine_03',True),
     (f'upperarm_{side}',f'shoulder_{side}',f'elbow_{side}',f'clavicle_{side}',True),
     (f'lowerarm_{side}',f'elbow_{side}',f'wrist_{side}',f'upperarm_{side}',True),
     (f'hand_{side}',f'wrist_{side}',f'hand_tip_{side}',f'lowerarm_{side}',True),
     (f'thigh_{side}',f'hip_{side}',f'knee_{side}','pelvis',True),
     (f'calf_{side}',f'knee_{side}',f'ankle_{side}',f'thigh_{side}',True),
     (f'foot_{side}',f'ankle_{side}',f'toe_{side}',f'calf_{side}',True),
     (f'ball_{side}',f'toe_{side}',f'toe_tip_{side}',f'foot_{side}',True),
    ])


def bind(args):
    for p in (args.input,args.landmarks):
        if not pathlib.Path(p).is_file():raise ValueError(f'Missing {p}')
    out=pathlib.Path(args.output)
    if args.diagnostic_only and not (out.name.startswith('QA_ONLY_') and out.suffix.lower()=='.glb'):
        raise ValueError('Diagnostic outputs MUST be named QA_ONLY_*.glb')
    if out.resolve()==pathlib.Path(args.input).resolve():raise ValueError('Never overwrite original GLB')
    data=json.loads(pathlib.Path(args.landmarks).read_text(encoding='utf-8'))
    reviewed = data.get('approved') is True and data.get('status') == 'HUMAN_REVIEWED' and bool(data.get('reviewed_by')) and bool(data.get('evidence_render_paths'))
    if not reviewed and not args.diagnostic_only:
        raise ValueError('Landmarks NOT manually reviewed; refuse production binding. Use diagnostic-only only for QA labeled output.')
    lm=data.get('landmarks',{})
    required={v for _,a,b,_,_ in BONES for v in [a,b]}
    if any(k not in lm or not isinstance(lm[k],list) or len(lm[k])!=3 or any(not isinstance(n,(int,float)) for n in lm[k]) for k in required):
        raise ValueError(f'Joint coordinates missing or invalid; need xyz numeric meters for: {sorted(required)}')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(pathlib.Path(args.input).resolve()))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if not meshes:raise ValueError('No meshes; cannot bind')
    if not any(m.material_slots for m in meshes):raise ValueError('No materials: reject unqualified mesh before binding')
    if any(o.type=='ARMATURE' for o in bpy.context.scene.objects):raise ValueError('Existing armature: do not add another; use a retarget workflow')
    bpy.ops.object.select_all(action='DESELECT')
    arm_data=bpy.data.armatures.new('FK_Humanoid_23')
    arm=bpy.data.objects.new('FK_Humanoid_23',arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active=arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    created={}
    for name,ha,ta,parent,deform in BONES:
        start=Vector(lm[ha]); end=Vector(lm[ta]);
        if (end-start).length <= 0.01:raise ValueError('Too-short bone '+name)
        b=arm_data.edit_bones.new(name)
        b.head=start
        b.tail=end
        b.use_deform=deform
        if parent is not None:b.parent=created[parent]
        created[name]=b
    bpy.ops.object.mode_set(mode='OBJECT')
    # Parenting selected mesh objects to armature with heat weights.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active=arm
    try:bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    except RuntimeError as e:raise ValueError('Blender auto weights failed; fix topology and retry: '+str(e))
    failures=[]; mesh_report=[]
    for ob in meshes:
        grp={g.index:g.name for g in ob.vertex_groups}
        deforms=set(n for n,_,_,_,d in BONES if d)
        missing=0; max_influences=0; off_norm=0
        for vert in ob.data.vertices:
            influences=[(grp.get(g.group),g.weight) for g in vert.groups if grp.get(g.group) in deforms and g.weight>0.000001]
            if not influences: missing+=1
            if len(influences)>max_influences:max_influences=len(influences)
            if influences and abs(sum(w for _,w in influences)-1.0)>0.01:off_norm+=1
        mesh_report.append({'name':ob.name,'vertex_count':len(ob.data.vertices),'unweighted_count':missing,'off_normalized_count':off_norm,'max_deform_bone_influences':max_influences})
        if missing or off_norm or max_influences>4:failures.append(f'{ob.name}: unweighted={missing}, off_normalized={off_norm}, max_influences={max_influences}')
        if ob.find_armature()!=arm:failures.append(ob.name+' armature modifier/parent missing')
    if failures:raise ValueError('Skin requires manual repair: '+str(failures))
    out.parent.mkdir(parents=True,exist_ok=True)
    blend=pathlib.Path(args.blend);blend.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend.resolve()))
    # Export only mesh+deform rig, no lights/scene items, no placeholder animations.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes + [arm]:obj.select_set(True)
    bpy.context.view_layer.objects.active=arm
    bpy.ops.export_scene.gltf(filepath=str(out.resolve()),export_format='GLB',use_selection=True,export_skins=True,export_animations=False)
    return {'status':'QA_RIGGED_NOT_VISUALLY_APPROVED' if args.diagnostic_only else 'AUTO_BIND_COMPLETE_REQUIRES_POSE_QA',
            'input':str(args.input),'blend':str(blend),'glb':str(out),'bones':len(BONES),'meshes':mesh_report,
            'manual_review_required':['shoulders','elbows','hips','knees','ankles','hair','clothes','face','props','motion compatibility'],
            'release_approved':False}


def main():
    args=get_args()
    try:
        r=bind(args)
    except Exception as e:
        traceback.print_exc()
        r={'status':'BLOCKED','exception':f'{type(e).__name__}: {e}','release_approved':False}
    path=pathlib.Path(args.report);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('FANGKUN_BIND_REPORT='+json.dumps(r,ensure_ascii=False))
    return 0 if r['status']!='BLOCKED' else 3

if __name__ == '__main__':sys.exit(main())
