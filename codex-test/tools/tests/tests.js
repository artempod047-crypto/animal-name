(async function () {
  'use strict';
  const G = AnimalGame, results = [], out = document.getElementById('result');
  let failures = 0;
  const check = (value, text = '断言失败') => { if (!value) throw new Error(text); };
  const eq = (a, b) => check(JSON.stringify(a) === JSON.stringify(b), '值不相等');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function test(name, run) {
    try { await run(); results.push('PASS ' + name); }
    catch (error) { failures++; results.push('FAIL ' + name + ': ' + error.stack); }
    out.textContent = results.join('\n');
  }
  const deal = G.generate(42);
  function memoryStore() {
    let saved = null;
    return { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  }
  function fixture(types) {
    const state = G.makeState(deal);
    state.capacity = 7; // 保留原七格规则的回归用例；动态边界另行遍历。
    state.tiles.forEach((t, i) => { t.x = i*2; t.y = 0; t.layer = 0; });
    const ids = [];
    for (const type of types) {
      const tile = state.tiles.find(t => t.animalId === type && !ids.includes(t.id));
      ids.push(tile.id);
    }
    return { state, ids };
  }
  await test('配置、36 张、每种 6 张、开局 6～12 张跨高度入口且同类最多 2 张', () => {
    G.validateConfig(); eq(deal.tiles.length, 36);
    const state = G.makeState(deal), available = state.tiles.filter(t => G.canPick(state, t));
    check(available.length >= 6 && available.length <= 12);
    check(new Set(available.map(t=>t.layer)).size>=2);
    G.CONFIG.enabledAnimalIds.forEach(id => {
      eq(deal.tiles.filter(t => t.animalId === id).length, 6);
      check(available.filter(t => t.animalId === id).length <= 2);
    });
    check(Math.max(...state.tiles.map(t=>t.layer))<=5);
  });
  await test('三套模板各 100 个固定种子：四种镜像、完整回放、逐步守恒、生成超时保护', () => {
    const unique = new Set(), minima = new Set(); let maxMs = 0, fallbackCount = 0;
    for (const template of G.CONFIG.layoutTemplates) for (let seed = 0; seed < 100; seed++) {
      const start = performance.now(), d = G.generate(seed,{templateId:template.id,variant:seed%4});
      const duration = performance.now()-start;
      check(duration < 1000, `生成超过 1 秒：${seed}`);
      maxMs = Math.max(maxMs, duration);
      if (d.fallback) fallbackCount++;
      G.validateDeal(d);
      minima.add(d.cmin); eq(d.capacity,d.cmin+3);
      unique.add(d.templateId+d.tiles.map(t => t.animalId).join(','));
      const state = G.makeState(d);
      for (const id of d.solution) {
        check(G.pick(state, id)); G.assertConservation(state);
        check(state.tray.length < state.capacity);
      }
      eq(state.status, 'won'); eq(state.eliminated, 36);
    }
    check(unique.size > 290);
    results.push(`INFO 300 局最大生成时间 ${maxMs.toFixed(1)} ms；备用局 ${fallbackCount}；不同分配 ${unique.size}；Cmin=${[...minima].sort()}`);
  });
  await test('独立以正式点击规则穷举小棋盘，对照求解器的三消、失败和最小容量', () => {
    function brute(tiles, capacity) {
      const seen = new Set();
      function visit(state) {
        if (state.status === 'won') return true;
        if (state.status === 'lost') return false;
        const key = state.tiles.map(t=>t.state === 'board' ? '1' : '0').join('');
        if (seen.has(key)) return false;
        seen.add(key);
        for (const tile of state.tiles.filter(t=>G.canPick(state,t))) {
          const next=G.clone(state); check(G.pick(next,tile.id));
          if (visit(next)) return true;
        }
        return false;
      }
      return visit(G.makeState({tiles,capacity}));
    }
    for (let seed=0;seed<24;seed++) {
      const random=G.rng(seed);
      const tiles=Array.from({length:9},(_,i)=>({id:`small-${i}`,animalId:['panda','rabbit','lion'][i%3],
        state:'board',width:1,height:1,x:Math.floor(random()*4)/2,y:Math.floor(random()*4)/2,layer:i}));
      let expected;
      for (let capacity=1;capacity<=7;capacity++) {
        const possible=brute(tiles,capacity);
        const result=G.solveCapacity(tiles,capacity,{budgetMs:1000,maxNodes:100000});
        eq(result.status,possible?'solvable':'unsolvable');
        if (possible && !expected) expected=capacity;
      }
      eq(G.minimumCapacity(tiles,{useCache:false,budgetMs:1000}).cmin,expected);
    }
    const chain=['panda','rabbit','panda','rabbit','panda','rabbit'].map((animalId,i)=>
      ({id:`chain-${i}`,animalId,state:'board',width:1,height:1,x:0,y:0,layer:5-i}));
    eq(G.minimumCapacity(chain,{useCache:false,budgetMs:1000}).cmin,5);
    const s=G.makeState({tiles:chain,capacity:5});
    chain.slice(0,4).forEach(t=>G.pick(s,t.id)); eq(s.tray.length,4);
    const pending=G.beginPick(s,chain[4].id); eq(s.tray.length,5);
    G.finishPick(s,pending); eq(s.tray.length,2); eq(s.status,'playing');
    G.pick(s,chain[5].id); eq(s.status,'won');
    const failed=G.makeState({tiles:chain,capacity:4});
    chain.slice(0,4).forEach(t=>G.pick(failed,t.id)); eq(failed.status,'lost');
  });
  await test('完整 36 张牌：独立重搜 Cmin-1 无解、Cmin 可解、最终容量路径获胜',()=>{
    for(const t of G.CONFIG.layoutTemplates) for(let seed=0;seed<10;seed++) {
      const d=G.generate(seed,{templateId:t.id,variant:seed%4});
      eq(G.solveCapacity(d.tiles,d.cmin-1,{budgetMs:1000,maxNodes:1000000}).status,'unsolvable');
      const proof=G.solveCapacity(d.tiles,d.cmin,{budgetMs:1000,maxNodes:1000000});
      eq(proof.status,'solvable');
      for(const capacity of [d.cmin,d.capacity]) {
        const s=G.makeState({...d,capacity});
        proof.solution.forEach(id=>check(G.pick(s,id))); eq(s.status,'won');
      }
    }
  });
  await test('耗尽时间/节点预算明确返回 unknown，不能伪装无解或精确最小值',()=>{
    eq(G.solveCapacity(deal.tiles,deal.cmin,{maxNodes:0}).status,'unknown');
    eq(G.minimumCapacity(deal.tiles,{useCache:false,budgetMs:0}).status,'unknown');
    eq(G.minimumCapacity(deal.tiles,{useCache:false,maxNodes:0}).status,'unknown');
  });
  await test('累计通关逐步收紧余量；重玩和刷新不重复计数；失败、换局不加次数',async()=>{
    eq([0,2,3,7,8,20].map(G.extraSlots),[3,3,2,2,1,1]);
    const store=memoryStore(); let s=new GameSession(store,()=>{},0);
    for(let wins=0;wins<9;wins++) {
      const d=G.generate(100+wins,{wins}); s.start(d);
      eq(s.wins,wins); eq(d.capacity,d.cmin+G.extraSlots(wins));
      for(const id of d.solution) await s.choose(id);
      eq(s.wins,wins+1); eq(s.state.status,'won');
      const restored=new GameSession(store,()=>{},0); check(restored.restore()); s=restored;
      eq(s.wins,wins+1); s.replay(); eq(s.deal,d); eq(s.state.capacity,d.capacity);
      check(new GameSession(store).restore());
      for(const id of d.solution) await s.choose(id);
      eq(s.wins,wins+1); // 已通关的同一关只计一次。
    }
    const d=G.generate(999,{wins:s.wins}); s.start(d); eq(s.wins,9);
    s.replay(); eq(s.wins,9); eq(s.deal.capacity,d.capacity);
  });
  await test('强制预算耗尽：三套模板各四种镜像的备用牌局均能通关', () => {
    for(const t of G.CONFIG.layoutTemplates) for(let variant=0;variant<4;variant++) {
      const d=G.generate(567,{attempts:0,templateId:t.id,variant});
      check(d.fallback); eq(d.templateId,t.id); eq(d.variant,variant); G.validateDeal(d);
    }
  });
  await test('三套模板结构真实不同：六层遮挡链、浅堆、分叉汇合、主连接与隐藏程度',()=>{
    const signatures=new Set();
    for(const template of G.CONFIG.layoutTemplates) {
      const tiles=G.positions(template.id), stats=G.validateGeometry(tiles);
      signatures.add(JSON.stringify(tiles.map(t=>[t.x,t.y,t.layer])));
      eq(stats.maxDepth,6);
      check(stats.open.some(i=>stats.depths[i]>=2 && stats.depths[i]<=3));
      check(stats.largestComponent>=30 && stats.worstRemovalComponent>=24);
      check(stats.forks>=2 && stats.merges>=2 && stats.hidden>0 && stats.corners>0 && stats.partial>0);
      check(!tiles.some((a,i)=>tiles.some((b,j)=>i!==j && a.layer===b.layer && G.overlaps(a,b))));
      const ratios=new Set(tiles.flatMap(a=>tiles.filter(b=>b.layer>a.layer && G.overlaps(a,b)).map(b=>
        (Math.min(a.x+1,b.x+1)-Math.max(a.x,b.x))*(Math.min(a.y+1,b.y+1)-Math.max(a.y,b.y)))));
      check(ratios.size>=12, '遮挡比例过于单一');
      results.push(`INFO ${template.id}: ${ratios.size} 种实际重叠比例`);
      // 独立沿重叠边回溯，验证六层确实由六张牌组成。
      function chain(tile) {
        const lower=tiles.filter(t=>t.layer<tile.layer && G.overlaps(t,tile));
        const paths=lower.map(chain).sort((a,b)=>b.length-a.length);
        return [tile.id,...(paths[0]||[])];
      }
      eq(Math.max(...tiles.map(t=>chain(t).length)),6);
      results.push(`INFO ${template.id}: depth=${stats.maxDepth}, open=${stats.open.length}, main=${stats.largestComponent}, after-one-removal>=${stats.worstRemovalComponent}, hidden=${stats.hidden}, corner=${stats.corners}, partial=${stats.partial}`);
    }
    eq(signatures.size,3);
  });
  await test('全场仍有最高牌时，另一处无遮挡的低层牌可立即选取',()=>{
    for(const template of G.CONFIG.layoutTemplates) {
      const d=G.generate(33,{templateId:template.id}),state=G.makeState(d);
      const max=Math.max(...state.tiles.map(t=>t.layer));
      const low=state.tiles.find(t=>t.layer<max && G.canPick(state,t));
      check(low); check(G.pick(state,low.id)); check(state.tiles.some(t=>t.layer===max && t.state==='board'));
    }
  });
  await test('真实模板的汇合：多张上层遮挡牌只移走一张时不提前解锁',()=>{
    for(const template of G.CONFIG.layoutTemplates) {
      const state={tiles:G.positions(template.id)}, stats=G.analyzeGeometry(state.tiles);
      const i=stats.above.findIndex(up=>up.length>=2), tile=state.tiles[i], blockers=stats.above[i];
      check(i>=0); state.tiles[blockers[0]].state='tray'; check(!G.canPick(state,tile));
      for(const j of blockers.slice(1)) state.tiles[j].state='removed';
      check(G.canPick(state,tile));
    }
  });
  await test('每个模板的合法清理顺序支持一次解锁零张、一张和多张',()=>{
    for(const template of G.CONFIG.layoutTemplates) {
      const outcomes=new Set();
      for(let seed=0;seed<10;seed++) {
        const d=G.generate(seed,{templateId:template.id}),state=G.makeState(d);
        for(const id of d.solution) {
          const before=new Set(state.tiles.filter(t=>G.canPick(state,t)).map(t=>t.id));
          const pending=G.beginPick(state,id); check(pending);
          const opened=state.tiles.filter(t=>G.canPick(state,t) && !before.has(t.id)).length;
          outcomes.add(Math.min(2,opened)); G.finishPick(state,pending); G.assertConservation(state);
        }
      }
      check(outcomes.has(0) && outcomes.has(1) && outcomes.has(2), template.id);
    }
  });
  await test('换局排除当前模板，重玩保留完整位置、高度、镜像和动物分配',()=>{
    for(const template of G.CONFIG.layoutTemplates) {
      for(let seed=0;seed<10;seed++) check(G.generate(seed,{excludeTemplateId:template.id}).templateId!==template.id);
      const d=G.generate(46,{templateId:template.id,variant:3});
      const s=new GameSession(memoryStore()); s.start(d); G.pick(s.state,d.solution[0]); s.replay();
      eq(s.deal,d); eq(s.state,G.makeState(d));
    }
  });
  await test('被遮挡牌由业务逻辑拒绝且不会改变状态', () => {
    const state = G.makeState(deal), before = G.clone(state);
    const blocked = state.tiles.find(t => !G.canPick(state, t));
    check(!G.pick(state, blocked.id)); eq(state, before);
  });
  await test('最后一张遮挡牌移走后立即解锁，包括尚在结算时', () => {
    const state = G.makeState(deal);
    let checked = false;
    for (const id of deal.solution) {
      const blocked = state.tiles.filter(t => t.state === 'board' && !G.canPick(state, t));
      const pending = G.beginPick(state, id);
      if (blocked.some(t => G.canPick(state, t))) checked = true;
      G.finishPick(state, pending);
    }
    check(checked);
  });
  await test('仅边缘接触不遮挡，正面积重叠遮挡，同层不遮挡', () => {
    const a = { id: 'a', x: 0, y: 0, width: 1, height: 1, layer: 0, state: 'board' };
    const b = { ...a, id: 'b', x: 1, layer: 1 };
    const s = { tiles: [a, b] };
    check(!G.overlaps(a, b)); check(G.canPick(s, a));
    b.x = 0.999; check(!G.canPick(s, a));
    b.layer = 0; check(G.canPick(s, a));
    b.layer = 1; b.state = 'tray'; check(G.canPick(s, a));
  });
  await test('同类插到最后同类后，三张自动消除并补位', () => {
    const {state, ids} = fixture(['panda','rabbit','panda','panda']);
    ids.slice(0,3).forEach(id => G.pick(state,id));
    eq(state.tray, [ids[0],ids[2],ids[1]]);
    G.pick(state,ids[3]); eq(state.tray,[ids[1]]); eq(state.eliminated,3); G.assertConservation(state);
  });
  await test('第七张形成三消：先消除，留下四张，不判失败', () => {
    const {state, ids} = fixture(['panda','panda','rabbit','rabbit','lion','lion','panda']);
    ids.slice(0,6).forEach(id => G.pick(state,id)); eq(state.tray.length,6);
    const pending = G.beginPick(state,ids[6]); eq(state.tray.length,7); eq(state.status,'settling');
    G.assertConservation(state); G.finishPick(state,pending);
    eq(state.tray.length,4); eq(state.status,'playing'); eq(state.eliminated,3); G.assertConservation(state);
  });
  await test('第七张无法消除：判失败，拒绝第八张和后续操作', () => {
    const {state, ids} = fixture(['panda','panda','rabbit','rabbit','lion','lion','frog','octopus']);
    ids.slice(0,7).forEach(id => G.pick(state,id));
    eq(state.status,'lost'); eq(state.tray.length,7); check(!G.pick(state,ids[7])); G.assertConservation(state);
  });
  await test('快速连点锁定、同牌最多一次、结算前不写入存档', async () => {
    const store = memoryStore(), session = new GameSession(store, () => {}, 20);
    session.start(deal); const saved = store.getItem();
    const pending = session.choose(deal.solution[0]);
    check(!(await session.choose(deal.solution[0]))); check(!(await session.choose(deal.solution[1])));
    eq(session.state.tray.length,1); eq(store.getItem(), saved);
    await pending; check(!(await session.choose(deal.solution[0]))); eq(session.state.history.length,1);
    check(store.getItem() !== saved);
  });
  await test('重玩保留位置与分配；动画中重开不受旧回调干扰', async () => {
    const session = new GameSession(memoryStore(), () => {}, 20); session.start(deal);
    const old = session.choose(deal.solution[0]); session.replay();
    await old; eq(session.state, G.makeState(deal)); eq(session.deal, deal);
  });
  await test('换局清空全部状态，旧动画不能污染新局', async () => {
    const session = new GameSession(memoryStore(), () => {}, 20); session.start(deal);
    const old = session.choose(deal.solution[0]), next = G.generate(999);
    session.start(next); await old;
    eq(session.state,G.makeState(next)); check(JSON.stringify(next.tiles)!==JSON.stringify(deal.tiles));
  });
  await test('有效存档恢复全部状态，初始牌局保持一致', async () => {
    const store = memoryStore(), a = new GameSession(store, () => {}, 0); a.start(deal);
    for (const id of deal.solution.slice(0,12)) await a.choose(id);
    const b = new GameSession(store); check(b.restore()); eq(a.state,b.state); eq(a.deal,b.deal);
  });
  await test('损坏、错误版本、动物、数量、位置、伪造操作历史均拒绝', () => {
    check(G.unpack('not json')===null); check(G.unpack('null')===null);
    const valid = G.pack(deal,G.makeState(deal));
    const edits = [d => d.version++, d => d.deal.tiles.pop(), d => d.deal.tiles[0].animalId='bee',
      d => d.deal.tiles[0].x=9, d => d.state.eliminated=3, d => d.state.history.push('tile-0'),
      d => d.state.status='won', d => d.state.tray.push('tile-28'), d=>d.deal.cmin++,
      d=>d.deal.capacity++, d=>d.state.capacity++, d=>d.progress.wins++, d=>d.progress.credited=true];
    for (const edit of edits) { const d=G.clone(valid); edit(d); check(G.unpack(JSON.stringify(d))===null); }
    const store=memoryStore(); store.setItem('', '{}'); const session=new GameSession(store);
    check(!session.restore()); session.start(deal); eq(session.state.status,'playing');
  });
  await test('存储不可用仍能正常开始、选牌和重玩', async () => {
    const broken = {getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
    const s=new GameSession(broken,()=>{},0); check(!s.restore()); s.start(deal);
    await s.choose(deal.solution[0]); check(s.storageUnavailable); eq(s.state.history.length,1); s.replay();
  });
  await test('获胜后不能选牌，胜负状态可保存恢复', () => {
    const state=G.makeState(deal); deal.solution.forEach(id=>G.pick(state,id));
    eq(state.status,'won'); check(!G.pick(state,deal.solution[0]));
    eq(G.unpack(JSON.stringify(G.pack(deal,state))).state,state);
  });
  let frame, win, doc;
  await test('直接 file:// 打开真实页面，全部动物图片正确加载', async () => {
    localStorage.removeItem(G.CONFIG.saveKey);
    frame=document.createElement('iframe'); frame.style.cssText='width:1000px;height:1000px;border:0';
    frame.src='../index.html'; document.body.append(frame);
    await new Promise(resolve=>frame.onload=resolve); await wait(100);
    win=frame.contentWindow; doc=frame.contentDocument;
    win.addEventListener('error',e=>testErrors.push(e.message));
    win.addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));
    eq(win.location.protocol,'file:'); check(win.AnimalApp.session.state.status==='playing');
    const images = Object.values(G.ANIMALS).map(a=>new Promise((resolve,reject)=>{
      const img=new Image(); img.onload=()=>img.naturalWidth===256?resolve():reject(Error(a.id));
      img.onerror=()=>reject(Error(a.id)); img.src='../'+a.image;
    })); await Promise.all(images);
    check([...doc.images].every(img=>img.complete && img.naturalWidth>0));
  });
  await test('桌面与 360px 手机布局：动态格数无溢出，超过七格换行且保持方正', async () => {
    for (const width of [1000,360]) {
      frame.style.width=width+'px'; await wait(50);
      eq(win.innerWidth,width); check(doc.documentElement.scrollWidth<=width);
      for(const t of G.CONFIG.layoutTemplates) for(const wins of [0,3,8]) {
        win.AnimalApp.session.start(G.generate(42,{templateId:t.id,wins,attempts:0}));
        const slots=[...doc.querySelectorAll('.slot')]; eq(slots.length,win.AnimalApp.session.state.capacity);
        const rects=slots.map(s=>s.getBoundingClientRect());
        check(rects.every(r=>r.right<=width && r.left>=0 && Math.abs(r.width-r.height)<1));
        if(slots.length>7) check(rects[7].top>rects[0].bottom);
      }
      const b=doc.getElementById('board').getBoundingClientRect();
      check(b.bottom<doc.querySelector('.tray-area').getBoundingClientRect().top);
      check([...doc.querySelectorAll('.tile')].every(t=>{const r=t.getBoundingClientRect(); return r.left>=b.left-1 && r.right<=b.right+1 && r.bottom<=b.bottom+1;}));
    }
  });
  await test('三套模板桌面/360px及镜像：渲染矩形、高度、样式与实际可点判定一致',async()=>{
    const s=win.AnimalApp.session;
    for(const template of G.CONFIG.layoutTemplates) for(const variant of [0,3]) for(const width of [1000,360]) {
      frame.style.width=width+'px'; await wait(20);
      s.start(G.generate(84,{templateId:template.id,variant}));
      const board=doc.getElementById('board').getBoundingClientRect();
      const map=new Map([...doc.querySelectorAll('.tile')].map(b=>[b.dataset.id,b]));
      const tiles=s.state.tiles;
      eq(map.size,36); check(doc.documentElement.scrollWidth<=width);
      const scale=board.width/Math.max(...tiles.map(t=>t.x+1));
      check(scale>=60,'手机牌宽不足 60px');
      for(const tile of tiles) {
        const button=map.get(tile.id), rect=button.getBoundingClientRect();
        check(Math.abs(rect.left-board.left-tile.x*scale)<.6 && Math.abs(rect.top-board.top-tile.y*scale)<.6);
        check(Math.abs(rect.width-scale)<.6 && Math.abs(rect.height-scale)<.6);
        eq(Number(win.getComputedStyle(button).zIndex),tile.layer+1);
        eq(win.getComputedStyle(button).transform,'none');
        const blocked=tiles.some(other=>{
          if(other.layer<=tile.layer)return false;
          const r=map.get(other.id).getBoundingClientRect();
          return Math.min(rect.right,r.right)-Math.max(rect.left,r.left)>.6 && Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top)>.6;
        });
        eq(G.canPick(s.state,tile),!blocked);
        eq(button.classList.contains('blocked'),blocked);
        eq(button.getAttribute('aria-disabled'),String(blocked));
      }
    }
  });
  await test('全部模板的完全隐藏牌保留在原位置，不泄露动物名，并随移除自然露出',async()=>{
    const s=win.AnimalApp.session; s.delay=0;
    for(const template of G.CONFIG.layoutTemplates) {
      const d=G.generate(2026,{templateId:template.id,variant:0}); s.start(d);
      const hidden=s.state.tiles.filter(t=>G.visibleFraction(s.state,t)===0);
      check(hidden.length>0);
      const oldPositions=new Map();
      for(const tile of hidden) {
        const button=doc.querySelector(`[data-id="${tile.id}"]`);
        eq(button.getAttribute('aria-label'),'尚未露出的动物牌'); eq(button.querySelector('img').alt,'');
        eq(button.getAttribute('title'),null); eq(win.getComputedStyle(button).visibility,'hidden');
        oldPositions.set(tile.id,[button.style.left,button.style.top]);
      }
      let revealed=false;
      for(const id of d.solution) {
        await s.choose(id);
        for(const tile of hidden) {
          const current=s.state.tiles.find(t=>t.id===tile.id);
          if(current.state==='board' && G.visibleFraction(s.state,current)>0) {
            const button=doc.querySelector(`[data-id="${tile.id}"]`);
            eq([button.style.left,button.style.top],oldPositions.get(tile.id));
            eq(win.getComputedStyle(button).visibility,'visible');
            eq(button.querySelector('img').alt,G.ANIMALS[tile.animalId].name); revealed=true;
          }
        }
        if(revealed)break;
      }
      check(revealed);
    }
  });
  await test('点击露出的被遮挡牌不穿透；真实按钮连点只加入一次；收纳牌点击无操作', async () => {
    const session=win.AnimalApp.session; session.start(deal); session.delay=10;
    const blocked=doc.querySelector('.blocked'); blocked.click(); eq(session.state.history.length,0);
    // 实际命中测试：在牌面暴露区域寻找被遮挡元素，点击不得改变状态。
    let exposed=false;
    for(const button of doc.querySelectorAll('.blocked')) {
      const r=button.getBoundingClientRect();
      for(const dx of [0.1,0.5,0.9]) for(const dy of [0.1,0.5,0.9]) {
        const target=doc.elementFromPoint(r.left+r.width*dx,r.top+r.height*dy);
        if(target?.closest('.tile')===button) { target.click(); exposed=true; }
      }
    }
    check(exposed); eq(session.state.history.length,0);
    const tile=doc.querySelector(`[data-id="${deal.solution[0]}"]`); tile.click(); tile.click();
    eq(session.state.history.length,1); await wait(30);
    const before=JSON.stringify(session.state); doc.querySelector('.tray-tile').click();
    eq(JSON.stringify(session.state),before); eq(doc.querySelectorAll('.slot').length,session.state.capacity);
  });
  await test('真实页面刷新恢复最近有效进度', async () => {
    const previous=G.clone(win.AnimalApp.session.state);
    const loaded=new Promise(resolve=>frame.onload=resolve); win.location.reload(); await loaded; await wait(50);
    win=frame.contentWindow; doc=frame.contentDocument; eq(win.AnimalApp.session.state,previous);
  });
  await test('系统减少动态效果设置正确传递到动画时长', () => {
    eq(win.AnimalApp.session.delay, win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  });
  await test('真实重玩确认可取消，确认后恢复同局；换局重置', async () => {
    const original=G.clone(win.AnimalApp.session.deal);
    doc.getElementById('replay').click(); check(doc.getElementById('modal').open);
    doc.querySelector('#modal-actions button').click(); eq(win.AnimalApp.session.state.history.length,1);
    doc.getElementById('replay').click(); doc.querySelector('#modal-actions .primary').click();
    eq(win.AnimalApp.session.deal,original); eq(win.AnimalApp.session.state.history.length,0);
    doc.getElementById('new-game').click(); doc.querySelector('#modal-actions .primary').click(); await wait(100);
    eq(win.AnimalApp.session.state.history.length,0); check(JSON.stringify(win.AnimalApp.session.deal.tiles)!==JSON.stringify(original.tiles));
    check(win.AnimalApp.session.deal.templateId!==original.templateId);
  });
  await test('通过真实牌按钮回放 36 步，胜利弹窗及再玩一局正常', async () => {
    const s=win.AnimalApp.session; s.start(deal); s.delay=0;
    for(const id of deal.solution) {
      const tile=doc.querySelector(`[data-id="${id}"]`); check(tile && tile.getAttribute('aria-disabled')==='false');
      tile.click(); await wait(5); G.assertConservation(s.state);
    }
    eq(s.state.status,'won'); check(doc.getElementById('modal').open);
    eq(doc.getElementById('modal-title').textContent,'太棒啦，动物都找到伙伴了！');
    eq(doc.querySelectorAll('.slot').length,s.state.capacity); eq(doc.querySelectorAll('.tile').length,0);
    eq(s.wins,deal.winsAtStart+1);
    doc.querySelector('#modal-actions .primary').click(); await wait(100);
    eq(s.state.status,'playing'); eq(s.state.tiles.length,36); check(!doc.getElementById('modal').open);
    eq(s.deal.winsAtStart,deal.winsAtStart+1);
  });
  await test('存在真实合法失败路径，五/六张提示、失败弹窗和免确认重玩正常', async () => {
    let failure;
    for(let seed=0;seed<100 && !failure;seed++) {
      const state=G.makeState(deal), random=G.rng(seed), path=[];
      for(let step=0;step<36 && state.status==='playing';step++) {
        const choices=state.tiles.filter(t=>G.canPick(state,t));
        const tile=choices[Math.floor(random()*choices.length)]; path.push(tile.id); G.pick(state,tile.id);
      }
      if(state.status==='lost') failure=path;
    }
    check(failure); const s=win.AnimalApp.session; s.start(deal); s.delay=0;
    let saw5=false,saw6=false;
    for(const id of failure) {
      doc.querySelector(`[data-id="${id}"]`).click(); await wait(5);
      if(s.state.tray.length===s.state.capacity-2) {check(doc.getElementById('hint').textContent.includes('空位不多'));saw5=true;}
      if(s.state.tray.length===s.state.capacity-1) {eq(doc.getElementById('hint').textContent,'只剩 1 个空位啦，仔细想一想');saw6=true;}
    }
    check(saw5 && saw6); eq(s.state.status,'lost'); check(doc.getElementById('modal').open);
    eq(doc.getElementById('modal-title').textContent,'收纳栏装满啦，再试一次吧！');
    doc.querySelector('#modal-actions button').click(); check(!doc.getElementById('modal').open);
    eq(s.state,G.makeState(deal));
  });
  await test('损坏存档刷新后安全创建新局',async()=>{
    win.localStorage.setItem(G.CONFIG.saveKey,'{broken');
    const loaded=new Promise(resolve=>frame.onload=resolve); win.location.reload(); await loaded; await wait(100);
    win=frame.contentWindow; doc=frame.contentDocument;
    const s=win.AnimalApp.session;
    eq(s.state.status,'playing'); eq(s.state.history.length,0); G.validateDeal(s.deal);
  });
  await test('旧三层矩形存档自动升级、新局提示、再次刷新保持新版布局',async()=>{
    const oldTiles=[];
    [[4,4,0,0],[4,3,.54,.54],[4,2,.27,.81]].forEach(([cols,rows,x,y],layer)=>{
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)oldTiles.push({id:`tile-${oldTiles.length}`,x:x+c*1.08,y:y+r*1.08,width:1,height:1,layer,animalId:G.CONFIG.enabledAnimalIds[Math.floor(oldTiles.length/6)],state:'board'});
    });
    const legacy={version:1,deal:{seed:1,tiles:oldTiles},state:{status:'playing'}};
    check(G.unpack(JSON.stringify(legacy))===null);
    win.localStorage.removeItem(G.CONFIG.saveKey);
    win.localStorage.setItem(G.CONFIG.legacySaveKey,JSON.stringify(legacy));
    let loaded=new Promise(resolve=>frame.onload=resolve); win.location.reload(); await loaded; await wait(100);
    win=frame.contentWindow; doc=frame.contentDocument;
    check(doc.getElementById('storage-note').textContent.includes('棋盘已更新'));
    const current=G.clone(win.AnimalApp.session.deal); G.validateDeal(current);
    eq(JSON.parse(win.localStorage.getItem(G.CONFIG.saveKey)).version,G.CONFIG.saveVersion);
    loaded=new Promise(resolve=>frame.onload=resolve); win.location.reload(); await loaded; await wait(50);
    win=frame.contentWindow; doc=frame.contentDocument;
    eq(win.AnimalApp.session.deal,current);
    check(!doc.getElementById('storage-note').textContent.includes('棋盘已更新'));
    win.localStorage.removeItem(G.CONFIG.legacySaveKey);
  });
  await test('真实页面存储被禁止时仍可换局、选牌并显示简短提示',async()=>{
    const original=Object.getOwnPropertyDescriptor(win,'localStorage');
    try {
      Object.defineProperty(win,'localStorage',{configurable:true,get(){throw Error('Storage disabled');}});
      await win.AnimalApp.newGame();
      const s=win.AnimalApp.session; eq(s.state.status,'playing'); s.delay=0;
      await s.choose(s.deal.solution[0]); eq(s.state.history.length,1);
      check(doc.getElementById('storage-note').textContent.includes('无法保存'));
    } finally {
      Object.defineProperty(win,'localStorage',original);
      win.AnimalApp.session.replay();
    }
  });
  await test('无未处理的 JavaScript 异常',()=>eq(testErrors,[]));
  if(frame) frame.remove();
  out.textContent=results.join('\n')+`\n\n${failures ? 'FAILED '+failures : 'ALL PASS'} (${results.filter(s=>s.startsWith('PASS')).length} tests)`;
})();
