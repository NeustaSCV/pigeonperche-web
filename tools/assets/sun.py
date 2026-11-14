import sys,numpy as np
sys.path.insert(0,sys.argv[1])
from hdr import read_hdr
im=read_hdr(sys.argv[2]); H,W,_=im.shape
lum=im@np.array([.2126,.7152,.0722],np.float32)
thr=lum.max()*0.2; ys,xs=np.nonzero(lum>=thr); w=lum[ys,xs]
cy,cx=(ys*w).sum()/w.sum(),(xs*w).sum()/w.sum()
u=(cx+.5)/W; v=(cy+.5)/H; el=90-v*180; phi=(u-.5)*360
e=np.radians(el); p=np.radians(phi)
print(f'{W}x{H} max={lum.max():.0f} n={len(ys)} u={u:.4f} v={v:.4f} elevation={el:.2f} phi=atan2(z,x)={phi:.2f}')
print('three.js dir (equirect default mapping, x=cos el cos phi, y=sin el, z=cos el sin phi):',np.round([np.cos(e)*np.cos(p),np.sin(e),np.cos(e)*np.sin(p)],4))
sun=im[ys,xs].mean(0); print('sun rgb mean',sun, 'norm',np.round(sun/sun.max(),3))
# sky irradiance colour upper hemisphere excluding sun
yy=(np.arange(H)+.5)/H; sa=np.sin(yy*np.pi)[:,None]
m=(lum<thr)&(np.arange(H)[:,None]<H//2)
print('upper-hemisphere mean radiance (no sun):',np.round((im*sa[...,None]*m[...,None]).sum((0,1))/(sa*m).sum(),3))
