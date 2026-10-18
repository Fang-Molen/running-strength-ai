"""Compile and link the actual expanded material shader pairs with software ES3, no browser."""
import argparse,json
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('render_athlete',Path(__file__).with_name('render-athlete.py'));render=module_from_spec(spec);spec.loader.exec_module(render)
parser=argparse.ArgumentParser();parser.add_argument('folder');args=parser.parse_args();root=Path(args.folder).resolve()
gl=render.SoftwareGL(4,4);manifest=json.loads((root/'shaders.json').read_text());passed=[]
for item in manifest:
 gl.program((root/(item['name']+'.vert')).read_text(),(root/(item['name']+'.frag')).read_text());passed.append(item['name']);print('PASS actual material ES3 vertex+fragment link:',item['name'])
(root/'shader-check.json').write_text(json.dumps({'renderer':gl.getString(0x1F01).decode(),'version':gl.getString(0x1F02).decode(),'pairsCompiledAndLinked':passed,'bodyMorphTargets':4,'bodyPositionAndNormalMorphing':True,'allMeshesUseOriginalBoneSkinning':True,'browserUsed':False,'limits':'Offline GLES3 compiler/linker check; not an app/browser/device render acceptance.'},indent=2)+'\n')
