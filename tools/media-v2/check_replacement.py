"""Read-only incoming-asset check. Never installs, approves or activates a release.

Uses the existing GLB inventory tool; does NOT replace Khronos or visual review.
Paths in a manifest are /media-v2/... relative to the supplied public directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
from probe_glb import probe


def check(manifest, public):
    public = Path(public).resolve()
    errors, files, seen = [], [], {}

    def issue(where, reason):
        errors.append({'at': where, 'reason': reason})

    def asset(value, where, model=False):
        if not isinstance(value, dict):
            issue(where, 'asset missing'); return
        path = value.get('path', '')
        if not isinstance(path, str) or not re.fullmatch(r'/media-v2/[A-Za-z0-9_./-]+', path) or '..' in path.split('/'):
            issue(where, 'not a safe versioned local media path'); return
        previous = seen.get(path)
        identity = (value.get('sha256'), value.get('bytes'))
        if previous is not None and previous != identity:
            issue(where, 'same path has conflicting hash/size'); return
        seen[path] = identity
        target = (public / path.lstrip('/')).resolve()
        if not target.is_relative_to(public):
            issue(where, 'symlink escapes public directory'); return
        if not target.is_file():
            issue(where, 'file missing: ' + path); return
        data = target.read_bytes()
        if value.get('bytes') != len(data) or value.get('sha256') != hashlib.sha256(data).hexdigest():
            issue(where, 'byte count or SHA-256 mismatch'); return
        if data.lstrip().lower().startswith((b'<!doctype html', b'<html')):
            issue(where, 'HTML is not a media asset'); return
        if model:
            try:
                inventory = probe(target)
                if inventory['meshes'] < 1:
                    raise ValueError('model has no meshes')
                offset = 12
                while offset < len(data):
                    size, kind = struct.unpack_from('<II', data, offset)
                    if kind == 0x4E4F534A:
                        document = json.loads(data[offset + 8:offset + 8 + size])
                        for resource in document.get('buffers', []) + document.get('images', []):
                            if resource.get('uri') and not resource['uri'].startswith('data:'):
                                raise ValueError('external buffer/texture dependency; embed or separately review before import')
                    offset += 8 + size
            except (ValueError, KeyError, TypeError) as error:
                issue(where, 'GLB inventory failed: ' + str(error)); return
        files.append(path)

    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1:
        return {'status': 'BLOCKED', 'errors': [{'at': 'manifest', 'reason': 'expected schemaVersion 1'}], 'checkedFiles': []}
    version = manifest.get('assetVersion')
    if not isinstance(version, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', version):
        issue('assetVersion', 'version missing/invalid')
    if manifest.get('review') != 'APPROVED':
        issue('review', 'release remains unapproved')
    characters = {}
    for i, character in enumerate(manifest.get('characters', [])):
        where = 'characters[' + str(i) + ']'
        if not isinstance(character, dict):
            issue(where, 'invalid character'); continue
        cid = character.get('characterId')
        if not cid or cid in characters:
            issue(where, 'missing/duplicate character ID')
        characters[cid] = character
        if character.get('assetVersion') != version or not character.get('rigVersion'):
            issue(where, 'character version/rig missing or mismatched')
        if character.get('review') != 'APPROVED' or not character.get('source') or not character.get('license'):
            issue(where, 'review or provenance missing')
        asset(character.get('glb'), where + '.glb', True)
    for cid in ['coach-male', 'coach-female', 'muscle-soft']:
        if cid not in characters:
            issue('characters', 'missing required character: ' + cid)
    bindings = set()
    entries = manifest.get('exercises', [])
    if not entries:
        issue('exercises', 'no reviewed action bindings')
    for i, entry in enumerate(entries):
        where = 'exercises[' + str(i) + ']'
        if not isinstance(entry, dict):
            issue(where, 'invalid action entry'); continue
        key = (entry.get('exerciseId'), entry.get('characterId'), entry.get('assetVersion'))
        if not all(isinstance(x, str) and x for x in key) or key in bindings:
            issue(where, 'missing/duplicate action identity')
        bindings.add(key)
        character = characters.get(entry.get('characterId'))
        if not character or entry.get('character') != character or key[2] != version:
            issue(where, 'character snapshot/version mismatch')
        if entry.get('review') != 'APPROVED' or not entry.get('reviewEvidence') or not entry.get('license') or not entry.get('source'):
            issue(where, 'action review/provenance missing')
        duration = entry.get('duration')
        if not isinstance(duration, (int, float)) or not 0 < duration < float('inf') or not entry.get('clipId'):
            issue(where, 'motion duration/ID missing'); duration = 0
        motion = entry.get('motion')
        if motion:
            if motion.get('review') != 'APPROVED' or motion.get('key') != entry.get('clipId') or motion.get('rigVersion') != (character or {}).get('rigVersion'):
                issue(where, 'motion review/key/rig mismatch')
            asset(motion.get('resource'), where + '.motion')
        frames = entry.get('frames', [])
        if not motion and not frames:
            issue(where, 'no playable motion or keyframes')
        if frames and (not 4 <= len(frames) <= 6):
            issue(where, 'expected 4–6 keyframes')
        last = -1
        for j, frame in enumerate(frames + ([entry['cover']] if entry.get('cover') else [])):
            fw = where + '.frames[' + str(j) + ']'
            if not isinstance(frame, dict):
                issue(fw, 'missing frame'); continue
            time = frame.get('seconds')
            if frame.get('characterId') != key[1] or frame.get('clipId') != entry.get('clipId') or frame.get('modelSHA256') != ((character or {}).get('glb') or {}).get('sha256'):
                issue(fw, 'frame is from another character/model/action')
            if not isinstance(time, (int, float)) or not 0 <= time <= duration or (j < len(frames) and time <= last):
                issue(fw, 'invalid/out-of-order frame phase')
            if isinstance(time, (int, float)):
                last = time
            asset(frame, fw)
    return {'status': 'BLOCKED' if errors else 'STRUCTURE_CHECKED_REVIEW_STILL_REQUIRED',
            'errors': errors, 'checkedFiles': sorted(set(files)), 'actionBindings': len(bindings),
            'mutations': 0, 'activated': False,
            'limits': ['Not a Khronos Validator result', 'No visual/action/iPhone acceptance', 'Does not authorize runtime replacement']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('public_directory', type=Path)
    args = parser.parse_args()
    try:
        result = check(json.loads(args.manifest.read_text()), args.public_directory)
    except (ValueError, TypeError, KeyError, OSError, AttributeError) as error:
        result = {'status': 'BLOCKED', 'errors': [{'at': 'manifest', 'reason': str(error)}], 'mutations': 0, 'activated': False}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(1 if result['status'] == 'BLOCKED' else 0)
