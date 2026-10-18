"""Render the real athlete GLB via software OpenGL ES/EGL, without a browser.

Geometry comes from export-geometry.mjs after the actual Three.js skin/morph/pose code.
The inspection lighting is approximate; these are not app screenshots.
"""
from pathlib import Path
import argparse, ctypes as C, ctypes.util, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('athlete_builder',Path(__file__).with_name('build-athlete.py'));builder=module_from_spec(spec);spec.loader.exec_module(builder)

class SoftwareGL:
 def __init__(self,width,height):
  self.width=width;self.height=height;self.egl=C.CDLL(C.util.find_library('EGL'));e=self.egl
  e.eglGetProcAddress.argtypes=[C.c_char_p];e.eglGetProcAddress.restype=C.c_void_p
  platform=C.CFUNCTYPE(C.c_void_p,C.c_uint,C.c_void_p,C.POINTER(C.c_int))(e.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
  self.display=platform(0x31DD,None,None)
  e.eglInitialize.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)];e.eglInitialize.restype=C.c_uint
  major=C.c_int();minor=C.c_int();assert e.eglInitialize(self.display,C.byref(major),C.byref(minor)),'EGL initialize'
  e.eglBindAPI.argtypes=[C.c_uint];assert e.eglBindAPI(0x30A0)
  attrs=(C.c_int*15)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,0x3038)
  e.eglChooseConfig.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_void_p),C.c_int,C.POINTER(C.c_int)];e.eglChooseConfig.restype=C.c_uint
  config=C.c_void_p();count=C.c_int();assert e.eglChooseConfig(self.display,attrs,C.byref(config),1,C.byref(count))and count.value
  e.eglCreateContext.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];e.eglCreateContext.restype=C.c_void_p
  ctx=e.eglCreateContext(self.display,config,None,(C.c_int*3)(0x3098,3,0x3038));assert ctx
  e.eglCreatePbufferSurface.argtypes=[C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];e.eglCreatePbufferSurface.restype=C.c_void_p
  surface=e.eglCreatePbufferSurface(self.display,config,(C.c_int*5)(0x3057,width,0x3056,height,0x3038));assert surface
  e.eglMakeCurrent.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p];assert e.eglMakeCurrent(self.display,surface,surface,ctx)
  self.getString=self.fn('glGetString',C.c_char_p,C.c_uint)
  print(self.getString(0x1F02).decode(),self.getString(0x1F01).decode())
 def fn(self,name,restype,*argtypes):
  address=self.egl.eglGetProcAddress(name.encode());assert address,name
  return C.CFUNCTYPE(restype,*argtypes)(address)
 def compile(self,source,kind):
  shader=self.fn('glCreateShader',C.c_uint,C.c_uint)(kind);b=C.c_char_p(source.encode())
  self.fn('glShaderSource',None,C.c_uint,C.c_int,C.POINTER(C.c_char_p),C.POINTER(C.c_int))(shader,1,C.byref(b),None)
  self.fn('glCompileShader',None,C.c_uint)(shader);ok=C.c_int();self.fn('glGetShaderiv',None,C.c_uint,C.c_uint,C.POINTER(C.c_int))(shader,0x8B81,C.byref(ok))
  if not ok.value:
   log=C.create_string_buffer(65536);self.fn('glGetShaderInfoLog',None,C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_char_p)(shader,len(log),None,log);raise RuntimeError(log.value.decode())
  return shader
 def program(self,vert,frag):
  program=self.fn('glCreateProgram',C.c_uint)();attach=self.fn('glAttachShader',None,C.c_uint,C.c_uint)
  attach(program,self.compile(vert,0x8B31));attach(program,self.compile(frag,0x8B30));self.fn('glLinkProgram',None,C.c_uint)(program)
  ok=C.c_int();self.fn('glGetProgramiv',None,C.c_uint,C.c_uint,C.POINTER(C.c_int))(program,0x8B82,C.byref(ok))
  if not ok.value:
   log=C.create_string_buffer(65536);self.fn('glGetProgramInfoLog',None,C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_char_p)(program,len(log),None,log);raise RuntimeError(log.value.decode())
  return program

