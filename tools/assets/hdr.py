import sys,numpy as np
def read_hdr(p):
    f=open(p,'rb'); 
    l=f.readline()
    assert l.startswith(b'#?'),l
    while True:
        l=f.readline()
        if l.strip()==b'': break
    r=f.readline().split(); assert r[0]==b'-Y' and r[2]==b'+X',r
    H,W=int(r[1]),int(r[3])
    d=np.frombuffer(f.read(),dtype=np.uint8); out=np.empty((H,4,W),np.uint8); p=0
    for y in range(H):
        assert d[p]==2 and d[p+1]==2 and (int(d[p+2])<<8|int(d[p+3]))==W; p+=4
        for c in range(4):
            x=0
            while x<W:
                n=int(d[p]); p+=1
                if n>128:
                    n-=128; out[y,c,x:x+n]=d[p]; p+=1
                else:
                    out[y,c,x:x+n]=d[p:p+n]; p+=n
                x+=n
    e=out[:,3,:].astype(np.float32); s=np.where(e>0,np.ldexp(1.0,(e-136).astype(np.int32)),0).astype(np.float32)
    return np.stack([out[:,i,:]*s for i in range(3)],-1)
if __name__=='__main__':
    from PIL import Image
    for p in sys.argv[2:]:
        im=read_hdr(p); H,W,_=im.shape
        lum=im@np.array([.2126,.7152,.0722],np.float32)
        y,x=np.unravel_index(np.argmax(lum),lum.shape)
        # centroid of brightest pixels
        thr=lum.max()*0.5; ys,xs=np.nonzero(lum>=thr); w=lum[ys,xs]
        cy,cx=(ys*w).sum()/w.sum(),(xs*w).sum()/w.sum()
        el=90-(cy+.5)/H*180; az=(cx+.5)/W*360-180
        top=im[:H//2]; mean=top.mean((0,1))
        sunc=im[lum>=thr].mean(0)
        print(f"{p.split('/')[-1]}: {W}x{H} maxlum={lum.max():.0f} sun el={el:.1f} u={(cx+.5)/W:.4f} az(from centre)={az:.1f} n={len(ys)} skymean={mean.round(2)} sunRGB={(sunc/sunc.max()).round(2)}")
        t=im*float(sys.argv[1]); t=t/(1+t); t=(np.clip(t,0,1)**(1/2.2)*255).astype(np.uint8)
        Image.fromarray(t[:int(H*0.62)]).save(p.rsplit('.',1)[0]+'_prev.png')
