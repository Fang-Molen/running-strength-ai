#!/usr/bin/env python3
"""Read-only offline GLB audit; safe with untrusted mesh files. No Blender needed."""
import argparse
import hashlib
import json
import pathlib
import struct
import sys


def read_glb(path):
    raw = pathlib.Path(path).read_bytes()
    if len(raw) < 20 or raw[:4] != b'glTF':
        raise ValueError('Not GLB; wrong magic or truncated file')
    magic, version, declared = struct.unpack_from('<4sII', raw, 0)
    if version != 2 or declared != len(raw):
        raise ValueError('Invalid GLB version or length')
    off, content = 12, None
    while off < len(raw):
        if off + 8 > len(raw):
            raise ValueError('Truncated chunk header')
        n, chunk_type = struct.unpack_from('<I4s', raw, off)
        off += 8
        if off + n > len(raw):
            raise ValueError('Truncated GLB chunk')
        if chunk_type == b'JSON' and content is None:
            content = json.loads(raw[off:off+n].decode('utf8').strip('\x00 \t\r\n'))
        off += n
    if content is None:
        raise ValueError('GLB missing JSON chunk')
    return content, hashlib.sha256(raw).hexdigest(), len(raw)


def inspect(path):
    model, digest, bytes_count = read_glb(path)
    accessors = model.get('accessors', [])
    primitives = [p for m in model.get('meshes', []) for p in m.get('primitives', [])]
    tris = 0
    has_uv = False
    has_skin_attributes = False
    morph_count = 0
    for p in primitives:
        if p.get('mode', 4) == 4:
            i = p.get('indices')
            count = accessors[i].get('count',0) if isinstance(i,int) and i < len(accessors) else accessors[p.get('attributes', {}).get('POSITION')].get('count',0) if isinstance(p.get('attributes', {}).get('POSITION'),int) and p['attributes']['POSITION'] < len(accessors) else 0
            tris += count // 3
        has_uv |= 'TEXCOORD_0' in p.get('attributes', {})
        has_skin_attributes |= ('JOINTS_0' in p.get('attributes', {}) and 'WEIGHTS_0' in p.get('attributes', {}))
        morph_count += len(p.get('targets', []))
    skins = model.get('skins', [])
    root_uris=[]
    for key in ['buffers','images']:
        for ob in model.get(key, []):
            uri=ob.get('uri','')
            if uri and not uri.startswith('data:'): root_uris.append(uri)
    fatal = []
    warnings = []
    if not primitives or tris==0: fatal.append('NO_USABLE_TRIANGLE_MESH')
    if not model.get('materials'): fatal.append('NO_MATERIALS_OR_PBR_LOOK')
    if root_uris: fatal.append('EXTERNAL_URI_DEPENDENCIES')
    if not has_uv: warnings.append('NO_UV0_CHECK_TEXTURE_WORKFLOW')
    if not model.get('textures'): warnings.append('NO_TEXTURES_CHECK_PBR_FIDELITY')
    if tris > 150000: warnings.append('HEAVY_MOBILE_MESH_PROFILE_DEVICE')
    if skins and not has_skin_attributes: fatal.append('SKIN_DECLARED_BUT_NO_VERTEX_WEIGHTS')
    if has_skin_attributes and not skins: fatal.append('WEIGHTS_WITHOUT_SKIN')
    status = 'BLOCKED_MESH' if fatal else ('EXISTING_RIG_REVIEW_REQUIRED' if skins else 'UNRIGGED_CANDIDATE_VISUAL_REVIEW_REQUIRED')
    return {'file':str(path),'sha256':digest,'bytes':bytes_count,'meshes':len(model.get('meshes',[])), 'primitives':len(primitives),'triangles':tris,
            'materials':len(model.get('materials',[])),'textures':len(model.get('textures',[])),'has_uv':has_uv,'skins':len(skins),
            'joint_counts':[len(s.get('joints',[])) for s in skins], 'weighted_vertices_attributes':has_skin_attributes,
            'animations':len(model.get('animations',[])),'morph_count':morph_count,'external_uris':root_uris,
            'fatal':fatal,'warnings':warnings,'technical_status':status,'visual_review':'NOT_RUN','license_review':'NOT_RUN',
            'approved_for_product':False,'note':'Technical preflight only; never approves appearance, rigging weights, motion or legal rights.'}


def main():
    a=argparse.ArgumentParser()
    a.add_argument('--input',required=True)
    a.add_argument('--report')
    args=a.parse_args()
    try: result=inspect(args.input)
    except Exception as e:
        result={'file':args.input,'technical_status':'BLOCKED_PARSE','fatal':[f'{type(e).__name__}: {e}'],'approved_for_product':False}
    encoded=json.dumps(result,ensure_ascii=False,indent=2)
    print(encoded)
    if args.report:
        p=pathlib.Path(args.report);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(encoded+'\n',encoding='utf-8')
    return 0 if result['technical_status'] not in ('BLOCKED_MESH','BLOCKED_PARSE') else 2

if __name__=='__main__':sys.exit(main())
