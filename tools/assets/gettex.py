import json,sys,os,hashlib,urllib.request,shutil
ROOT=sys.argv[1]
sel={'grass':('forrest_ground_01','1k'),'rock':('marble_cliff_05','2k'),'scree':('rocks_ground_01','1k'),'forest':('forest_leaves_02','1k'),
'dirt':('rocky_trail_02','1k'),'wall':('castle_wall_slates','2k'),'flag':('stone_tiles_02','1k'),'bark':('pine_bark','1k'),'wood':('weathered_planks','1k'),
'plaster':('white_plaster_02','1k'),'roof':('clay_roof_tiles_02','1k'),'metal':('worn_corrugated_iron','1k'),'fabric':('hessian_380','1k')}
def get(url,dst):
    import subprocess
    subprocess.run(['/usr/bin/curl','-sfL','-A','asset-fetch/1.0','--max-time','300',url,'-o',dst],check=True)
def js(url,cache):
    if not os.path.exists(cache): get(url,cache)
    return json.load(open(cache))
rec=[]
for name,(id,res) in sel.items():
    files=js(f'https://api.polyhaven.com/files/{id}',f'{ROOT}/.tmp/assets-src/info/files_{id}.json')
    info=js(f'https://api.polyhaven.com/info/{id}',f'{ROOT}/.tmp/assets-src/info/info_{id}.json')
    print(name,id,'maps:',list(files.keys()),'authors:',list(info.get('authors',{}).keys()),'dim',info.get('dimensions'))
    want={'diff':['Diffuse','diff'],'nor':['nor_gl'],'arm':['arm']}
    if name=='wall': want['disp']=['Displacement','disp']
    for suf,keys in want.items():
        k=next((k for k in keys if k in files),None)
        if not k: print('  MISSING',suf); continue
        e=files[k][res]['jpg']
        src=f'{ROOT}/.tmp/assets-src/tex/{os.path.basename(e["url"])}'
        if not os.path.exists(src): get(e['url'],src)
        md5=hashlib.md5(open(src,'rb').read()).hexdigest()
        ok=md5==e['md5'] and os.path.getsize(src)==e['size']
        dst=f'{ROOT}/public/assets/tex/{name}_{suf}.jpg'
        shutil.copyfile(src,dst)
        print('  ',suf,k,e['url'],e['size'],'md5ok' if ok else 'MD5 MISMATCH')
        rec.append(dict(path=f'tex/{name}_{suf}.jpg',name=name,map=suf,id=id,res=res,url=e['url'],md5ok=ok))
json.dump(rec,open(f'{ROOT}/.tmp/assets-src/tex_records.json','w'),indent=1)
