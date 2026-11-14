import json,sys,os,hashlib,subprocess
ROOT=sys.argv[1]; S=f'{ROOT}/.tmp/assets-src'
# id -> None (whole bin) or mesh index to keep (range download of that mesh's bufferViews)
sel={'rock_moss_set_01':None,'rock_moss_set_02':None,'boulder_01':None,'namaqualand_boulder_05':None,'dead_tree_trunk':None,'fern_02':None,'shrub_sorrel_01':None,
     'tree_small_02':None,'fir_tree_01':'fir_tree_01_b_LOD0','pine_sapling_medium':'pine_sapling_medium_a_LOD0'}
def curl(url,dst,rng=None):
    a=['/usr/bin/curl','-sfL','-A','asset-fetch/1.0','--max-time','900','--retry','3',url,'-o',dst]
    if rng: a[1:1]=['-r',rng]
    subprocess.run(a,check=True)
for id,keep in sel.items():
    F=json.load(open(f'{S}/info/files_{id}.json')); g=F['gltf']['1k']['gltf']
    d=f'{S}/models/{id}'; os.makedirs(d+'/textures',exist_ok=True)
    for rel,e in g['include'].items():
        dst=f'{d}/{rel}'
        assert '..' not in rel and not rel.startswith('/')
        if rel.endswith('.bin') and keep:
            G=json.load(open(f'{d}/{id}.gltf'))
            node=next(n for n in G['nodes'] if n['name']==keep)
            bvs=set()
            for p in G['meshes'][node['mesh']]['primitives']:
                for a in list(p['attributes'].values())+[p['indices']]: bvs.add(G['accessors'][a]['bufferView'])
            rs=sorted((G['bufferViews'][b]['byteOffset'],G['bufferViews'][b]['byteOffset']+G['bufferViews'][b]['byteLength']) for b in bvs)
            # merge into ranges (gap < 1MB merged)
            m=[list(rs[0])]
            for a,b in rs[1:]:
                if a-m[-1][1]<1<<20: m[-1][1]=max(m[-1][1],b)
                else: m.append([a,b])
            if os.path.exists(dst+'.done'): print(id,'bin partial cached'); continue
            with open(dst,'wb') as f: f.truncate(e['size'])
            for a,b in m:
                part=dst+f'.part_{a}'
                curl(e['url'],part,f'{a}-{b-1}')
                assert os.path.getsize(part)==b-a,(os.path.getsize(part),b-a)
                with open(dst,'r+b') as f, open(part,'rb') as pf:
                    f.seek(a)
                    while True:
                        c=pf.read(1<<24)
                        if not c: break
                        f.write(c)
                os.remove(part)
                print(id,'range',a,b,(b-a)/1e6,'MB')
            open(dst+'.done','w').write(json.dumps(m))
            continue
        if not (os.path.exists(dst) and os.path.getsize(dst)==e['size']): curl(e['url'],dst)
        ok=os.path.getsize(dst)==e['size'] and (e['size']>200e6 or hashlib.md5(open(dst,'rb').read()).hexdigest()==e['md5'])
        print(id,rel,e['size'],'ok' if ok else 'BAD')
    # alpha maps
    for k in F:
        if k.lower().endswith('alpha'):
            e=F[k]['1k']; fmt='png' if 'png' in e else list(e)[0]; e=e[fmt]
            dst=f'{d}/textures/{os.path.basename(e["url"])}'
            if not os.path.exists(dst): curl(e['url'],dst)
            print(id,'ALPHA',k,fmt,e['url'],e['size'],hashlib.md5(open(dst,'rb').read()).hexdigest()==e['md5'])
