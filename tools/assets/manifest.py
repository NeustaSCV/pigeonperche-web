import json,os,sys,struct,io,datetime
from PIL import Image
ROOT=sys.argv[1]; A=f'{ROOT}/public/assets'; S=f'{ROOT}/.tmp/assets-src'
sys.path.insert(0,f'{ROOT}/.tmp/scripts')
PH='Poly Haven'; CC0='CC0 1.0'
def info(id): return json.load(open(f'{S}/info/info_{id}.json'))
def authors(id): return ', '.join(info(id).get('authors',{}).keys())
files=[]; credits=[]; problems=[]
def check(c,msg):
    if not c: problems.append(msg)
# --- sky
hid='table_mountain_1_puresky'
for res,fn in (('4k','sky_4k.hdr'),('1k','sky_1k.hdr')):
    p=f'{A}/sky/{fn}'; d=open(p,'rb').read(2000)
    check(d.startswith(b'#?RADIANCE'),f'{fn} magic')
    import re; m=re.search(rb'-Y (\d+) \+X (\d+)',d); w,h=int(m.group(2)),int(m.group(1))
    files.append(dict(path=f'sky/{fn}',kind='hdri',format='Radiance RGBE .hdr (equirectangular)',sourceId=hid,source=PH,sourceUrl=f'https://polyhaven.com/a/{hid}',downloadUrl=f'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/{res}/{hid}_{res}.hdr',licence=CC0,author=authors(hid),resolution=[w,h],bytes=os.path.getsize(p),
      sun=dict(elevationDeg=12.8,uv=[0.6375,0.4287],phiDeg=49.5,directionThree=[0.6334,0.2221,0.7412],colourNormalised=[1.0,0.898,0.585],note='direction TO the sun for the default three.js equirect mapping (u=atan2(z,x)/2pi+0.5); peak radiance ~1.2e5 (unclipped)')))
credits.append(('Sky HDRI (sky_4k.hdr, sky_1k.hdr)',info(hid)['name'],hid,authors(hid),f'https://polyhaven.com/a/{hid}',CC0))
# --- textures
recs=json.load(open(f'{S}/tex_records.json'))
recs+= [dict(path=f'tex/moss_{m}.jpg',name='moss',map=m,id='Moss002',res='1k',url='https://ambientcg.com/get?file=Moss002_1K-JPG.zip',md5ok=None) for m in ('diff','nor','arm')]
MAPDESC={'diff':'base colour (sRGB)','nor':'normal map, OpenGL convention (+Y up)','arm':'ORM packed: R=AO, G=roughness, B=metalness (linear)','disp':'displacement/height (linear, mid-grey = 0)'}
seen={}
for r in recs:
    p=f'{A}/{r["path"]}'; d=open(p,'rb').read()
    check(len(d)>0 and d[:3]==b'\xff\xd8\xff',f'{r["path"]} jpeg magic'); 
    im=Image.open(io.BytesIO(d)); im.load(); 
    if r['md5ok'] is False: problems.append(r['path']+' md5')
    acg=r['id']=='Moss002'
    e=dict(path=r['path'],kind='texture',map=r['map'],mapInfo=MAPDESC[r['map']],sourceId=r['id'],source='ambientCG' if acg else PH,sourceUrl=f'https://ambientcg.com/a/{r["id"]}' if acg else f'https://polyhaven.com/a/{r["id"]}',downloadUrl=r['url'],licence=CC0,author='Lennart Demes (ambientCG)' if acg else authors(r['id']),resolution=list(im.size),bytes=len(d))
    if not acg:
        dim=info(r['id']).get('dimensions'); 
        if dim: e['realWorldSizeMetres']=[round(x/1000,2) for x in dim[:2]]
    else:
        e['note']={'diff':'re-encoded from Moss002_1K-JPG_Color.jpg','nor':'re-encoded from Moss002_1K-JPG_NormalGL.jpg','arm':'packed locally: R=AmbientOcclusion, G=Roughness, B=0 (ambientCG ships no ARM map)'}[r['map']]
    files.append(e)
    if r['name'] not in seen:
        seen[r['name']]=1
        credits.append((f'Texture `{r["name"]}` (tex/{r["name"]}_*.jpg)','Moss 002' if acg else info(r['id'])['name'],r['id'],e['author'],e['sourceUrl'],CC0))