VERT='''#version 300 es
precision highp float;
layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in vec2 uv;
uniform mat4 clipMatrix;out vec3 n;out vec3 p;out vec2 tex;
void main(){p=position;n=normal;tex=uv;gl_Position=clipMatrix*vec4(position,1.0);}
'''
FRAG='''#version 300 es
precision highp float;
in vec3 n;in vec3 p;in vec2 tex;out vec4 outColor;
uniform sampler2D diffuseMap;uniform sampler2D roughnessMap;
uniform float alphaCutoff;uniform float roughness;uniform int hasRoughnessMap;uniform vec3 eye;
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
 vec4 t=texture(diffuseMap,tex);if(t.a<alphaCutoff)discard;vec3 color=toLinear(t.rgb);
 vec3 N=normalize(n);if(!gl_FrontFacing)N=-N;
 vec3 L=normalize(vec3(0.5,0.8,0.9)),R=normalize(vec3(-0.7,0.5,-0.8)),V=normalize(eye-p);
 float r=hasRoughnessMap==1?texture(roughnessMap,tex).g*roughness:roughness;
 float diffuse=0.56+1.15*max(dot(N,L),0.0)+0.52*max(dot(N,R),0.0);
 float spec=(1.0-r)*0.08*pow(max(dot(N,normalize(L+V)),0.0),mix(100.0,8.0,r));
 outColor=vec4(toSRGB(aces(color*diffuse+spec)),1.0);
}
'''

def camera(angle,width,height,head=False,preparation=False):
 a=np.deg2rad(angle);center=np.array([0,1.865 if head else 1.2 if preparation else 1.015,.035 if head else 0]);eye=center+np.array([np.sin(a)*4,.01,np.cos(a)*4])
 f=(center-eye);f/=np.linalg.norm(f);right=np.cross(f,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,f)
 view=np.eye(4);view[0,:3]=right;view[1,:3]=up;view[2,:3]=-f;view[:3,3]=-view[:3,:3]@eye
 span=.47 if head else 2.8 if preparation else 2.25;hh=span/2;hw=hh*width/height;near=.1;far=10
 projection=np.array([[1/hw,0,0,0],[0,1/hh,0,0],[0,0,-2/(far-near),-(far+near)/(far-near)],[0,0,0,1]])
 return projection@view,eye

