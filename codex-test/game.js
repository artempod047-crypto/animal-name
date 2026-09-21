(function (global) {
  'use strict';
  const ANIMALS = Object.fromEntries([
    ['panda', '熊猫'], ['rabbit', '兔子'], ['elephant', '大象'], ['giraffe', '长颈鹿'],
    ['lion', '狮子'], ['penguin', '企鹅'], ['frog', '青蛙'], ['turtle', '乌龟'],
    ['octopus', '章鱼'], ['crab', '螃蟹'], ['butterfly', '蝴蝶'], ['bee', '蜜蜂']
  ].map(([id, name]) => [id, { id, name, image: `assets/animals/${id}.png` }]));
  const CONFIG = {
    enabledAnimalIds: ['panda', 'rabbit', 'elephant', 'lion', 'frog', 'octopus'],
    copiesPerAnimal: 6, constructionCapacity: 7, maxHeightLevels: 6,
    layoutVersion: 3, layoutTemplates: global.AnimalLayouts,
    generationAttempts: 400, generationBudgetMs: 70, solverBudgetMs: 20,
    solverMaxNodes: 60000,
    difficultySteps: [{ wins: 0, extra: 3 }, { wins: 3, extra: 2 }, { wins: 8, extra: 1 }],
    saveVersion: 3, saveKey: 'animal-station-save-v3', legacySaveKey: 'animal-station-save-v2'
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  function positions(templateId = CONFIG.layoutTemplates[0].id, variant = 0) {
    const template = CONFIG.layoutTemplates.find(t => t.id === templateId);
    assert(template && Number.isInteger(variant) && variant >= 0 && variant < 4, '布局模板或镜像无效');
    const tiles = [];
    template.levels.forEach((points, layer) => points.forEach(([x, y]) => tiles.push({
      id: `tile-${tiles.length}`, animalId: null, x: x/template.grid, y: y/template.grid,
      width: 1, height: 1, layer, state: 'board'
    })));
    const minX = Math.min(...tiles.map(t => t.x)), minY = Math.min(...tiles.map(t => t.y));
    const maxX = Math.max(...tiles.map(t => t.x)), maxY = Math.max(...tiles.map(t => t.y));
    tiles.forEach(t => {
      t.x = variant & 1 ? maxX-t.x : t.x-minX;
      t.y = variant & 2 ? maxY-t.y : t.y-minY;
    });
    return tiles;
  }
  function validateConfig() {
    const ids = CONFIG.enabledAnimalIds;
    assert(ids.length && new Set(ids).size === ids.length && ids.every(id => ANIMALS[id]), '动物配置无效');
    assert(Number.isInteger(CONFIG.copiesPerAnimal) && CONFIG.copiesPerAnimal > 0 && CONFIG.copiesPerAnimal % 3 === 0, '每种牌数须为 3 的正倍数');
    assert(CONFIG.constructionCapacity >= 3 && Number.isInteger(CONFIG.constructionCapacity), '构造容量无效');
    assert(CONFIG.difficultySteps[0]?.wins === 0 && CONFIG.difficultySteps.every((s,i,a) =>
      Number.isInteger(s.wins) && Number.isInteger(s.extra) && s.extra >= 0 && (!i || s.wins > a[i-1].wins)), '难度参数无效');
    assert(CONFIG.layoutTemplates?.length >= 3, '至少需要三套结构模板');
    CONFIG.layoutTemplates.forEach(template => validateGeometry(positions(template.id)));
  }
  function overlaps(a, b) {
    return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  }
  function canPick(state, tile) {
    return !!tile && tile.state === 'board' && !state.tiles.some(other =>
      other.state === 'board' && other.layer > tile.layer && overlaps(tile, other));
  }
  // 按所有高层矩形的并集精确计算可见面积，仅用于绘制和结构验证，不用于额外锁牌。
  function visibleFraction(state, tile) {
    const blockers = state.tiles.filter(t => t.state === 'board' && t.layer > tile.layer && overlaps(tile, t));
    const xs = [...new Set([tile.x, tile.x+tile.width, ...blockers.flatMap(t => [Math.max(tile.x,t.x), Math.min(tile.x+tile.width,t.x+t.width)])])].sort((a,b)=>a-b);
    const ys = [...new Set([tile.y, tile.y+tile.height, ...blockers.flatMap(t => [Math.max(tile.y,t.y), Math.min(tile.y+tile.height,t.y+t.height)])])].sort((a,b)=>a-b);
    let visible = 0;
    for (let x=0;x<xs.length-1;x++) for (let y=0;y<ys.length-1;y++) {
      const px=(xs[x]+xs[x+1])/2, py=(ys[y]+ys[y+1])/2;
      if (!blockers.some(t=>px>t.x && px<t.x+t.width && py>t.y && py<t.y+t.height)) visible+=(xs[x+1]-xs[x])*(ys[y+1]-ys[y]);
    }
    return visible/(tile.width*tile.height);
  }
  function analyzeGeometry(tiles) {
    const above = tiles.map(a=>tiles.map((b,j)=>b.layer>a.layer && overlaps(a,b)?j:-1).filter(j=>j>=0));
    const below = tiles.map(a=>tiles.map((b,j)=>b.layer<a.layer && overlaps(a,b)?j:-1).filter(j=>j>=0));
    const depths = new Array(tiles.length);
    function depth(i) { return depths[i] ?? (depths[i]=1+Math.max(0,...below[i].map(depth))); }
    tiles.forEach((_,i)=>depth(i));
    function largestComponent(skip=-1) {
      const remaining=new Set(tiles.map((_,i)=>i).filter(i=>i!==skip));
      let largest=0;
      // 循环严格受牌位数限制，每张牌最多出队一次。
      for (const start of [...remaining]) {
        if (!remaining.delete(start)) continue;
        const queue=[start];
        for (let q=0;q<queue.length;q++) for (const j of [...above[queue[q]],...below[queue[q]]]) {
          if(remaining.delete(j)) queue.push(j);
        }
        largest=Math.max(largest,queue.length);
      }
      return largest;
    }
    const visible=tiles.map(t=>visibleFraction({tiles},t));
    const open=tiles.map((_,i)=>i).filter(i=>!above[i].length);
    return { above, below, depths, open, visible, maxDepth:Math.max(...depths),
      largestComponent:largestComponent(), worstRemovalComponent:Math.min(...tiles.map((_,i)=>largestComponent(i))),
      forks:below.filter(a=>a.length>=2).length, merges:above.filter(a=>a.length>=2).length,
      hidden:visible.filter(v=>v===0).length, corners:visible.filter(v=>v>0 && v<=.25).length,
      partial:visible.filter(v=>v>.25 && v<1).length };
  }
  function validateGeometry(tiles) {
    assert(tiles.length === CONFIG.enabledAnimalIds.length*CONFIG.copiesPerAnimal && tiles.length%3===0, '总牌数与布局不匹配');
    assert(new Set(tiles.map(t=>t.id)).size===tiles.length, '牌 id 重复');
    assert(tiles.every(t=>Number.isFinite(t.x) && Number.isFinite(t.y) && t.x>=0 && t.y>=0 && t.width===1 && t.height===1 && Number.isInteger(t.layer) && t.layer>=0 && t.layer<CONFIG.maxHeightLevels), '坐标或高度无效');
    assert(!tiles.some(a=>tiles.some(b=>a.id!==b.id && a.layer===b.layer && overlaps(a,b))), '同层牌重叠');
    const stats=analyzeGeometry(tiles);
    assert(stats.maxDepth>=5 && stats.maxDepth<=6, '真实遮挡链深度不符');
    assert(stats.open.length>=6 && stats.open.length<=12, '开局入口须为 6～12 张');
    assert(stats.open.some(i=>stats.depths[i]>=2 && stats.depths[i]<=3), '缺少浅堆');
    assert(new Set(stats.open.map(i=>tiles[i].layer)).size>=2, '入口高度过于单一');
    assert(stats.largestComponent>=30 && stats.worstRemovalComponent>=24, '主棋盘连接过于分散或依赖单张牌');
    assert(stats.forks>=2 && stats.merges>=2, '缺少多处交错连接');
    assert(stats.hidden>0 && stats.corners>0 && stats.partial>0, '缺少不同遮挡程度');
    assert(tiles.every((t,i)=>t.layer===0 || stats.below[i].length>0), '高层牌没有实际下层支撑');
    return stats;
  }
  function makeState(deal) {
    return { tiles: clone(deal.tiles), capacity: deal.capacity ?? CONFIG.constructionCapacity,
      tray: [], eliminated: 0, status: 'playing', history: [] };
  }
  // 正式结算与搜索共用：先三消，再用结算后的占用量判断失败。
  const settledSize = (size, sameCount) => size + 1 - (sameCount === 2 ? 3 : 0);
  const isFull = (size, capacity) => size >= capacity;
  function beginPick(state, id) {
    const tile = state.tiles.find(t => t.id === id);
    if (state.status !== 'playing' || isFull(state.tray.length, state.capacity) || !canPick(state, tile)) return null;
    state.status = 'settling';
    tile.state = 'tray';
    let last = -1;
    state.tray.forEach((otherId, i) => {
      if (state.tiles.find(t => t.id === otherId).animalId === tile.animalId) last = i;
    });
    state.tray.splice(last < 0 ? state.tray.length : last+1, 0, id);
    state.history.push(id);
    const matches = state.tray.filter(otherId => state.tiles.find(t => t.id === otherId).animalId === tile.animalId);
    return { id, matches: matches.length >= 3 ? matches.slice(0, 3) : [],
      settledSize: settledSize(state.tray.length-1, matches.length-1) };
  }
  function finishPick(state, pending) {
    assert(state.status === 'settling' && pending, '结算状态错误');
    for (const id of pending.matches) state.tiles.find(t => t.id === id).state = 'removed';
    state.tray = state.tray.filter(id => !pending.matches.includes(id));
    state.eliminated += pending.matches.length;
    assert(state.tray.length === pending.settledSize, '三消结算不一致');
    state.status = isFull(state.tray.length, state.capacity) ? 'lost' :
      (state.tiles.every(t => t.state !== 'board') && state.tray.length === 0 ? 'won' : 'playing');
    return state.status;
  }
  function pick(state, id) {
    const pending = beginPick(state, id);
    if (!pending) return false;
    finishPick(state, pending);
    return true;
  }
  function rng(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = Math.imul(value ^ value >>> 15, 1 | value);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function extraSlots(wins) {
    return CONFIG.difficultySteps.filter(s => wins >= s.wins).at(-1).extra;
  }
  function searchGraph(tiles) {
    assert(tiles.length > 0 && tiles.length <= 36, '求解器支持 1～36 张牌');
    const names = [...new Set(tiles.map(t => t.animalId))];
    const types = tiles.map(t => names.indexOf(t.animalId));
    const bits = tiles.map((_,i) => 2 ** (i < 30 ? i : i-30));
    const above = tiles.map(a => tiles.flatMap((b,j) => b.layer > a.layer && overlaps(a,b) ? [j] : []));
    return { tiles, types, bits, above,
      low: above.map(up => up.reduce((m,j) => j < 30 ? m | bits[j] : m, 0)),
      high: above.map(up => up.reduce((m,j) => j >= 30 ? m | bits[j] : m, 0)),
      typeCount: names.length, key: JSON.stringify([types, above]) };
  }
  function searchCapacity(graph, capacity, budget) {
    const { tiles, types, bits, low, high } = graph;
    const held = new Array(graph.typeCount).fill(0), dead = new Set(), path = [];
    // 移出棋盘的牌集合唯一决定每种动物的数量 mod 3，因此无需把篮子排列放入记忆键。
    // 使用两个 30/6 位掩码，避免 JS 的 32 位位运算截断第 33～36 张牌。
    const unknown = Symbol('unknown');
    function visit(lo, hi, size) {
      if (++budget.nodes > budget.maxNodes || performance.now() >= budget.deadline) return unknown;
      if (path.length === tiles.length) return size === 0;
      const key = lo + hi * 2 ** 30;
      if (dead.has(key)) return false;
      const choices = [];
      for (let i=0; i<tiles.length; i++) {
        if ((i<30 ? lo : hi) & bits[i]) continue;
        if ((lo & low[i]) !== low[i] || (hi & high[i]) !== high[i]) continue;
        if (!isFull(settledSize(size, held[types[i]]), capacity)) choices.push(i);
      }
      // 只调整遍历顺序，不丢弃任何合法分支。
      choices.sort((a,b) => held[types[b]]-held[types[a]]);
      for (const i of choices) {
        const type = types[i], before = held[type], next = settledSize(size,before);
        held[type] = (before+1)%3; path.push(i);
        const result = visit(i<30 ? lo|bits[i] : lo, i>=30 ? hi|bits[i] : hi, next);
        if (result === true) return true;
        path.pop(); held[type] = before;
        if (result === unknown) return unknown;
      }
      dead.add(key);
      return false;
    }
    const result = visit(0,0,0);
    return { status: result === unknown ? 'unknown' : result ? 'solvable' : 'unsolvable',
      solution: result === true ? path.map(i=>tiles[i].id) : null, nodes: budget.nodes };
  }
  function searchBudget(options = {}) {
    return { nodes: 0, maxNodes: options.maxNodes ?? CONFIG.solverMaxNodes,
      deadline: performance.now() + (options.budgetMs ?? CONFIG.solverBudgetMs) };
  }
  function solveCapacity(tiles, capacity, options = {}) {
    assert(Number.isInteger(capacity) && capacity >= 1, '搜索容量无效');
    return searchCapacity(searchGraph(tiles), capacity, searchBudget(options));
  }
  const exactCache = new Map();
  function minimumCapacity(tiles, options = {}) {
    const graph = searchGraph(tiles), budget = searchBudget(options);
    if (options.useCache !== false && exactCache.has(graph.key)) {
      const cached = exactCache.get(graph.key);
      return { ...cached, solution: cached.indices.map(i=>tiles[i].id), cached: true };
    }
    const upperBound = options.upperBound ?? CONFIG.constructionCapacity;
    for (let capacity=1; capacity<=upperBound; capacity++) {
      const result = searchCapacity(graph, capacity, budget);
      if (result.status === 'unknown') return { status: 'unknown', nodes: budget.nodes };
      if (result.status === 'solvable') {
        const exact = { status: 'exact', cmin: capacity, nodes: budget.nodes,
          indices: result.solution.map(id=>tiles.findIndex(t=>t.id===id)) };
        if (exactCache.size >= 256) exactCache.delete(exactCache.keys().next().value);
        exactCache.set(graph.key, exact);
        return { ...exact, solution: result.solution };
      }
    }
    return { status: 'unsolvable', throughCapacity: upperBound, nodes: budget.nodes };
  }
  function setDifficulty(deal, proof, wins) {
    assert(proof.status === 'exact', '未证明最低容量');
    Object.assign(deal, { cmin: proof.cmin, extra: extraSlots(wins), winsAtStart: wins,
      capacity: proof.cmin + extraSlots(wins), solution: proof.solution });
    return deal;
  }
  function validateDeal(deal, checkCapacity = true) {
    assert(deal && typeof deal.templateId === 'string', '缺少布局模板');
    const expected = positions(deal.templateId, deal.variant);
    assert(deal && Array.isArray(deal.tiles) && deal.tiles.length === expected.length, '牌局结构错误');
    const counts = Object.fromEntries(CONFIG.enabledAnimalIds.map(id => [id, 0]));
    deal.tiles.forEach((t, i) => {
      for (const key of ['id', 'x', 'y', 'width', 'height', 'layer', 'state']) assert(t[key] === expected[i][key], '牌位置或状态错误');
      assert(Object.hasOwn(counts, t.animalId), '未知动物');
      counts[t.animalId]++;
    });
    assert(Object.values(counts).every(n => n === CONFIG.copiesPerAnimal), '动物牌数错误');
    if (checkCapacity) {
      assert(Number.isSafeInteger(deal.winsAtStart) && deal.winsAtStart >= 0, '通关次数无效');
      assert(Number.isInteger(deal.cmin) && deal.cmin >= 3 && deal.cmin <= CONFIG.constructionCapacity, '最低容量无效');
      // 余量在开局时固定；修改调参表不改变已经开始的关卡。
      assert(Number.isInteger(deal.extra) && deal.extra >= 0 && deal.extra <= 12 && deal.capacity === deal.cmin+deal.extra, '关卡容量无效');
      const proof = minimumCapacity(deal.tiles, { budgetMs: 100, upperBound: deal.cmin });
      assert(proof.status === 'exact' && proof.cmin === deal.cmin, '最低容量验证未通过');
    }
    const initial = makeState(deal);
    const top = {};
    initial.tiles.filter(t => canPick(initial, t)).forEach(t => { top[t.animalId] = (top[t.animalId] || 0)+1; });
    assert(Object.values(top).every(n => n <= 2), '开局同类超过两张');
    for (let layer = 0; layer < CONFIG.maxHeightLevels; layer++) {
      const list = deal.tiles.filter(t => t.layer === layer);
      for (const axis of ['x', 'y']) for (const coord of new Set(list.map(t => t[axis]))) {
        const line = list.filter(t => t[axis] === coord);
        if (line.length >= 3) assert(new Set(line.map(t => t.animalId)).size > 1, '同类整行或整列');
      }
    }
    // 同一种动物须分布在不同深度；不允许三个同类沿局部相邻高度直接叠在一起。
    for (const id of CONFIG.enabledAnimalIds) assert(new Set(deal.tiles.filter(t=>t.animalId===id).map(t=>t.layer)).size>=2, '同类集中在单一高度');
    for (const middle of deal.tiles) {
      const lower=deal.tiles.some(t=>t.layer===middle.layer-1 && t.animalId===middle.animalId && overlaps(t,middle));
      const upper=deal.tiles.some(t=>t.layer===middle.layer+1 && t.animalId===middle.animalId && overlaps(t,middle));
      assert(!(lower && upper), '局部连续三张同类');
    }
    assert(Array.isArray(deal.solution) && deal.solution.length === expected.length, '缺少通关路径');
    for (const id of deal.solution) {
      assert(pick(initial, id), '通关路径包含非法点击');
      assert(initial.status !== 'lost', '通关路径溢出');
      assertConservation(initial);
    }
    assert(initial.status === 'won', '通关路径未清空');
    return true;
  }
  function assertConservation(state) {
    assert(state.tiles.filter(t => t.state === 'board').length + state.tray.length + state.eliminated === CONFIG.enabledAnimalIds.length*CONFIG.copiesPerAnimal, '牌数不守恒');
  }
  function candidate(random, seed, templateId, variant) {
    const tiles = positions(templateId, variant);
    const initialOpen = new Set(tiles.filter(t=>canPick({tiles},t)).map(t=>t.id));
    const working = { tiles: clone(tiles) };
    const order = [];
    for (let i = 0; i < tiles.length; i++) {
      const available = working.tiles.filter(t => canPick(working, t));
      const newlyOpen = available.filter(t => !initialOpen.has(t.id));
      const pool = newlyOpen.length && random() < 0.6 ? newlyOpen : available;
      const tile = pool[Math.floor(random()*pool.length)];
      tile.state = 'removed';
      order.push(tile.id);
    }
    const remaining = Object.fromEntries(CONFIG.enabledAnimalIds.map(id => [id, CONFIG.copiesPerAnimal]));
    const held = Object.fromEntries(CONFIG.enabledAnimalIds.map(id => [id, 0]));
    const topCounts = { ...held };
    let heldTotal = 0;
    for (const id of order) {
      const tile = tiles.find(t => t.id === id);
      const top = initialOpen.has(tile.id);
      const options = CONFIG.enabledAnimalIds.filter(animal => remaining[animal] > 0 &&
        (!top || topCounts[animal] < 2) && settledSize(heldTotal, held[animal]) < CONFIG.constructionCapacity);
      if (!options.length) return null;
      const animal = options[Math.floor(random()*options.length)];
      tile.animalId = animal;
      remaining[animal]--;
      if (top) topCounts[animal]++;
      held[animal]++;
      heldTotal++;
      if (held[animal] === 3) { held[animal] = 0; heldTotal -= 3; }
    }
    // 路径需有交错，不要求按全场统一高度推进。
    const sequence = order.map(id => tiles.find(t => t.id === id));
    if (!sequence.some((t, i) => i > 1 && t.animalId === sequence[i-2].animalId && t.animalId !== sequence[i-1].animalId)) return null;
    return { seed, templateId, variant, tiles, solution: order };
  }
  function generate(seed, options = {}) {
    validateConfig();
    const random = rng(seed);
    const choices=CONFIG.layoutTemplates.filter(t=>t.id!==options.excludeTemplateId);
    const templateId=options.templateId ?? choices[Math.floor(random()*choices.length)].id;
    const variant=options.variant ?? Math.floor(random()*4);
    validateGeometry(positions(templateId,variant));
    const started = performance.now();
    const wins = options.wins ?? 0;
    assert(Number.isSafeInteger(wins) && wins >= 0, '通关次数无效');
    const attempts = options.attempts ?? CONFIG.generationAttempts;
    for (let attempt = 0; attempt < attempts && performance.now()-started < CONFIG.generationBudgetMs; attempt++) {
      const deal = candidate(random, seed, templateId, variant);
      if (!deal) continue;
      try {
        validateDeal(deal, false);
        const proof = minimumCapacity(deal.tiles, { budgetMs: Math.min(CONFIG.solverBudgetMs,
          Math.max(0, CONFIG.generationBudgetMs-(performance.now()-started))) });
        if (proof.status !== 'exact') continue;
        setDifficulty(deal, proof, wins);
        validateDeal(deal);
        return deal;
      } catch (_) { /* 在预算内重试；超时绝不当作无解或精确最小值 */ }
    }
    assert(global.AnimalFallbacks?.[templateId], '未找到与配置匹配的备用牌局');
    const deal = clone(global.AnimalFallbacks[templateId]);
    const geometry=positions(templateId,variant);
    deal.tiles.forEach((t,i)=>Object.assign(t,{x:geometry[i].x,y:geometry[i].y}));
    deal.variant=variant;
    // 重命名动物可保留几何关系和解法，同时避免备用局只有一种外观。
    const shuffled = CONFIG.enabledAnimalIds.slice();
    for (let i = shuffled.length-1; i > 0; i--) {
      const j = Math.floor(random()*(i+1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const map = Object.fromEntries(CONFIG.enabledAnimalIds.map((id, i) => [id, shuffled[i]]));
    deal.tiles.forEach(t => { t.animalId = map[t.animalId]; });
    deal.seed = seed;
    deal.fallback = true;
    const proof = minimumCapacity(deal.tiles, { budgetMs: 100 });
    setDifficulty(deal, proof, wins);
    validateDeal(deal);
    return deal;
  }
  const signature = () => JSON.stringify([CONFIG.enabledAnimalIds, CONFIG.copiesPerAnimal, CONFIG.layoutVersion, CONFIG.layoutTemplates]);
  function pack(deal, state, progress = { wins: deal.winsAtStart + (state.status === 'won' ? 1 : 0), credited: state.status === 'won' }) {
    assert(['playing', 'won', 'lost'].includes(state.status), '不能保存临时状态');
    return { version: CONFIG.saveVersion, signature: signature(), deal: clone(deal), state: clone(state), progress: clone(progress) };
  }
  function unpack(raw) {
    try {
      const data = JSON.parse(raw);
      assert(data.version === CONFIG.saveVersion && data.signature === signature(), '存档版本不匹配');
      validateDeal(data.deal);
      const saved = data.state;
      assert(Array.isArray(saved.history) && saved.history.length <= data.deal.tiles.length, '历史记录无效');
      const replay = makeState(data.deal);
      for (const id of saved.history) assert(pick(replay, id), '存档含非法操作');
      assert(JSON.stringify(replay) === JSON.stringify(saved), '存档状态不一致');
      const p = data.progress;
      assert(p && typeof p.credited === 'boolean' && Number.isSafeInteger(p.wins) &&
        p.wins === data.deal.winsAtStart + (p.credited ? 1 : 0) &&
        (replay.status !== 'won' || p.credited), '累计进度无效');
      return { deal: data.deal, state: replay, progress: p };
    } catch (_) { return null; }
  }
  global.AnimalGame = { ANIMALS, CONFIG, positions, validateConfig, validateGeometry, analyzeGeometry, visibleFraction, overlaps, canPick, makeState,
    beginPick, finishPick, pick, rng, validateDeal, assertConservation, generate, pack, unpack, clone,
    solveCapacity, minimumCapacity, extraSlots };
})(globalThis);
