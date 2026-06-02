// wall-ring.js — shared wall ring renderer
// Loaded by wall.html (full popup) and will be loaded by index.html (mini ring).
// Exposes a WallRing namespace; page-specific code (BroadcastChannel, deal
// animation, standalone mode) stays in each page's own <script>.

(function(global) {

  // ── Tile image src ──────────────────────────────────────────────────────
  function tileSrc(t) {
    return `img/tiles/${t.suit}_${t.value}.png`;
  }

  // ── Geometry ────────────────────────────────────────────────────────────
  // Segments in game.js CCW order: seg0=seat0, seg1=seat3, seg2=seat2, seg3=seat1
  const SEG_TO_SEAT = [0, 3, 2, 1];

  function physToPos(physIdx) {
    const seg   = Math.floor(physIdx / 36);
    const seat  = SEG_TO_SEAT[seg];
    const col   = Math.floor((physIdx % 36) / 2);
    const layer = physIdx % 2;
    return { seat, col, layer };
  }

  // ── Persistent state ────────────────────────────────────────────────────
  let _tiles        = [];   // indexed by physIdx (0..143)
  let _headIdx      = 0;
  let _gameConnected = false;
  let _lastWallId0  = null;
  let _lastLiveData = null;
  let _liveDealerSeat = 0;

  // ── Layout constants (updated by applyTileSize) ─────────────────────────
  let STEP = 36;
  let MR   = 10;
  let _lastBreakSeat  = null;
  let _lastBreakCount = 0;

  const DIE_FACES = ['','⚀','⚁','⚂','⚃','⚄','⚅'];
  const WALL_ELS  = { 0:'wall-bot', 1:'wall-rgt', 2:'wall-top', 3:'wall-lft' };

  // ── Build the 4-wall DOM ────────────────────────────────────────────────
  // tiles[physIdx] = { suit, value } in physical (unrotated) order
  function buildWalls(tiles, root) {
    root = root || document;
    _tiles = new Array(144);

    function makeImg(physIdx) {
      const t   = tiles[physIdx];
      const img = document.createElement('img');
      img.src = tileSrc(t);
      img.alt = '';
      const div = document.createElement('div');
      div.className = 'tile';
      div.appendChild(img);
      _tiles[physIdx] = { div, img };
      return div;
    }

    function makeRot(physIdx, rotCls) {
      const w = document.createElement('div');
      w.className = `rw ${rotCls}`;
      w.appendChild(makeImg(physIdx));
      return w;
    }

    const bot = root.querySelector('#wall-bot');
    bot.innerHTML = '';
    for (let c = 17; c >= 0; c--) {
      const s = document.createElement('div');
      s.className = 'sv';
      s.appendChild(makeImg(c*2));
      s.appendChild(makeImg(c*2 + 1));
      bot.appendChild(s);
    }

    const lft = root.querySelector('#wall-lft');
    lft.innerHTML = '';
    for (let c = 17; c >= 0; c--) {
      const s = document.createElement('div');
      s.className = 'sh';
      s.appendChild(makeRot(36+c*2 + 1, 'rl'));
      s.appendChild(makeRot(36+c*2,     'rl'));
      lft.appendChild(s);
    }

    const top = root.querySelector('#wall-top');
    top.innerHTML = '';
    for (let c = 0; c < 18; c++) {
      const s = document.createElement('div');
      s.className = 'sv';
      s.appendChild(makeImg(72+c*2 + 1));
      s.appendChild(makeImg(72+c*2));
      _tiles[72+c*2].div.classList.add('r180');
      _tiles[72+c*2+1].div.classList.add('r180');
      top.appendChild(s);
    }

    const rgt = root.querySelector('#wall-rgt');
    rgt.innerHTML = '';
    for (let c = 0; c < 18; c++) {
      const s = document.createElement('div');
      s.className = 'sh';
      s.appendChild(makeRot(108+c*2,     'rr'));
      s.appendChild(makeRot(108+c*2 + 1, 'rr'));
      rgt.appendChild(s);
    }

    updateCenterSize(root);
  }

  function updateCenterSize(root) {
    root = root || document;
    const tw  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tw'));
    const gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap'));
    const span = 18 * tw + 17 * gap;
    const ctr = root.querySelector('#wall-center');
    if (ctr) { ctr.style.width = span + 'px'; ctr.style.height = span + 'px'; }
  }

  // ── Apply live game state overlay ───────────────────────────────────────
  function applyGameState(data, root) {
    root = root || document;
    const wallIdx   = data.wallIdx;
    const tailCol   = data.tailCol;
    const tailPhase = data.tailPhase;
    const effTP     = (tailPhase === 0 && tailCol * 2 < wallIdx) ? 1 : tailPhase;

    const remain   = Math.max(0, 2 * (tailCol + 1) - wallIdx - tailPhase);
    const tailUsed = (71 - tailCol) * 2 + effTP;
    const exhausted = remain === 0;

    const headSkips  = wallIdx % 2 === 0 && Math.floor(wallIdx / 2) === tailCol && tailPhase === 1;
    const effHeadIdx = wallIdx + (headSkips ? 1 : 0);
    const effTailIdx = tailCol * 2 + effTP;

    for (let physIdx = 0; physIdx < 144; physIdx++) {
      const el = _tiles[physIdx];
      if (!el) continue;
      el.div.classList.remove('used', 'tail-used', 'next-head', 'next-tail');
      el.div.style.opacity   = '';
      el.div.style.outline   = '';
      el.div.style.boxShadow = '';
    }

    for (let i = 0; i < 144; i++) {
      const physIdx = (_headIdx + i) % 144;
      const el = _tiles[physIdx];
      if (!el) continue;

      const isHeadUsed = i < wallIdx;
      const isTailUsed = (() => {
        const c     = Math.floor(i / 2);
        const isTop = (i % 2 === 0);
        if (c > tailCol) return true;
        if (c === tailCol && isTop && effTP === 1) return true;
        return false;
      })();

      if (!exhausted && i === effHeadIdx) {
        el.div.classList.add('next-head');
      } else if (!exhausted && i === effTailIdx) {
        el.div.classList.add('next-tail');
      } else if (isHeadUsed) {
        el.div.classList.add('used');
      } else if (isTailUsed) {
        el.div.classList.add('tail-used');
      }
    }

    const statsEl = root.querySelector('#stats');
    if (statsEl) {
      if (exhausted) {
        statsEl.innerHTML = `<span style="color:#ff4444;font-weight:700">🏁 WALL EXHAUSTED — 0 tiles left</span><span style="color:#aaa">${wallIdx} drawn · ${tailUsed} replaced</span>`;
      } else {
        statsEl.innerHTML = `
          <span style="color:#7dffff">${remain} live</span>
          <span style="color:#aaa">${wallIdx} drawn · ${tailUsed} replaced</span>
          <span style="color:#ffd34d">■ next draw</span>
          <span style="color:#ff9800">■ next replacement</span>
          <span style="color:#555">dim = used</span>`;
      }
    }

    const ctrTitle = root.querySelector('#ctr-title');
    const ctrSub   = root.querySelector('#ctr-sub');
    if (ctrTitle) ctrTitle.textContent = `${remain} tiles`;
    if (ctrSub)   ctrSub.textContent   = `${wallIdx} drawn · ${tailUsed} tail`;
  }

  // ── Tile sizing ─────────────────────────────────────────────────────────
  // availW/availH: constrain to a specific size (omit to use full window)
  function applyTileSize(availW, availH, root) {
    root   = root   || document;
    availW = availW ?? (window.innerWidth  - 20);
    availH = availH ?? (window.innerHeight - 140);
    const avail = Math.min(availW, availH);
    const tw  = Math.max(10, Math.min(40, Math.floor((avail - 80) / 20.8)));
    const th  = Math.round(tw * 48 / 34);
    const gap = Math.max(1, Math.round(tw / 17));
    document.documentElement.style.setProperty('--tw',  tw  + 'px');
    document.documentElement.style.setProperty('--th',  th  + 'px');
    document.documentElement.style.setProperty('--gap', gap + 'px');
    STEP = tw + gap;
    MR   = Math.round(tw * 10 / 34);
    updateCenterSize(root);
    if (_lastBreakSeat !== null) placeBreakMarker(_lastBreakSeat, _lastBreakCount, root);
  }

  // ── Break marker ────────────────────────────────────────────────────────
  function placeBreakMarker(seat, breakCount, root) {
    root = root || document;
    _lastBreakSeat  = seat;
    _lastBreakCount = breakCount;
    root.querySelectorAll('.break-marker').forEach(e => e.remove());
    const wallEl = root.querySelector('#' + WALL_ELS[seat]);
    if (!wallEl) return;
    const marker = document.createElement('div');
    marker.className   = 'break-marker';
    marker.textContent = '▶';

    if (seat === 0) {
      marker.style.left = ((17 - breakCount) * STEP + 17 - MR) + 'px';
      marker.style.top  = (-MR * 2 - 2) + 'px';
    } else if (seat === 2) {
      marker.style.left   = (breakCount * STEP + 17 - MR) + 'px';
      marker.style.bottom = (-MR * 2 - 2) + 'px';
    } else if (seat === 3) {
      marker.style.top   = ((17 - breakCount) * STEP + 17 - MR) + 'px';
      marker.style.right = (-MR * 2 - 2) + 'px';
    } else {
      marker.style.top  = (breakCount * STEP + 17 - MR) + 'px';
      marker.style.left = (-MR * 2 - 2) + 'px';
    }
    wallEl.appendChild(marker);
  }

  // ── Dice display ────────────────────────────────────────────────────────
  function showDice(dice, diceTotal, breakSeat, root) {
    root = root || document;
    const facesEl = root.querySelector('#dice-faces');
    if (!facesEl) return;
    facesEl.innerHTML = '';
    (dice || []).forEach(v => {
      const die = document.createElement('div');
      die.className   = 'die';
      die.textContent = DIE_FACES[v] || v;
      facesEl.appendChild(die);
    });
    const sumLbl    = root.querySelector('#dice-sum-lbl');
    const resultLbl = root.querySelector('#dice-result-lbl');
    const display   = root.querySelector('#dice-display');
    if (sumLbl)    sumLbl.textContent    = `Sum: ${diceTotal}`;
    if (resultLbl) resultLbl.textContent = `Break Seat ${breakSeat}'s wall`;
    if (display)   display.style.display = 'flex';
  }

  // ── Dealer labels ───────────────────────────────────────────────────────
  function updateDealerLabels(dealerSeat, root) {
    root = root || document;
    const d = dealerSeat !== undefined
      ? dealerSeat
      : parseInt((root.querySelector('#dealer-sel') || {}).value || 0);
    [0,1,2,3].forEach(s => {
      const el = root.querySelector(`#s${s}-lbl`);
      if (!el) return;
      el.className   = s === d ? 'seat-lbl dealer' : 'seat-lbl';
      el.textContent = s === d ? `Seat ${s} · Dealer` : `Seat ${s}`;
    });
    const sel = root.querySelector('#dealer-sel');
    if (sel && dealerSeat !== undefined) sel.value = dealerSeat;
  }

  // ── Main entry point from game data ────────────────────────────────────
  function renderFromGame(data, root) {
    root = root || document;
    _lastLiveData = data;

    const wall           = data.wall;
    const wallBreakSeat  = data.wallBreakSeat  ?? 0;
    const wallBreakCount = data.wallBreakCount ?? 0;
    const dice           = data.dice           ?? [];
    const diceTotal      = data.diceTotal      ?? 0;
    const dealerSeat     = data.dealerSeat     ?? 0;

    const ccwOrder = [0,3,2,1];
    const segIdx   = ccwOrder.indexOf(wallBreakSeat);
    _headIdx       = (segIdx * 36 + 2 * wallBreakCount) % 144;

    const newId0 = wall[0] ? wall[0].id : null;
    if (newId0 !== _lastWallId0) {
      _lastWallId0 = newId0;
      const physical = new Array(144);
      for (let i = 0; i < 144; i++) {
        physical[(_headIdx + i) % 144] = wall[i];
      }
      buildWalls(physical, root);
      showDice(dice, diceTotal, wallBreakSeat, root);
      placeBreakMarker(wallBreakSeat, wallBreakCount, root);
      updateDealerLabels(dealerSeat, root);
    }
    _liveDealerSeat = dealerSeat;

    applyGameState(data, root);

    // Page-specific elements — silently skip if absent
    const badge = root.querySelector('#mode-badge');
    if (badge) { badge.textContent = 'live'; badge.className = 'live'; }
    const shuffleBtn = root.querySelector('#shuffle-btn');
    if (shuffleBtn) shuffleBtn.disabled = true;
    const diceBtn = root.querySelector('#dice-btn');
    if (diceBtn) diceBtn.disabled = true;

    _gameConnected = true;
  }

  // ── Public API ──────────────────────────────────────────────────────────
  global.WallRing = {
    buildWalls,
    applyGameState,
    renderFromGame,
    applyTileSize,
    updateCenterSize,
    placeBreakMarker,
    showDice,
    updateDealerLabels,
    get tiles()         { return _tiles; },
    get headIdx()       { return _headIdx; },
    set headIdx(v)      { _headIdx = v; },
    get gameConnected() { return _gameConnected; },
    set gameConnected(v){ _gameConnected = v; },
    get lastLiveData()  { return _lastLiveData; },
    get liveDealerSeat(){ return _liveDealerSeat; },
  };

})(window);
