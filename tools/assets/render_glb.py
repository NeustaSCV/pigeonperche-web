# Minimal software rasteriser to eyeball an optimised GLB (orthographic, alpha-tested, lambert). Usage: render_glb.py in.glb out.png [yaw_deg] [height_px]
import sys,json,struct,io,math
import numpy as np
from PIL import Image
src,out=sys.argv[1],sys.argv[2]; yaw=math.radians(float(sys.argv[3]) if len(sys.argv)>3 else 30); HP=int(sys.argv[4]) if len(sys.argv)>4 else 720
d=open(src,'rb').read(); assert d[:4]==b'glTF'
jl=struct.unpack('<I',d[12:16])[0]; G=json.loads(d[20:20+jl]); B=d[20+jl+8:]
CT={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}; NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def acc(i):
    a=G['accessors'][i]; bv=G['bufferViews'][a['bufferView']]; n=NC[a['type']]; dt=np.dtype(CT[a['componentType']])
    off=bv.get('byteOffset',0)+a.get('byteOffset',0); st=bv.get('byteStride',0)
    if st and st!=dt.itemsize*n:
        raw=np.frombuffer(B,np.uint8,count=st*a['count'],offset=off).reshape(a['count'],st)[:,:dt.itemsize*n].copy(); arr=raw.view(dt).reshape(a['count'],n)
    else: arr=np.frombuffer(B,dt,count=a['count']*n,offset=off).reshape(a['count'],n)
    arr=arr.astype(np.float64) if a['type']!='SCALAR' else arr.astype(np.int64).ravel()
    if a.get('normalized'): arr=arr/np.iinfo(dt).max
    return arr
texc={}
def tex(ti):
    if ti in texc: return texc[ti]
    im=G['images'][G['textures'][ti]['source']]; bv=G['bufferViews'][im['bufferView']]
    t=np.asarray(Image.open(io.BytesIO(B[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']])).convert('RGBA'),dtype=np.float32)/255
    texc[ti]=t; return t
def quat(q):
    x,y,z,w=q; return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
tris=[]
def walk(ni,M):
    n=G['nodes'][ni]; L=np.eye(4)
    if 'matrix' in n: L=np.array(n['matrix']).reshape(4,4).T
    else:
        L[:3,:3]=quat(n.get('rotation',[0,0,0,1]))@np.diag(n.get('scale',[1,1,1])); L[:3,3]=n.get('translation',[0,0,0])
    W=M@L
    if 'mesh' in n:
        for p in G['meshes'][n['mesh']]['primitives']:
            P=acc(p['attributes']['POSITION']); P=(W[:3,:3]@P.T).T+W[:3,3]
            m=G['materials'][p['material']]; pb=m.get('pbrMetallicRoughness',{}); bt=pb.get('baseColorTexture')
            UV=acc(p['attributes'][f"TEXCOORD_{bt.get('texCoord',0)}"]) if bt else np.zeros((len(P),2))
            if bt and 'extensions' in bt:
                tt=bt['extensions']['KHR_texture_transform']; UV=UV*np.array(tt.get('scale',[1,1]))+np.array(tt.get('offset',[0,0]))
            I=acc(p['indices']).reshape(-1,3) if 'indices' in p else np.arange(len(P)).reshape(-1,3)
            tris.append((P,UV,I,tex(bt['index']) if bt else None,m.get('alphaMode','OPAQUE'),m.get('alphaCutoff',0.5)))
    for c in n.get('children',[]): walk(c,W)
for r in G['scenes'][G.get('scene',0)]['nodes']: walk(r,np.eye(4))
allP=np.concatenate([t[0] for t in tris]); c,s=math.cos(yaw),math.sin(yaw); pitch=math.radians(12); cp,sp=math.cos(pitch),math.sin(pitch)
R=np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]])@np.array([[c,0,s],[0,1,0],[-s,0,c]])
V=(R@allP.T).T; mn,mx=V.min(0),V.max(0); sc=(HP-20)/max(mx[1]-mn[1],1e-6); WP=int((mx[0]-mn[0])*sc)+20
if WP>2200: sc*=2200/WP; WP=2200; HP=int((mx[1]-mn[1])*sc)+20
img=np.zeros((HP,WP,3),np.float32); img[:]=np.array([.55,.68,.82]); zb=np.full((HP,WP),-1e18)
sun=np.array([.5,.6,.62]); sun/=np.linalg.norm(sun); nt=0
for P,UV,I,T,am,cut in tris:
    Vv=(R@P.T).T; X=(Vv[:,0]-mn[0])*sc+10; Y=HP-10-(Vv[:,1]-mn[1])*sc; Z=Vv[:,2]
    fn=np.cross(P[I[:,1]]-P[I[:,0]],P[I[:,2]]-P[I[:,0]]); fn/=np.linalg.norm(fn,axis=1,keepdims=True)+1e-20
    lam=fn@sun; lam=np.where(am!='OPAQUE',np.abs(lam)*0.6+0.4,np.clip(lam,0,1)*0.8+0.3)
    for k,(a,b,cc) in enumerate(I):
        x0,x1=int(max(0,math.floor(min(X[a],X[b],X[cc])))),int(min(WP-1,math.ceil(max(X[a],X[b],X[cc]))))
        y0,y1=int(max(0,math.floor(min(Y[a],Y[b],Y[cc])))),int(min(HP-1,math.ceil(max(Y[a],Y[b],Y[cc]))))
        if x1<x0 or y1<y0: continue
        den=(Y[b]-Y[cc])*(X[a]-X[cc])+(X[cc]-X[b])*(Y[a]-Y[cc])
        if abs(den)<1e-12: continue
        xs,ys=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
        w0=((Y[b]-Y[cc])*(xs-X[cc])+(X[cc]-X[b])*(ys-Y[cc]))/den; w1=((Y[cc]-Y[a])*(xs-X[cc])+(X[a]-X[cc])*(ys-Y[cc]))/den; w2=1-w0-w1
        m=(w0>=0)&(w1>=0)&(w2>=0)
        if not m.any(): continue
        z=w0*Z[a]+w1*Z[b]+w2*Z[cc]; m&=z>zb[y0:y1+1,x0:x1+1]
        if T is not None:
            u=w0*UV[a,0]+w1*UV[b,0]+w2*UV[cc,0]; v=w0*UV[a,1]+w1*UV[b,1]+w2*UV[cc,1]
            tx=(np.floor((u%1)*T.shape[1]).astype(int))%T.shape[1]; ty=(np.floor((v%1)*T.shape[0]).astype(int))%T.shape[0]; col=T[ty,tx]
            if am!='OPAQUE': m&=col[...,3]>=cut
            col=col[...,:3]**2.2
        else: col=np.full(xs.shape+(3,),.6)
        if not m.any(): continue
        nt+=1; sub=img[y0:y1+1,x0:x1+1]; sub[m]=(col[m]*lam[k]); zb[y0:y1+1,x0:x1+1][m]=z[m]
img=np.clip(img,0,1)**(1/2.2); Image.fromarray((img*255).astype(np.uint8)).save(out); print(out,WP,HP,'tris drawn',nt)
