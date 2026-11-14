import sys,glob,os
from PIL import Image,ImageDraw
pat,out,cols,cw,ch=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4]),int(sys.argv[5])
fs=sorted(glob.glob(pat))
rows=(len(fs)+cols-1)//cols
S=Image.new('RGB',(cols*cw,rows*(ch+14)),(40,40,40))
d=ImageDraw.Draw(S)
for i,f in enumerate(fs):
    try:
        im=Image.open(f).convert('RGBA'); bg=Image.new('RGBA',im.size,(40,40,40,255)); im=Image.alpha_composite(bg,im).convert('RGB'); im.thumbnail((cw,ch))
    except Exception as e:
        print('BAD',f,e); continue
    x,y=(i%cols)*cw,(i//cols)*(ch+14)
    S.paste(im,(x,y+14)); d.text((x+2,y+1),os.path.basename(f).split('_',1)[1].rsplit('.',1)[0][:int(cw/6)],fill=(255,255,0))
S.save(out,quality=88)
print(len(fs),S.size)
