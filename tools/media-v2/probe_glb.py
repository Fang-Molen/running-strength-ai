"""Read-only GLB v2 structural inventory; not visual/biomechanical validation."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

def probe(path):
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise ValueError('GLB too short')
    magic, version, total = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or total != len(data):
        raise ValueError('Invalid GLB header or byte length')
    pos, document = 12, None
    while pos < total:
        if pos + 8 > total:
            raise ValueError('Truncated chunk header')
        size, kind = struct.unpack_from('<II', data, pos)
        pos += 8
        if size % 4 or pos + size > total:
            raise ValueError('Invalid chunk extent/alignment')
        if kind == 0x4E4F534A:
            if document is not None:
                raise ValueError('Duplicate JSON chunk')
            document = json.loads(data[pos:pos + size].decode('utf-8'))
        pos += size
    if document is None or document.get('asset', {}).get('version') != '2.0':
        raise ValueError('Missing glTF 2.0 JSON')
    return {'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'meshes': len(document.get('meshes', [])),
            'skins': [{'name': s.get('name'), 'joints': len(s.get('joints', []))} for s in document.get('skins', [])],
            'animations': [{'name': a.get('name'), 'channels': len(a.get('channels', []))} for a in document.get('animations', [])],
            'morphTargets': [{'mesh': m.get('name'), 'counts': [len(p.get('targets', [])) for p in m.get('primitives', [])]} for m in document.get('meshes', [])],
            'extensionsRequired': document.get('extensionsRequired', []),
            'scope': 'structural inventory only; run Khronos validation and visual/motion QA separately'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('files', nargs='+')
    args = parser.parse_args()
    rows, failed = [], False
    for path in args.files:
        try:
            rows.append(probe(path))
        except (OSError, ValueError, struct.error) as error:
            failed = True
            rows.append({'path': path, 'error': str(error)})
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    raise SystemExit(1 if failed else 0)