# --- models
for name in ['rock_a','rock_b','rock_c','rock_d','conifer','conifer_b','broadleaf','deadwood','shrub','clump']:
    m=json.load(open(f'{S}/model_{name}.json')); p=f'{A}/models/{name}.glb'; d=open(p,'rb').read()
    magic,ver,ln=struct.unpack('<4sII',d[:12]); check(magic==b'glTF' and ver==2 and ln==len(d),f'{name} glb header')
    jl=struct.unpack('<I',d[12:16])[0]; G=json.loads(d[20:20+jl]); bin0=d[20+jl+8:]
    ext=G.get('extensionsUsed',[]); check(not any(x in e for e in ext for x in ('draco','meshopt','basisu','webp','avif')),f'{name} forbidden ext {ext}')
    for im in G.get('images',[]):
        bv=G['bufferViews'][im['bufferView']]; pil=Image.open(io.BytesIO(bin0[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']])); pil.load()
        check(max(pil.size)<=1024 and im['mimeType'] in ('image/jpeg','image/png'),f'{name} image {im}')
    tr=sum(G['accessors'][pr['indices']]['count']//3 for me in G['meshes'] for pr in me['primitives']); check(tr==m['triangles'],f'{name} tri mismatch')
    id=m['source']
    files.append(dict(path=f'models/{name}.glb',kind='model',sourceId=id,source=PH,sourceUrl=f'https://polyhaven.com/a/{id}',downloadUrl=f'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/{id}/{id}.gltf',licence=CC0,author=authors(id),
        triangles=m['triangles'],originalTriangles=m['originalTriangles'],keptSourceNodes=m['keptNode'],bboxSizeMetres=m['bboxSize'],bboxMin=m['bboxMin'],bboxMax=m['bboxMax'],
        nodes=sorted(set(p_['node'] for p_ in m['primitives'])),primitives=[{k:p_[k] for k in ('node','material','alphaMode','triangles','vertices')} for p_ in m['primitives']],
        materials=m['materials'],textures=m['textures'],extensionsUsed=ext,foliage=m['foliage'],removedFromSource=m['stripped'],bytes=len(d),upAxis='+Y',units='metres'))
    credits.append((f'Model `{name}.glb`',info(id)['name'],id,authors(id),f'https://polyhaven.com/a/{id}',CC0))
total=sum(os.path.getsize(os.path.join(dp,f)) for dp,_,fs in os.walk(A) for f in fs)
on_disk=sorted(os.path.relpath(os.path.join(dp,f),A) for dp,_,fs in os.walk(A) for f in fs if f!='manifest.json' and not f.startswith('.'))
listed=sorted(f['path'] for f in files); check(on_disk==listed,f'manifest/disk mismatch: {set(on_disk)^set(listed)}')
man=dict(generated=datetime.date.today().isoformat(),note='All assets CC0. Textures: *_diff sRGB, *_nor OpenGL normals, *_arm = AO/Roughness/Metal in R/G/B. Models: plain GLB (no Draco/meshopt/KTX2), +Y up, metres. Tree foliage = alpha-tested (MASK) branch cards baked from the source needle/leaf geometry.',totalBytes=total,files=files)
json.dump(man,open(f'{A}/manifest.json','w'),indent=1)
L=['# Credits — PIGEON PERCHÉ','','All third-party assets below are released under **CC0 1.0 Universal** (public domain dedication) — no attribution is legally required; it is given here with thanks.','','| In-game asset | Original title | Source id | Author(s) | Source | Licence |','|---|---|---|---|---|---|']
for c in credits: L.append(f'| {c[0]} | {c[1]} | `{c[2]}` | {c[3]} | {c[4]} | {c[5]} |')
L+=['','Sources: [Poly Haven](https://polyhaven.com) (HDRI, textures, models) and [ambientCG](https://ambientcg.com) (moss texture).','','Modifications: models were decimated and repacked as GLB with glTF-Transform; tree foliage was re-baked into alpha-tested branch cards; alpha maps were packed into base-colour PNGs; the moss AO/roughness maps were packed into one ARM texture. Machine-readable details: `public/assets/manifest.json`.','']
open(f'{ROOT}/CREDITS.md','w').write('\n'.join(L))
print('files',len(files),'total MB',round(total/1e6,1),'problems',problems)