def render(root):
 width,height=560,920;gl=SoftwareGL(width,height);program=gl.program(VERT,FRAG)
 gl.fn('glUseProgram',None,C.c_uint)(program);location=gl.fn('glGetUniformLocation',C.c_int,C.c_uint,C.c_char_p)
 uniform1i=gl.fn('glUniform1i',None,C.c_int,C.c_int);uniform1f=gl.fn('glUniform1f',None,C.c_int,C.c_float)
 uniform3f=gl.fn('glUniform3f',None,C.c_int,C.c_float,C.c_float,C.c_float);matrix4=gl.fn('glUniformMatrix4fv',None,C.c_int,C.c_int,C.c_ubyte,C.POINTER(C.c_float))
 bindBuffer=gl.fn('glBindBuffer',None,C.c_uint,C.c_uint);bufferData=gl.fn('glBufferData',None,C.c_uint,C.c_ssize_t,C.c_void_p,C.c_uint)
 pointer=gl.fn('glVertexAttribPointer',None,C.c_uint,C.c_int,C.c_uint,C.c_ubyte,C.c_int,C.c_void_p)
 drawElements=gl.fn('glDrawElements',None,C.c_uint,C.c_int,C.c_uint,C.c_void_p)
 vao=C.c_uint();gl.fn('glGenVertexArrays',None,C.c_int,C.POINTER(C.c_uint))(1,C.byref(vao));gl.fn('glBindVertexArray',None,C.c_uint)(vao)
 buffers=(C.c_uint*2)();gl.fn('glGenBuffers',None,C.c_int,C.POINTER(C.c_uint))(2,buffers)
 for i in range(3):gl.fn('glEnableVertexAttribArray',None,C.c_uint)(i)
 gl.fn('glEnable',None,C.c_uint)(0x0B71);gl.fn('glDepthFunc',None,C.c_uint)(0x0203)
 gl.fn('glViewport',None,C.c_int,C.c_int,C.c_int,C.c_int)(0,0,width,height)
 gl.fn('glClearColor',None,C.c_float,C.c_float,C.c_float,C.c_float)(17/255,20/255,24/255,1)
 model=builder.Glb(builder.ROOT/'public/demo3d/models/athlete.glb');textures={}
 bindTexture=gl.fn('glBindTexture',None,C.c_uint,C.c_uint);activeTexture=gl.fn('glActiveTexture',None,C.c_uint)
 for i in range(len(model.j['images'])):
  image=np.array(model.image(i));texture=C.c_uint();gl.fn('glGenTextures',None,C.c_int,C.POINTER(C.c_uint))(1,C.byref(texture));bindTexture(0x0DE1,texture)
  gl.fn('glTexImage2D',None,C.c_uint,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p)(0x0DE1,0,0x8058,image.shape[1],image.shape[0],0,0x1908,0x1401,C.c_void_p(image.ctypes.data))
  param=gl.fn('glTexParameteri',None,C.c_uint,C.c_uint,C.c_int)
  for k,v in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,k,v)
  textures[i]=texture.value
 uniform1i(location(program,b'diffuseMap'),0);uniform1i(location(program,b'roughnessMap'),1)
 data=json.loads((root/'geometry.json').read_text());frames={}
 views=[('front',0),('side',90),('back',180)]
 for case in data['cases']:
  for view,angle in views:
   if view=='back' and case['name']!='neutral':continue
   clip,eye=camera(angle,width,height,preparation=data.get('kind')=='preparation');mat=np.ascontiguousarray(clip.T,dtype=np.float32)
   matrix4(location(program,b'clipMatrix'),1,False,mat.ctypes.data_as(C.POINTER(C.c_float)));uniform3f(location(program,b'eye'),*eye)
   gl.fn('glClear',None,C.c_uint)(0x4000|0x0100)
   for mesh in case['meshes']:
    vertices=np.fromfile(root/(mesh['name']+'.vertices'),dtype='<f4');indices=np.fromfile(root/(mesh['name']+'.indices'),dtype='<u4')
    bindBuffer(0x8892,buffers[0]);bufferData(0x8892,vertices.nbytes,C.c_void_p(vertices.ctypes.data),0x88E4)
    bindBuffer(0x8893,buffers[1]);bufferData(0x8893,indices.nbytes,C.c_void_p(indices.ctypes.data),0x88E4)
    for index,size,offset in [(0,3,0),(1,3,12),(2,2,24)]:pointer(index,size,0x1406,False,32,C.c_void_p(offset))
    activeTexture(0x84C0);bindTexture(0x0DE1,textures[mesh['imageIndex']]);activeTexture(0x84C1);bindTexture(0x0DE1,textures[mesh['roughnessImageIndex'] or mesh['imageIndex']])
    uniform1f(location(program,b'alphaCutoff'),mesh['alphaCutoff']);uniform1f(location(program,b'roughness'),mesh['roughness']);uniform1i(location(program,b'hasRoughnessMap'),int(mesh['roughnessImageIndex']is not None))
    drawElements(0x0004,len(indices),0x1405,None)
   pixels=np.zeros((height,width,4),dtype=np.uint8);gl.fn('glFinish',None)();gl.fn('glReadPixels',None,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p)(0,0,width,height,0x1908,0x1401,C.c_void_p(pixels.ctypes.data))
   image=Image.fromarray(pixels[::-1].copy()).convert('RGB');frames[(case['name'],view)]=image;image.save(root/f"athlete-{case['name']}-{view}.png")
 font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
 cw,ch=360,592
 shape=Image.new('RGB',(cw*len(data['cases']),ch*2+110),'#111418');d=ImageDraw.Draw(shape)
 for col,case in enumerate(data['cases']):
  for row,view in enumerate(['front','side']):
   im=frames[(case['name'],view)].resize((cw,ch),Image.Resampling.LANCZOS);shape.paste(im,(col*cw,40+row*ch))
   d.text((col*cw+18,42+row*ch),case['name'].upper()+' / '+view.upper(),font=font,fill='#f1e8df')
 d.text((18,12),'FANGKUN | warm-up drill keyframes; actual GLB geometry' if data.get('kind')=='preparation' else 'FANGKUN | actual rigged GLB geometry and four regional morph targets',font=font,fill='#f1e8df')
 d.text((18,ch*2+72),'Offline software GL inspection; approximate lighting. Not an app screenshot, measured body or portrait likeness.',font=small,fill='#b2bbc5')
 shape.save(root/('warmup-drill-keyframes.png' if data.get('kind')=='preparation' else 'athlete-shape-preview.png'))
 if data.get('kind')=='preparation':
  (root/'render-method.json').write_text(json.dumps({'method':'actual Three.js posed GLB geometry; EGL ES3 rendering with approximate lighting','browserUsed':False,'frames':len(frames),'notBiomechanicalApproval':True},indent=2)+'\n')
  print(root/'warmup-drill-keyframes.png');return
 viewsim=Image.new('RGB',(width*3,height+90),'#111418');d=ImageDraw.Draw(viewsim)
 for i,view in enumerate(['front','side','back']):viewsim.paste(frames[('neutral',view)],(i*width,40));d.text((i*width+20,15),view.upper(),font=font,fill='#f1e8df')
 d.text((20,height+55),'Real GLB mesh, original skeleton and UVs; charcoal surface clothing. Face identity is not reproduced.',font=small,fill='#b2bbc5')
 viewsim.save(root/'athlete-front-side-back.png')
 (root/'render-method.json').write_text(json.dumps({'method':'EGL surfaceless OpenGL ES 3.2; exact Three.js posed GLB mesh exports and embedded texture sampling; approximate studio shading','browserUsed':False,'generatedImageUsed':False,'frames':len(frames),'views':'front/side/back neutral; front/side four morph extremes','shapePreview':'athlete-shape-preview.png','viewPreview':'athlete-front-side-back.png'},indent=2)+'\n')
 print(root/'athlete-shape-preview.png');print(root/'athlete-front-side-back.png')

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('geometry_folder');args=parser.parse_args();render(Path(args.geometry_folder).resolve())
