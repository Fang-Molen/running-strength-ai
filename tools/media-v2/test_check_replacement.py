"""Synthetic structural fixtures only: none is an approved character."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from check_replacement import check


class ReplacementChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.public = self.root / 'public'
        self.public.mkdir()
        self.document = {'asset': {'version': '2.0'}, 'meshes': [{'primitives': []}]}
        self.manifest = {'schemaVersion': 1, 'assetVersion': 'synthetic-v2', 'review': 'APPROVED', 'characters': [], 'exercises': []}
        for cid in ['coach-male', 'coach-female', 'muscle-soft']:
            self.manifest['characters'].append({'characterId': cid, 'assetVersion': 'synthetic-v2', 'rigVersion': 'synthetic-rig', 'review': 'APPROVED', 'source': 'SYNTHETIC TEST', 'license': 'SYNTHETIC TEST', 'glb': self.asset(cid + '.glb', self.glb(self.document))})
        c = self.manifest['characters'][0]
        frames = [{**self.asset('frame-' + str(i) + '.png', b'synthetic-frame-' + bytes([i])), 'characterId': c['characterId'], 'modelSHA256': c['glb']['sha256'], 'clipId': 'synthetic-clip', 'seconds': i} for i in range(4)]
        self.manifest['exercises'] = [{'exerciseId': 'synthetic-action', 'characterId': c['characterId'], 'assetVersion': 'synthetic-v2', 'character': copy.deepcopy(c), 'review': 'APPROVED', 'source': 'SYNTHETIC TEST', 'license': 'SYNTHETIC TEST', 'reviewEvidence': ['synthetic-only'], 'duration': 4, 'clipId': 'synthetic-clip', 'motion': None, 'frames': frames, 'cover': None}]

    def tearDown(self):
        self.temp.cleanup()

    def glb(self, document):
        data = json.dumps(document).encode()
        data += b' ' * (-len(data) % 4)
        return struct.pack('<4sIIII', b'glTF', 2, 20 + len(data), len(data), 0x4E4F534A) + data

    def asset(self, name, data):
        p = self.public / 'media-v2' / 'synthetic-v2' / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return {'path': '/' + p.relative_to(self.public).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def blocked(self):
        result = check(self.manifest, self.public)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertFalse(result['activated'])
        return result

    def test_structural_success_never_approves_or_writes(self):
        before = {str(p): p.read_bytes() for p in self.public.rglob('*') if p.is_file()}
        result = check(self.manifest, self.public)
        self.assertEqual(result['status'], 'STRUCTURE_CHECKED_REVIEW_STILL_REQUIRED')
        self.assertFalse(result['activated'])
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.public.rglob('*') if p.is_file()})

    def test_pending_release_cannot_activate(self):
        self.manifest['review'] = 'PENDING'; self.blocked()

    def test_hash_mismatch(self):
        self.manifest['characters'][0]['glb']['sha256'] = '0' * 64; self.blocked()

    def test_missing_file(self):
        p = self.public / self.manifest['characters'][1]['glb']['path'].lstrip('/')
        p.unlink(); self.blocked()

    def test_html_disguised_as_model(self):
        self.manifest['characters'][1]['glb'] = self.asset('bad.glb', b'<html>404</html>'); self.blocked()

    def test_external_glb_dependencies(self):
        self.document['images'] = [{'uri': 'https://example.invalid/model.png'}]
        self.manifest['characters'][1]['glb'] = self.asset('remote.glb', self.glb(self.document)); self.blocked()

    def test_frame_from_different_model(self):
        self.manifest['exercises'][0]['frames'][0]['modelSHA256'] = 'b' * 64; self.blocked()

    def test_wrong_phase_order(self):
        self.manifest['exercises'][0]['frames'][1]['seconds'] = 0; self.blocked()

    def test_duplicate_binding(self):
        self.manifest['exercises'].append(copy.deepcopy(self.manifest['exercises'][0])); self.blocked()

    def test_path_escape(self):
        self.manifest['characters'][1]['glb']['path'] = '/media-v2/../outside.glb'; self.blocked()

    def test_symlink_escape(self):
        data = self.glb(self.document)
        (self.root / 'outside.glb').write_bytes(data)
        link = self.public / 'media-v2' / 'outside.glb'
        link.symlink_to(self.root / 'outside.glb')
        self.manifest['characters'][1]['glb'] = {'path': '/media-v2/outside.glb', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}; self.blocked()

    def test_no_license(self):
        self.manifest['characters'][1]['license'] = ''; self.blocked()


if __name__ == '__main__':
    unittest.main(verbosity=2)
