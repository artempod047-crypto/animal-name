(function () {
  'use strict';
  const G = AnimalGame;
  class GameSession {
    constructor(storage, onChange = () => {}, delay = 190) {
      Object.assign(this, { storage, onChange, delay, epoch: 0, state: null, deal: null, pending: null,
        wins: 0, credited: false, storageUnavailable: false, restoreNotice: '' });
    }
    save() {
      try { this.storage.setItem(G.CONFIG.saveKey, JSON.stringify(G.pack(this.deal, this.state, { wins: this.wins, credited: this.credited }))); }
      catch (_) { this.storageUnavailable = true; }
    }
    restore() {
      try {
        const raw = this.storage.getItem(G.CONFIG.saveKey);
        const saved = G.unpack(raw);
        if (saved) {
          this.epoch++;
          this.deal = saved.deal;
          this.state = saved.state;
          this.wins = saved.progress.wins;
          this.credited = saved.progress.credited;
          this.pending = null;
          this.onChange();
          return true;
        }
        if (this.storage.getItem(G.CONFIG.legacySaveKey) || this.storage.getItem('animal-station-save-v1')) this.restoreNotice = '棋盘已更新，已为你开始新一局。';
        else if (raw) this.restoreNotice = '原进度无法恢复，已为你开始新一局。';
      } catch (_) { this.storageUnavailable = true; }
      return false;
    }
    start(deal, credited = false) {
      this.epoch++;
      G.validateDeal(deal);
      this.deal = G.clone(deal);
      this.state = G.makeState(deal);
      this.credited = credited;
      this.wins = deal.winsAtStart + (credited ? 1 : 0);
      this.pending = null;
      this.save();
      this.onChange();
    }
    replay() { this.start(this.deal, this.credited); }
    async choose(id) {
      const pending = G.beginPick(this.state, id);
      if (!pending) return false;
      const epoch = this.epoch;
      this.pending = pending;
      this.onChange();
      await new Promise(resolve => setTimeout(resolve, this.delay));
      if (epoch !== this.epoch) return false;
      G.finishPick(this.state, pending);
      if (this.state.status === 'won' && !this.credited) { this.wins++; this.credited = true; }
      this.pending = null;
      this.save();
      this.onChange();
      return true;
    }
  }
  globalThis.GameSession = GameSession;
  const board = document.getElementById('board');
  if (!board) return;
  const $ = id => document.getElementById(id);
  const modal = $('modal');
  let generating = false, generation = 0, shownResult = '', imageFailed = false;
  const storage = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value)
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const session = new GameSession(storage, render, reducedMotion.matches ? 0 : 200);
  reducedMotion.addEventListener('change', event => { session.delay = event.matches ? 0 : 200; });
  function animalImage(id) {
    const image = document.createElement('img');
    image.src = G.ANIMALS[id].image;
    image.alt = G.ANIMALS[id].name;
    image.draggable = false;
    image.addEventListener('error', () => {
      imageFailed = true;
      $('storage-note').textContent = '动物图片未能加载，请保持 assets 文件夹与网页在一起。';
    }, { once: true });
    return image;
  }
  function render() {
    if (!session.state) return;
    const state = session.state;
    board.replaceChildren();
    const width = Math.max(...state.tiles.map(t => t.x+t.width));
    const height = Math.max(...state.tiles.map(t => t.y+t.height));
    board.style.aspectRatio = `${width} / ${height}`;
    for (const tile of state.tiles) {
      if (tile.state !== 'board') continue;
      const available = G.canPick(state, tile);
      const concealed = G.visibleFraction(state, tile) === 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tile ${available ? 'available' : 'blocked'}`;
      if (concealed) button.classList.add('concealed');
      button.dataset.id = tile.id;
      button.style.cssText = `left:${tile.x/width*100}%;top:${tile.y/height*100}%;width:${tile.width/width*100}%;height:${tile.height/height*100}%;z-index:${tile.layer+1}`;
      button.setAttribute('aria-label', concealed ? '尚未露出的动物牌' : `${G.ANIMALS[tile.animalId].name}${available ? '' : '，被遮挡'}`);
      if (concealed) button.setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-disabled', String(!available || state.status !== 'playing' || generating));
      button.tabIndex = available && state.status === 'playing' && !generating ? 0 : -1;
      const face = animalImage(tile.animalId);
      if (concealed) face.alt = '';
      button.append(face);
      button.addEventListener('click', () => {
        if (generating || modal.open) return;
        // 被遮挡牌仍接收事件，由规则层拒绝，避免穿透点击其他牌。
        session.choose(tile.id);
      });
      board.append(button);
    }
    $('tray').replaceChildren();
    $('tray').style.setProperty('--tray-columns', Math.min(7, state.capacity));
    document.querySelector('.tray-area').setAttribute('aria-label', `${state.capacity} 格收纳栏`);
    document.querySelector('.level-tag').textContent = `已通关 ${session.wins} 次`;
    for (let i = 0; i < state.capacity; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.setAttribute('aria-label', `第 ${i+1} 格${state.tray[i] ? '' : '，空位'}`);
      if (state.tray[i]) {
        const tile = state.tiles.find(t => t.id === state.tray[i]);
        const face = document.createElement('div');
        face.className = 'tray-tile';
        if (session.pending?.matches.includes(tile.id)) face.classList.add('matching');
        else if (session.pending?.id === tile.id) face.classList.add('arriving');
        face.append(animalImage(tile.animalId));
        slot.append(face);
      }
      $('tray').append(slot);
    }
    const totalGroups = state.tiles.length/3;
    $('progress-text').innerHTML = `已消除 <strong>${state.eliminated/3} / ${totalGroups}</strong> 组`;
    $('progress').max = totalGroups;
    $('progress').value = state.eliminated/3;
    $('tray-count').textContent = `${state.tray.length} / ${state.capacity}`;
    const settled = state.status !== 'settling', count = state.tray.length, hint = $('hint');
    hint.textContent = state.status === 'won' ? '所有小动物都找到伙伴啦！' : state.status === 'lost' ? '没关系，再试一次就好！' :
      !settled ? (session.pending.matches.length ? '找到伙伴啦！' : '小动物来报到啦') :
      count === state.capacity-1 ? '只剩 1 个空位啦，仔细想一想' : count === state.capacity-2 ? '空位不多啦，试着找找相同的动物' : '先找相同的小动物，再轻轻点一下吧';
    hint.classList.toggle('caution', settled && count >= state.capacity-2);
    document.querySelector('.tray-area').classList.toggle('caution', settled && count >= state.capacity-2);
    $('loading').hidden = !generating;
    $('replay').disabled = $('new-game').disabled = generating;
    if (!imageFailed) $('storage-note').textContent = session.storageUnavailable ? '当前浏览器无法保存进度，本次仍可正常游玩。' : session.restoreNotice;
    const resultKey = `${session.epoch}-${state.status}`;
    if (['won', 'lost'].includes(state.status) && shownResult !== resultKey) {
      shownResult = resultKey;
      showResult(state.status);
    }
  }
  function showModal(title, description, buttons) {
    if (modal.open) modal.close();
    $('modal-title').textContent = title;
    $('modal-description').textContent = description;
    $('modal-actions').replaceChildren();
    buttons.forEach(({ text, primary, action }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button ${primary ? 'primary' : 'secondary'}`;
      button.textContent = text;
      button.addEventListener('click', () => { modal.close(); action(); });
      $('modal-actions').append(button);
    });
    modal.showModal();
  }
  function showResult(status) {
    if (status === 'won') showModal('太棒啦，动物都找到伙伴了！', '你是一位很棒的小小收纳员。', [
      { text: '下一关', primary: true, action: newGame }
    ]);
    else showModal('收纳栏装满啦，再试一次吧！', '慢慢观察，换个顺序试一试。', [
      { text: '重玩本局', action: () => session.replay() },
      { text: '换一局', primary: true, action: newGame }
    ]);
  }
  async function newGame() {
    if (generating) return;
    const token = ++generation;
    session.epoch++;
    generating = true;
    if (session.state) session.state.status = 'generating';
    $('loading').hidden = false;
    $('replay').disabled = $('new-game').disabled = true;
    await new Promise(resolve => setTimeout(resolve, 20));
    if (token !== generation) return;
    try {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const deal = G.generate(random[0], { excludeTemplateId: session.deal?.templateId, wins: session.wins });
      if (session.deal && deal.tiles.every((t, i) => t.animalId === session.deal.tiles[i].animalId)) {
        const ids = G.CONFIG.enabledAnimalIds;
        deal.tiles.forEach(t => { t.animalId = ids[(ids.indexOf(t.animalId)+1)%ids.length]; });
      }
      generating = false;
      session.start(deal);
    } catch (error) {
      generating = false;
      $('loading').textContent = '暂时无法布置动物，请检查游戏配置后刷新。';
      $('loading').hidden = false;
      console.error(error);
    }
  }
  function requestRestart(kind) {
    const action = kind === 'replay' ? () => session.replay() : newGame;
    if (['playing', 'settling'].includes(session.state?.status)) {
      showModal(kind === 'replay' ? '要重玩这一局吗？' : '要换一局吗？', '当前进度会重新开始。', [
        { text: '继续玩', action: () => {} },
        { text: kind === 'replay' ? '重玩本局' : '换一局', primary: true, action }
      ]);
    } else action();
  }
  $('replay').addEventListener('click', () => requestRestart('replay'));
  $('new-game').addEventListener('click', () => requestRestart('new'));
  modal.addEventListener('cancel', event => {
    if (['won', 'lost'].includes(session.state?.status)) event.preventDefault();
  });
  globalThis.AnimalApp = { session, newGame, render };
  if (!session.restore()) newGame();
})();
