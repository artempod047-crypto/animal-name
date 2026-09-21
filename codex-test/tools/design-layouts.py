"""沿用原三套骨架，以 1/32 牌宽细化错位；不参与运行时生成。"""
import json, random
from pathlib import Path

TEMPLATES = {
    'bent-steps': [
        [(0,4),(4,4),(8,4),(12,4),(0,8),(8,8),(12,8),(16,16),(4,12),(8,12),(12,12),(8,16),(0,15)],
        [(2,2),(6,5),(10,2),(14,6),(2,10),(6,10),(10,10),(14,12),(6,16)],
        [(1,3),(5,6),(9,3),(13,7),(4,12),(8,14),(12,13)],
        [(2,3),(6,7),(10,4),(8,13)],
        [(2,3),(7,6)],
        [(2,3)],
    ],
    'linked-peaks': [
        [(0,0),(4,0),(12,0),(0,10),(0,4),(4,4),(8,4),(12,4),(4,8),(8,8),(12,12)],
        [(1,1),(5,1),(13,1),(1,5),(5,5),(9,5),(13,5),(5,9),(9,10),(13,13)],
        [(2,2),(6,2),(12,2),(4,6),(8,6),(8,11),(14,13)],
        [(2,2),(6,3),(12,3),(10,11)],
        [(2,2),(12,3),(7,7)],
        [(12,3)],
    ],
    'notched-court': [
        [(4,0),(8,0),(0,1),(4,4),(8,4),(12,4),(0,8),(4,8),(8,8),(4,12),(14,13),(14,9)],
        [(5,0),(9,1),(1,5),(5,5),(9,5),(1,9),(5,10),(9,10),(14,8)],
        [(5,0),(10,2),(2,5),(6,5),(3,10),(7,10),(11,8)],
        [(5,0),(3,5),(7,6),(5,10)],
        [(5,0),(4,5),(6,10)],
        [(4,5)],
    ]
}
ROOT = Path(__file__).resolve().parents[1]
data = []
for name, layers in TEMPLATES.items():
    # 在原骨架上细化坐标，保留所有原有遮挡边和同层不相交关系。
    # 同位置的竖直牌组一起平移，保留完全隐藏的牌。
    base = [(x*8,y*8,z) for z,points in enumerate(layers) for x,y in points]
    refined = list(base)
    overlap = lambda a,b: abs(a[0]-b[0])<32 and abs(a[1]-b[1])<32
    groups = [[i for i,t in enumerate(base) if t[:2]==xy] for xy in sorted(set(t[:2] for t in base))]
    randomizer = random.Random(2026)
    for attempt in range(600):
        group = randomizer.choice(groups)
        dx,dy = randomizer.choice([(1,0),(-1,0),(0,1),(0,-1)])
        trial = [(x+dx,y+dy,z) if i in group else (x,y,z) for i,(x,y,z) in enumerate(refined)]
        if any(abs(trial[i][axis]-base[i][axis])>3 for i in group for axis in (0,1)): continue
        if all(overlap(a,b)==overlap(base[i],base[j]) for i,a in enumerate(trial) for j,b in enumerate(trial) if i<j):
            refined = trial
    layers = [[(x,y) for x,y,z in refined if z==level] for level in range(6)]
    tiles = [(x,y,z) for z, points in enumerate(layers) for x,y in points]
    overlap = lambda a,b: abs(a[0]-b[0])<32 and abs(a[1]-b[1])<32
    assert len(tiles)==36
    assert all(a[2]!=b[2] or not overlap(a,b) for i,a in enumerate(tiles) for b in tiles[i+1:])
    up = [[j for j,b in enumerate(tiles) if b[2]>a[2] and overlap(a,b)] for a in tiles]
    down = [[j for j,b in enumerate(tiles) if b[2]<a[2] and overlap(a,b)] for a in tiles]
    depth = lambda i: 1+max([depth(j) for j in down[i]] or [0])
    visible = []
    for i,(x,y,z) in enumerate(tiles):
        cells = [(x+dx+.5,y+dy+.5) for dx in range(32) for dy in range(32)]
        visible.append(sum(not any(tiles[j][0]<px<tiles[j][0]+32 and tiles[j][1]<py<tiles[j][1]+32 for j in up[i]) for px,py in cells)/1024)
    def largest(skip=-1):
        remaining=set(range(36))-{skip}; sizes=[]
        while remaining:
            todo=[remaining.pop()]; size=0
            while todo:
                i=todo.pop(); size+=1
                neighbors=(set(up[i]+down[i])&remaining)
                remaining-=neighbors; todo.extend(neighbors)
            sizes.append(size)
        return max(sizes)
    print(name, 'counts', [len(l) for l in layers], 'depth',max(depth(i) for i in range(36)),
          'open',[(i,tiles[i][2],depth(i)) for i in range(36) if not up[i]],
          'connected',largest(),'worst removal',min(largest(i) for i in range(36)),
          'hidden',visible.count(0),'corner',sum(0<v<=.25 for v in visible),'partial',sum(.25<v<1 for v in visible))
    data.append({'id':name,'levels':layers})
lines=['// 沿用原三套骨架，单位细化为牌宽的 1/32；方牌不缩放、不旋转。',
       '// levels 数组索引为高度 0～5。运行时只做有限镜像，不随机散落坐标。',
       'globalThis.AnimalLayouts = [']
for template in data:
    lines.append('  { id: '+json.dumps(template['id'])+', grid: 32, levels: [')
    for level, points in enumerate(template['levels']):
        lines.append('    '+json.dumps(points)+', // height '+str(level))
    lines.append('  ] },')
lines.append('];')
(ROOT/'layouts.js').write_text('\n'.join(lines)+'\n',encoding='utf-8')
