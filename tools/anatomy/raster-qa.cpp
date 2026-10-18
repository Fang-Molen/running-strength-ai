// Tiny z-buffer for exact-geometry QA renders. Input: x,y,depth,r,g,b float32
// vertices, unindexed triangles. No browser, GL context or image generation.
#include <algorithm>
#include <cmath>
#include <fstream>
#include <limits>
#include <vector>
struct V { float x,y,z,r,g,b; };
int main(int argc,char**argv) {
 if(argc!=5)return 2; int w=std::stoi(argv[1]),h=std::stoi(argv[2]);
 std::ifstream f(argv[3],std::ios::binary|std::ios::ate); auto size=f.tellg();f.seekg(0);
 std::vector<V> v((size_t)size/sizeof(V));f.read((char*)v.data(),size);
 std::vector<float> depth(w*h,std::numeric_limits<float>::infinity());
 std::vector<unsigned char> pixels(w*h*3); for(int i=0;i<w*h;i++){pixels[i*3]=23;pixels[i*3+1]=26;pixels[i*3+2]=30;}
 for(size_t t=0;t+2<v.size();t+=3){V a=v[t],b=v[t+1],c=v[t+2];if(a.z<=0||b.z<=0||c.z<=0)continue;
  float den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(std::abs(den)<1e-8)continue;
  int x0=std::max(0,(int)std::floor(std::min({a.x,b.x,c.x}))),x1=std::min(w-1,(int)std::ceil(std::max({a.x,b.x,c.x})));
  int y0=std::max(0,(int)std::floor(std::min({a.y,b.y,c.y}))),y1=std::min(h-1,(int)std::ceil(std::max({a.y,b.y,c.y})));
  for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++){float px=x+.5f,py=y+.5f;
   float u=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/den,q=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/den,s=1-u-q;
   if(u<0||q<0||s<0)continue;float inv=u/a.z+q/b.z+s/c.z,z=1/inv;int i=y*w+x;if(z>=depth[i])continue;depth[i]=z;
   for(int k=0;k<3;k++){float A=(&a.r)[k],B=(&b.r)[k],C=(&c.r)[k];float col=(u*A/a.z+q*B/b.z+s*C/c.z)/inv;pixels[i*3+k]=(unsigned char)std::clamp(col*255.f,0.f,255.f);}
  }
 }
 std::ofstream out(argv[4],std::ios::binary);out<<"P6\n"<<w<<" "<<h<<"\n255\n";out.write((char*)pixels.data(),pixels.size());return 0;
}
