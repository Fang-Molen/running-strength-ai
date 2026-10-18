import json
import pathlib
import struct
import tempfile
import unittest
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from audit_glb import inspect, read_glb


def make_glb(data, out):
    b = json.dumps(data).encode('utf8')
    b += b' ' * ((-len(b)) % 4)
    pathlib.Path(out).write_bytes(struct.pack('<4sII',b'glTF',2,len(b)+20) + struct.pack('<I4s',len(b),b'JSON') + b)

class AuditTests(unittest.TestCase):
    def test_parse_invalid(self):
        with tempfile.TemporaryDirectory() as td:
            p=pathlib.Path(td)/'bad.glb';p.write_bytes(b'<!doctype html>bad')
            with self.assertRaises(ValueError): read_glb(p)

    def test_reject_empty_and_no_material(self):
        with tempfile.TemporaryDirectory() as td:
            p=pathlib.Path(td)/'empty.glb'
            make_glb({'asset':{'version':'2.0'},'meshes':[]},p)
            self.assertIn('NO_USABLE_TRIANGLE_MESH',inspect(p)['fatal'])
            self.assertFalse(inspect(p)['approved_for_product'])

    def test_valid_geometry_does_not_equal_approved(self):
        with tempfile.TemporaryDirectory() as td:
            p=pathlib.Path(td)/'good.glb'
            make_glb({'asset':{'version':'2.0'},'accessors':[{'count':3000}], 'materials':[{}],
            'meshes':[{'primitives':[{'attributes':{'POSITION':0},'mode':4}]}]},p)
            r=inspect(p)
            self.assertEqual(r['technical_status'],'UNRIGGED_CANDIDATE_VISUAL_REVIEW_REQUIRED')
            self.assertFalse(r['approved_for_product'])

    def test_external_resource_blocks(self):
        with tempfile.TemporaryDirectory() as td:
            p=pathlib.Path(td)/'external.glb'
            make_glb({'asset':{'version':'2.0'},'buffers':[{'uri':'https://example.com/asset.bin'}],
                'accessors':[{'count':3000}],'materials':[{}],'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}]},p)
            self.assertIn('EXTERNAL_URI_DEPENDENCIES',inspect(p)['fatal'])

if __name__ == '__main__':unittest.main()
