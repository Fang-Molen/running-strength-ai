"""Render exported exact anatomy geometry offline; this is NOT an app screenshot."""
import json, pathlib, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '../v70-qa').resolve()
meta = json.loads((root/'geometry.json').read_text())
positions = np.fromfile(root/'positions.bin', dtype='<f4').reshape(-1,3)
normals = np.fromfile(root/'normals.bin', dtype='<f4').reshape(-1,3)
colors = np.fromfile(root/'colors.bin', dtype='<f4').reshape(-1,3)
indices = np.fromfile(root/'indices.bin', dtype='<u4')
binary = root/'raster-qa'
subprocess.run(['c++','-O2','-std=c++17',str(pathlib.Path(__file__).with_name('raster-qa.cpp')),'-o',str(binary)],check=True)
w,h = 480,620
frames=[]
for view in meta['views']:
    a=np.deg2rad(view['angle']);target=np.array(view['center']);d=view['distance']
    eye=target+np.array([np.sin(a)*d,d*.1,np.cos(a)*d]);forward=(target-eye);forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,forward)
    p=positions-eye;z=p@forward;tan=np.tan(np.deg2rad(15));xy=np.column_stack([(p@right)/(z*tan*w/h)*w/2+w/2,h/2-(p@up)/(z*tan)*h/2])
    # Approximate studio lighting. Geometry, grounding and camera fit are exact;
    # the CPU lighting is deliberately not presented as the app's WebGL output.
    light=np.array([.4,.7,.7]);light/=np.linalg.norm(light)
    shade=.5+.48*np.maximum(0,normals@light)+.16*np.maximum(0,normals@-light)
    rgb=np.clip(colors*shade[:,None]*1.5,0,1);rgb=np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
    vertices=np.column_stack([xy,z,rgb]).astype('<f4')[indices]
    path=root/(view['name']+'.tri');vertices.tofile(path)
    ppm=root/(view['name']+'.ppm');subprocess.run([str(binary),str(w),str(h),str(path),str(ppm)],check=True)
    image=Image.open(ppm).convert('RGB');image.save(root/(view['name']+'.png'));frames.append(image)
canvas=Image.new('RGB',(w*3, h+105),'#111418');draw=ImageDraw.Draw(canvas)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
draw.text((20,12),'FANGKUN | independent anatomical muscle meshes',font=font,fill='#eaeef4')
for i,(image,title) in enumerate(zip(frames,['FRONT','BACK - hamstrings highlighted','FOOT - actual anatomical geometry'])):
    canvas.paste(image,(i*w,43));draw.text((i*w+14,h+53),title,font=font,fill='#ffa27d')
draw.text((20,h+80),'Offline geometry render. Not an app screenshot or iPhone/WebGL acceptance.',font=font,fill='#9da5b2')
canvas.save(root/'fangkun-v70-anatomy-model-preview.png')
print(str(root/'fangkun-v70-anatomy-model-preview.png'))
