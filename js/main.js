// ============================================================
// main.js  — Bootstrap
// ============================================================

// --- Auto-scale to fit viewport width ---
(function setupScale() {
  const DESIGN_WIDTH = 1285;
  function applyScale() {
    const scale = Math.min(1, window.innerWidth / DESIGN_WIDTH);
    const app = document.getElementById('app');
    if (app) {
      app.style.transform = scale < 1 ? `scale(${scale})` : '';
      app.style.width = scale < 1 ? (100 / scale) + '%' : '';
    }
  }
  document.addEventListener('DOMContentLoaded', applyScale);
  window.addEventListener('resize', applyScale);
})();


// Chrome in fullscreen may suppress ESC before we see it, so we also provide
// a click-to-exit overlay button that appears only in fullscreen mode.
(function setupFullscreen() {
  // Create a small exit button shown only in fullscreen
  const exitBtn = document.createElement('button');
  exitBtn.id = 'fullscreen-exit-btn';
  exitBtn.textContent = '⛶ Exit Fullscreen';
  exitBtn.title = 'Press ESC or click to exit fullscreen';
  exitBtn.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:9999',
    'display:none', 'background:#ffd34d', 'color:#07301a',
    'border:0', 'border-radius:4px', 'padding:5px 10px',
    'font-size:12px', 'font-weight:700', 'cursor:pointer',
    'opacity:0.75',
  ].join(';');
  exitBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
  });
  exitBtn.addEventListener('mouseenter', () => exitBtn.style.opacity = '1');
  exitBtn.addEventListener('mouseleave', () => exitBtn.style.opacity = '0.75');
  document.body.appendChild(exitBtn);

  // Show/hide button based on fullscreen state
  function onFSChange() {
    exitBtn.style.display = document.fullscreenElement ? 'block' : 'none';
  }
  document.addEventListener('fullscreenchange', onFSChange);
  document.addEventListener('webkitfullscreenchange', onFSChange);

  // Intercept ESC key ourselves — useful when browser suppresses it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'F11') {
      if (document.fullscreenElement) {
        e.preventDefault();
        document.exitFullscreen();
      }
    }
  });
})();



// Minimum faan required to declare a win. Default 3 (standard HK).
let MIN_FAAN = 2; // default

// Maximum faan that counts for payout. 0 = no cap (infinite).
let MAX_FAAN = 7; // default

// Whether Seven Pairs (七對子) is an allowed winning hand.
let USE_SEVEN_PAIRS = (localStorage.getItem('useSevenPairs') ?? 'false') === 'true';

// Starting points per player. Game ends when any player goes below 0.
let START_POINTS = parseInt(localStorage.getItem('startPoints') ?? '2000', 10);

let game = null;

// ---- Sprint state (shared with ui.js via window) ----
window._sprintLog    = [];
window._sprintDone   = 0;
window._sprintTarget = 50;

function _sprintRecordHand() {
  if (!game) return;
  const r = game.lastResult;
  const prev = window._sprintLog.length > 0
    ? window._sprintLog[window._sprintLog.length - 1].scores
    : window._sprintStartScores?.map((score, i) => ({ score, name: game?.players[i]?.name ?? '' })) ?? null;
  const scores = game.players.map((p, i) => ({
    name: p.name,
    score: p.score,
    delta: prev ? p.score - prev[i].score : 0,
  }));
  window._sprintLog.push({
    hand:       window._sprintDone + 1,
    winnerSeat: r?.winner ?? -1,
    winnerName: r?.winner >= 0 ? (game.players[r.winner]?.name ?? `Seat ${r.winner}`) : 'Draw',
    faan:       r?.faan ?? 0,
    label:      r?.label ?? '',
    draw:       (r?.winner ?? -1) === -1,
    scores,
  });
}

function onGameUpdate(event) {
  // Record every hand completion in the persistent hand log
  if ((event === 'win' || event === 'draw') && game) {
    window.handLog?.recordHand(game);
  }

  // ---- Sprint (fast): skip renders during hand; render + auto-advance at end ----
  if (window.AUTO_MODE === 'sprint') {
    if (event === 'win' || event === 'draw') {
      _sprintRecordHand();
      window._sprintDone++;
      const sl = document.getElementById('sprint-status-label');
      if (sl) sl.textContent = `H${window._sprintDone}/${window._sprintTarget} — running…`;
      renderAll();
      game.shareState();
      const delay = window._sprintDisplayMs ?? 1500;
      if (window._sprintDone < window._sprintTarget) {
        setTimeout(() => {
          if (window.AUTO_MODE !== 'sprint') return; // user cancelled
          window._clearTileCache?.();
          game.nextDeal();
        }, delay);
      } else {
        setTimeout(() => {
          window._setAutoMode?.(null);
          const sl2 = document.getElementById('sprint-status-label');
          if (sl2) sl2.textContent = `✅ Done — ${window._sprintDone} hands`;
          renderAll();
        }, delay);
      }
    }
    // skip render for all non-terminal events
    return;
  }

  // ---- Sprint Browse: compute synchronously, render all, wait for user Pass ----
  if (window.AUTO_MODE === 'sprint_slow') {
    if (event === 'win' || event === 'draw') {
      _sprintRecordHand();
      window._sprintDone++;
      const sl = document.getElementById('sprint-status-label');
      if (window._sprintDone < window._sprintTarget) {
        if (sl) sl.textContent = `H${window._sprintDone}/${window._sprintTarget} — click Pass to continue`;
      } else {
        if (sl) sl.textContent = `H${window._sprintDone}/${window._sprintTarget} — click Pass to end`;
      }
      // Accumulate log across hands: prepend current hand's entries (newest first)
      window._sprintBrowseFullLog = [
        ...(game.log || []),
        ...(window._sprintBrowseFullLog || []),
      ];
      game.shareState();  // writes scores + current hand log to localStorage
      // Replace the single-hand log with the full accumulated log so score.html sees all hands
      try {
        const s = JSON.parse(localStorage.getItem('mahjongSharedState'));
        if (s) { s.log = window._sprintBrowseFullLog; localStorage.setItem('mahjongSharedState', JSON.stringify(s)); }
      } catch(e) {}
    }
    renderAll();   // always render so board is examinable (also broadcasts wall → peek.html)
    saveGameState();
    return;
  }

  renderAll();
  if (game) {
    game.shareState();
    saveGameState();
  }

  if (event === 'validation-error' && game?.lastValidationError) {
    // Kill auto-run so the error isn't buried in a long run
    if (window._autorunTimer) { clearTimeout(window._autorunTimer); window._autorunTimer = null; }
    window._autorunLeft = 0;
    const _ainp = document.getElementById('autorun-count');
    if (_ainp) _ainp.value = 0;
    const _albl = document.getElementById('autorun-label');
    if (_albl) _albl.textContent = '';
    if (window._autorunPrevMode !== undefined) {
      setAutoMode(window._autorunPrevMode);
      delete window._autorunPrevMode;
    }
    _showValidationErrorBanner(game.lastValidationError);
    return;
  }

  // Fast auto-mode status
  if (window.AUTO_MODE) {
    const sta = document.getElementById('auto-status');
    if (sta && game) {
      const seat = game.currentSeat;
      const p = game.players[seat];
      const who = p ? (p.isHuman ? 'CPU-You' : p.name) : `seat ${seat}`;
      sta.textContent = window.AUTO_MODE === 'slow'
        ? `Slow · ${who} · ${game.phase} — click Pass 通 or board to advance`
        : `Fast · ${who} · ${game.phase}`;
    }
  }
}

// Save full game state to sessionStorage (survives tab switch, not page reload by user)
function saveGameState() {
  try {
    const state = {
      wall: game.wall,
      wallIdx:   game.wallIdx,
      tailCol:   game.tailCol,
      tailPhase: game.tailPhase,
      players: game.players.map(p => ({
        seat: p.seat, name: p.name, isHuman: p.isHuman,
        score: p.score, hand: p.hand, melds: p.melds, bonus: p.bonus,
        lastDiscard: p.lastDiscard,
      })),
      roundWind: game.roundWind,
      dealerSeat: game.dealerSeat,
      currentSeat: game.currentSeat,
      phase: game.phase,
      discard: game.discard,
      discardSeat: game.discardSeat,
      discardPile: game.discardPile,
      claimOptions: game.claimOptions,
      pendingClaims: game.pendingClaims,
      firstDraw: game.firstDraw,
      dealerFirstDiscard: game.dealerFirstDiscard,
      handActionCount: game.handActionCount,
      lastResult: game.lastResult,
      dice: game.dice,
      diceTotal: game.diceTotal,
      wallBreakSeat: game.wallBreakSeat,
      wallBreakCount: game.wallBreakCount,
      robbingKongSeat: game.robbingKongSeat,
      robbingKongTile: game.robbingKongTile,
      robbingKongTiles: game.robbingKongTiles,
      robbingKongPungIdx: game.robbingKongPungIdx,
      log: game.log,
      ts: Date.now(),
    };
    sessionStorage.setItem('mahjongGameState', JSON.stringify(state));
  } catch(e) {}
}

function restoreGameState() {
  try {
    const raw = sessionStorage.getItem('mahjongGameState');
    if (!raw) return false;
    const s = JSON.parse(raw);
    // Only restore if saved within last 4 hours
    if (Date.now() - s.ts > 4 * 60 * 60 * 1000) return false;
    // Apply saved state to game object
    game.wall = s.wall;
    game.wallIdx   = s.wallIdx;
    game.tailCol   = s.tailCol   ?? 71;
    game.tailPhase = s.tailPhase ?? 0;
    game.players = s.players;
    game.roundWind = s.roundWind;
    game.dealerSeat = s.dealerSeat;
    game.currentSeat = s.currentSeat;
    game.phase = s.phase;
    game.discard = s.discard;
    game.discardSeat = s.discardSeat;
    game.discardPile = s.discardPile;
    game.claimOptions = s.claimOptions;
    game.pendingClaims = s.pendingClaims || [];
    game.firstDraw = s.firstDraw;
    game.dealerFirstDiscard = s.dealerFirstDiscard;
    game.handActionCount = s.handActionCount || 0;
    game.lastResult = s.lastResult;
    game.dice = s.dice;
    game.diceTotal = s.diceTotal;
    game.wallBreakSeat = s.wallBreakSeat;
    game.wallBreakCount = s.wallBreakCount;
    game.robbingKongSeat = s.robbingKongSeat ?? null;
    game.robbingKongTile = s.robbingKongTile ?? null;
    game.robbingKongTiles = s.robbingKongTiles ?? null;
    game.robbingKongPungIdx = s.robbingKongPungIdx ?? null;
    game.log = s.log || [];

    // Validate hand counts before accepting restored state.
    // A corrupted restore with wrong counts would poison the whole hand.
    const PHASE_END = 'end';
    if (game.phase !== PHASE_END) {
      const isDiscard = game.phase === 'discard';
      for (const p of game.players) {
        const bonusInHand = (p.hand || []).filter(t => t.suit === 'flower' || t.suit === 'season').length;
        const h = (p.hand || []).length - bonusInHand;
        const melds = (p.melds || []).length;
        // After draw / after claim: expected 14 - 3*melds; after discard / waiting: 13 - 3*melds
        const hi = 14 - 3 * melds;
        const lo = 13 - 3 * melds;
        if (h < lo - 1 || h > hi + 1) {
          console.warn(`[restoreGameState] INVALID: ${p.name} h=${h} melds=${melds} phase=${game.phase} — discarding saved state`);
          sessionStorage.removeItem('mahjongGameState');
          return false;
        }
      }
    }
    return true;
  } catch(e) { return false; }
}

function _showValidationErrorBanner(msg) {
  let b = document.getElementById('validation-error-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'validation-error-banner';
    b.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);' +
      'background:#5a0808;color:#fff;border:2px solid #ff4040;border-radius:8px;' +
      'padding:12px 20px 10px;font-size:13px;font-weight:700;z-index:9999;' +
      'box-shadow:0 4px 24px rgba(255,0,0,0.55);text-align:center;max-width:640px;white-space:pre-wrap;';
    document.body.appendChild(b);
  }
  b.innerHTML = `<div style="margin-bottom:8px;">🛑 AUTO-RUN PAUSED — HAND COUNT ERROR<br><span style="font-weight:400;font-size:12px;">${msg}</span></div>` +
    `<button onclick="document.getElementById('validation-error-banner').style.display='none'" ` +
    `style="padding:4px 18px;background:#ff4040;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700;font-size:12px;">Dismiss</button>`;
  b.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  // addMsg: flash a message on #message for 4 seconds
  window.addMsg = function(html) {
    const el = document.getElementById('message');
    if (el) { el.innerHTML = html; setTimeout(() => { if(el.innerHTML===html) el.innerHTML=''; }, 5000); }
    let b = document.getElementById('demo-banner');
    if (!b) {
      b = document.createElement('div'); b.id = 'demo-banner';
      b.style.cssText = 'position:fixed;top:46px;left:50%;transform:translateX(-50%);' +
        'background:#07301a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;' +
        'padding:8px 24px;font-size:13px;font-weight:700;z-index:9000;' +
        'box-shadow:0 4px 16px rgba(0,0,0,0.8);pointer-events:none;white-space:nowrap;';
      document.body.appendChild(b);
    }
    b.innerHTML = html; b.style.display = 'block';
    clearTimeout(b._t); b._t = setTimeout(() => { b.style.display='none'; }, 5000);
  };
  // --- Min Faan ---
  const minSel = document.getElementById('min-faan-select');
  minSel.value = String(MIN_FAAN);
  minSel.addEventListener('change', () => {
    MIN_FAAN = parseInt(minSel.value, 10);
    localStorage.setItem('minFaan', MIN_FAAN);
  });

  // --- Max Faan ---
  const maxSel = document.getElementById('max-faan-select');
  maxSel.value = String(MAX_FAAN);
  maxSel.addEventListener('change', () => {
    MAX_FAAN = parseInt(maxSel.value, 10);
    localStorage.setItem('maxFaan', MAX_FAAN);
  });

  // --- Seven Pairs toggle ---
  const spChk = document.getElementById('seven-pairs-toggle');
  spChk.checked = USE_SEVEN_PAIRS;
  spChk.addEventListener('change', () => {
    USE_SEVEN_PAIRS = spChk.checked;
    localStorage.setItem('useSevenPairs', USE_SEVEN_PAIRS);
  });

  // --- Start Points ---
  const startPtsInput = document.getElementById('start-points-input');
  if (startPtsInput) {
    startPtsInput.value = String(START_POINTS);
    startPtsInput.addEventListener('change', () => {
      const v = parseInt(startPtsInput.value, 10);
      if (!isNaN(v) && v > 0) {
        START_POINTS = v;
        localStorage.setItem('startPoints', START_POINTS);
      }
    });
  }


  let SHOW_LABELS = (localStorage.getItem('showLabels') ?? 'true') === 'true';
  const labelChk = document.getElementById('show-translation-toggle');
  labelChk.checked = SHOW_LABELS;
  // Apply immediately on load
  document.body.classList.toggle('hide-tile-labels', !SHOW_LABELS);
  labelChk.addEventListener('change', () => {
    SHOW_LABELS = labelChk.checked;
    localStorage.setItem('showLabels', SHOW_LABELS);
    document.body.classList.toggle('hide-tile-labels', !SHOW_LABELS);
  });


  const dealerSeatSel = document.getElementById('game-dealer-seat');
  if (dealerSeatSel) dealerSeatSel.addEventListener('change', () => {
    if (game) {
      game.dealerSeat = parseInt(dealerSeatSel.value);
      game.addLog(`⚙ Dealer → Seat ${game.dealerSeat}`);
      game.shareState();
      renderAll();
    }
  });
  const roundWindSel = document.getElementById('game-round-wind');
  if (roundWindSel) roundWindSel.addEventListener('change', () => {
    if (game) {
      game.roundWind = roundWindSel.value;
      game.addLog(`⚙ Round wind → ${game.roundWind}`);
      game.shareState();
      renderAll();
    }
  });

  // User scheme dropdown — populated from schemes.js SCHEMES array
  const schemeSel = document.getElementById('user-scheme-select');
  if (schemeSel && typeof SCHEMES !== 'undefined') {
    SCHEMES.forEach(sc => {
      const opt = document.createElement('option');
      opt.value = sc.id;
      opt.textContent = sc.name;
      opt.title = sc.desc;
      schemeSel.appendChild(opt);
    });
    schemeSel.addEventListener('change', () => {
      const chosen = SCHEMES.find(sc => sc.id === schemeSel.value) || null;
      USER_SCHEME = chosen;
      const label = chosen ? chosen.name : 'Level AI';
      if (game) game.addLog(`⚙ YOU scheme → ${label}`);
      if (game) game.shareState();
      window.handLog?.checkStrategyChange(game);
    });
  }

  // CPU scheme dropdowns — populate and wire
  function updateCpuSchemes() {
    if (typeof SCHEMES === 'undefined') return;
    const schemeById = id => SCHEMES.find(s => s.id === id) || null;
    window.CPU_SCHEMES_BY_NAME = {
      CPU1: schemeById(document.getElementById('cpu1-scheme')?.value),
      CPU2: schemeById(document.getElementById('cpu2-scheme')?.value),
      CPU3: schemeById(document.getElementById('cpu3-scheme')?.value),
    };
    // Eagerly sync seat-indexed array for any currently-seated CPUs
    if (!window.CPU_SCHEMES) window.CPU_SCHEMES = [null, null, null, null];
    if (game) {
      for (const p of game.players) {
        if (!p.isHuman && window.CPU_SCHEMES_BY_NAME[p.name] !== undefined) {
          window.CPU_SCHEMES[p.seat] = window.CPU_SCHEMES_BY_NAME[p.name];
        }
      }
    }
    window.handLog?.checkStrategyChange(game);
  }

  if (typeof SCHEMES !== 'undefined') {
    ['cpu1-scheme', 'cpu2-scheme', 'cpu3-scheme'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      SCHEMES.forEach(sc => {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        opt.title = sc.desc;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        updateCpuSchemes();
        const cpuName = id.replace('-scheme', '').toUpperCase(); // cpu1 → CPU1
        const schemeName = sel.value
          ? (SCHEMES.find(s => s.id === sel.value)?.name ?? sel.value) : 'Level AI';
        if (game) game.addLog(`⚙ ${cpuName} scheme → ${schemeName}`);
      });
    });
    updateCpuSchemes(); // initialise with defaults (all null → Level AI)
  }

  // CPU skill level dropdowns
  function updateCpuLevels() {
    const l1 = parseInt(document.getElementById('cpu1-level')?.value || '1');
    const l2 = parseInt(document.getElementById('cpu2-level')?.value || '1');
    const l3 = parseInt(document.getElementById('cpu3-level')?.value || '1');
    // CPU seat mapping depends on current dealer rotation
    // Seats 1,2,3 = CPU1,CPU2,CPU3 by name but seat assignments rotate.
    // We store level by player NAME so it persists through seat rotation.
    window.CPU_LEVELS_BY_NAME = { CPU1: l1, CPU2: l2, CPU3: l3 };
    // Also update by current seat
    if (typeof CPU_LEVELS !== 'undefined') {
      for (const p of game.players) {
        if (!p.isHuman && window.CPU_LEVELS_BY_NAME[p.name] !== undefined) {
          CPU_LEVELS[p.seat] = window.CPU_LEVELS_BY_NAME[p.name];
        }
      }
    }
    window.handLog?.checkStrategyChange(game);
  }
  ['cpu1-level','cpu2-level','cpu3-level'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateCpuLevels);
  });

  // Last Tile 海底撈月 toggle (default off)
  const lastTileChk = document.getElementById('last-tile-toggle');
  if (lastTileChk) {
    lastTileChk.checked = false;
    lastTileChk.addEventListener('change', () => {
      window.LAST_TILE_WIN = lastTileChk.checked;
    });
  }

  const openHandsChk = document.getElementById('open-hands-toggle');
  if (openHandsChk) {
    openHandsChk.checked = false;
    openHandsChk.addEventListener('change', () => {
      window.OPEN_HANDS = openHandsChk.checked;
      renderAll();
    });
  }

  const slowDealChk = document.getElementById('slow-deal-toggle');
  if (slowDealChk) {
    slowDealChk.checked = false;
    slowDealChk.addEventListener('change', () => {
      window.SLOW_DEAL = slowDealChk.checked;
      if (slowDealChk.checked) {
        const ss = document.getElementById('single-step-toggle');
        if (ss) { ss.checked = false; window.SINGLE_STEP_DEAL = false; }
      }
    });
  }
  const singleStepChk = document.getElementById('single-step-toggle');
  if (singleStepChk) {
    singleStepChk.checked = false;
    singleStepChk.addEventListener('change', () => {
      window.SINGLE_STEP_DEAL = singleStepChk.checked;
      if (singleStepChk.checked) {
        const sd = document.getElementById('slow-deal-toggle');
        if (sd) { sd.checked = false; window.SLOW_DEAL = false; }
      }
    });
  }

  // ---- Demo Heavenly Hand 天胡: dealer's 14 dealt tiles form a winning hand ----
  document.getElementById('demo-heavenly-btn').addEventListener('click', (e) => { e.stopPropagation();
    game.reset();
    const p = game.players[game.dealerSeat];
    const makeTile = (suit, value) => ({ suit, value, id: Math.random(), _justDrawn: false });
    // All 14 tiles dealt at once (new deal model) — no single "drawn" tile.
    // Hand: 1-2-3 bam + 4-5-6 bam + 7-8-9 bam + circle 1-1-1 (pung) + circle 9-9 (pair)
    p.hand = [
      makeTile(SUIT.BAMBOO,1), makeTile(SUIT.BAMBOO,2), makeTile(SUIT.BAMBOO,3),
      makeTile(SUIT.BAMBOO,4), makeTile(SUIT.BAMBOO,5), makeTile(SUIT.BAMBOO,6),
      makeTile(SUIT.BAMBOO,7), makeTile(SUIT.BAMBOO,8), makeTile(SUIT.BAMBOO,9),
      makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1),
      makeTile(SUIT.CIRCLE,9), makeTile(SUIT.CIRCLE,9),
    ];
    p.melds = [];
    // State mirrors post-deal: 14 tiles in hand, phase=DISCARD, no actions yet
    game.currentSeat = game.dealerSeat;
    game.phase = PHASE.DISCARD;
    game.handActionCount = 0;
    game.dealerFirstDiscard = false;
    game._isFirstDealerDraw = true;
    // Trigger win check for human dealer — Heavenly Hand needs no _justDrawn tile
    if (game.dealerSeat === 0) {
      const ctx = game.makeCtx(0, true);
      ctx.heavenlyHand = true;
      const result = canWin(p.hand, p.melds, ctx);
      if (result.win) {
        game.claimOptions = { win: result, pung: false, kong: false, chow: false };
        game.phase = PHASE.CLAIM;
        game.pendingClaims = [];
      }
    }
    renderAll();
    addMsg('<strong>Demo 天胡</strong>: Dealer wins with all 14 dealt tiles!');
  });

  // ---- Demo Earthly Hand 地胡: CPU1 is dealer, discards, human wins on it ----
  document.getElementById('demo-earthly-btn').addEventListener('click', (e) => { e.stopPropagation();
    game.reset();
    // Make CPU1 (seat 1) the dealer so human is a non-dealer
    game.dealerSeat = 1;
    const makeTile = (suit, value) => ({ suit, value, id: Math.random(), _justDrawn: false });
    // Give human a hand waiting on Circle-9 to win
    const hp = game.players[0];
    hp.hand = [
      makeTile(SUIT.BAMBOO,1), makeTile(SUIT.BAMBOO,2), makeTile(SUIT.BAMBOO,3),
      makeTile(SUIT.BAMBOO,4), makeTile(SUIT.BAMBOO,5), makeTile(SUIT.BAMBOO,6),
      makeTile(SUIT.BAMBOO,7), makeTile(SUIT.BAMBOO,8), makeTile(SUIT.BAMBOO,9),
      makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1),
      makeTile(SUIT.CIRCLE,9),
    ];
    hp.melds = [];
    // CPU1 (dealer) discards Circle-9 as first discard
    const winTile = makeTile(SUIT.CIRCLE,9);
    winTile._discardSeat = 1;
    game.discardPile = [winTile];
    game.discard = winTile;
    game.discardSeat = 1;
    game.handActionCount = 0;
    game.dealerFirstDiscard = true;
    game._isFirstDealerDraw = false;
    game.phase = PHASE.CLAIM;
    game.currentSeat = 1;
    // Set up claim options for human (non-dealer wins on dealer first discard)
    const ctx = game.makeCtx(0, false);
    ctx.earthlyHand = true;
    const handWith = [...hp.hand, winTile];
    const result = canWin(handWith, hp.melds, ctx);
    game.claimOptions = { win: result, pung: false, kong: false, chow: false, _earthlyHand: true };
    game.pendingClaims = [];
    renderAll();
    addMsg('<strong>Demo 地胡</strong>: CPU1 (dealer) discards Circle-9 as first discard — click Win for Earthly Hand 地胡!');
  });

  // ---- Demo Concealed Kong 暗槓: human has 4 of same in hand ----
  document.getElementById('demo-ckong-btn').addEventListener('click', (e) => { e.stopPropagation();
    game.reset();
    const makeTile = (suit, value) => ({ suit, value, id: Math.random(), _justDrawn: false });
    const hp = game.players[0];
    // Give human 4 bamboo-1 + 9 other tiles forming a near-complete hand
    const drawn = makeTile(SUIT.BAMBOO,1);
    drawn._justDrawn = true;
    hp.hand = [
      drawn,
      makeTile(SUIT.BAMBOO,1), makeTile(SUIT.BAMBOO,1), makeTile(SUIT.BAMBOO,1),
      makeTile(SUIT.BAMBOO,2), makeTile(SUIT.BAMBOO,3), makeTile(SUIT.BAMBOO,4),
      makeTile(SUIT.BAMBOO,5), makeTile(SUIT.BAMBOO,6), makeTile(SUIT.BAMBOO,7),
      makeTile(SUIT.BAMBOO,8), makeTile(SUIT.BAMBOO,9),
      makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1),
    ];
    hp.melds = [];
    game.currentSeat = 0;
    game.phase = PHASE.DISCARD;
    game.handActionCount = 0;
    game.dealerFirstDiscard = false;
    game.discard = null;
    renderAll();
    addMsg('<strong>Demo 暗槓</strong>: You have 4× Bamboo 1 with no claimed melds — click Kong 槓 to declare a Concealed Kong 暗槓!');
  });

  // ---- Demo Last Tile 海底撈月: drain wall, human draws last tile to win ----
  document.getElementById('demo-lasttile-btn').addEventListener('click', (e) => { e.stopPropagation();
    // Enable last tile win option first
    const ltChk = document.getElementById('last-tile-toggle');
    if (ltChk) { ltChk.checked = true; window.LAST_TILE_WIN = true; }
    game.reset();
    const makeTile = (suit, value) => ({ suit, value, id: Math.random(), _justDrawn: false });
    const hp = game.players[0];
    // Give human a winning hand waiting on last tile
    hp.hand = [
      makeTile(SUIT.BAMBOO,1), makeTile(SUIT.BAMBOO,2), makeTile(SUIT.BAMBOO,3),
      makeTile(SUIT.BAMBOO,4), makeTile(SUIT.BAMBOO,5), makeTile(SUIT.BAMBOO,6),
      makeTile(SUIT.BAMBOO,7), makeTile(SUIT.BAMBOO,8), makeTile(SUIT.BAMBOO,9),
      makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1), makeTile(SUIT.CIRCLE,1),
      makeTile(SUIT.CIRCLE,9),
    ];
    hp.melds = [];
    // Drain the wall to 1 tile remaining: remaining = 2*(tailCol+1) - wallIdx - tailPhase = 1
    game.tailCol   = 71;
    game.tailPhase = 0;
    game.wallIdx   = 143;          // remaining = 2*72 - 143 - 0 = 1
    game.wall[143] = makeTile(SUIT.CIRCLE,9);
    game.currentSeat = 0;
    game.phase = PHASE.DRAW;
    game.handActionCount = 1; // not first draw
    game.dealerFirstDiscard = true;
    renderAll();
    addMsg('<strong>Demo 海底</strong>: Wall has 1 tile left — the winning tile! Last Tile 海底撈月 is now ON. Click Pass to draw it.');
    // Trigger the draw
    setTimeout(() => game.startTurn(0), 500);
  });

  game = new Game(onGameUpdate);
  window.game = game; // expose for Playwright scripts and dev tools
  // Restore game state if tab was refreshed mid-game
  if (restoreGameState()) {
    renderAll();
    // If it was the human's turn, prompt appropriately
    if (game.phase === PHASE.DISCARD && game.currentSeat === 0) {
      // Ready to discard
    } else if (game.phase === PHASE.CLAIM) {
      // Claim options restored
    }
    // Re-trigger AI if it was AI's turn
    if (game.phase === PHASE.DISCARD && game.currentSeat !== 0) {
      setTimeout(() => { game.aiPlay(game.currentSeat); }, 1000);
    }
  }
  initUI(game);
  renderAll();

  // ---- Hand Log buttons ----
  document.getElementById('hand-log-open-btn')?.addEventListener('click', () => {
    window.handLog?.open();
  });
  document.getElementById('clear-hand-log-btn')?.addEventListener('click', () => {
    if (game) window.handLog?.clear(game);
  });
  // Record initial strategy state on load
  window.handLog?.checkStrategyChange(game);

  // ---- Demo Win button: cycles through all seats winning, including when the winner IS the dealer ----
  // Cycle: Left wins (dealer=0) → Right wins (dealer=0) → Top wins (dealer=0) → You win (dealer=0)
  //        → Left wins & IS dealer → Right wins & IS dealer → Top wins & IS dealer → repeat
  let _demoSeat = 3;
  let _demoDealerIsWinner = false; // when true, the winner is also the dealer

  function runDemoWin() {
    let _demoId = 8000;
    const T = (suit, value) => ({ id: _demoId++, suit, value });

    // Reset minimal game state
    for (let i = 0; i < 4; i++) {
      game.players[i].hand  = [];
      game.players[i].melds = [];
      game.players[i].bonus = [];
    }
    game.discardPile  = [];
    game.discard      = null;
    game.discardSeat  = null;
    game.claimOptions = null;
    game.pendingClaims = [];
    game.lastResult   = null;
    // When _demoDealerIsWinner, make the winning seat the dealer
    game.dealerSeat   = _demoDealerIsWinner ? _demoSeat : 0;

    // Human placeholder hand + a pung meld so the bottom claim row is visible
    const human = game.players[0];
    for (let j = 0; j < 10; j++) human.hand.push(T(SUIT.CHAR, (j % 9) + 1));
    if (_demoSeat !== 0) {
      human.melds.push({ type: 'pung', claimed: true,
        tiles: [T(SUIT.DRAGON,'red'), T(SUIT.DRAGON,'red'), T(SUIT.DRAGON,'red')] });
    }

    let winTile, winnerSeat = _demoSeat;

    // Helper: give a CPU placeholder hand (7 tiles) + one pung meld (face-up claimed)
    function placeholderWithMeld(seat, handSuit, meldSuit, meldVal) {
      const p = game.players[seat];
      for (let j = 0; j < 7; j++) p.hand.push(T(handSuit, (j % 9) + 1));
      p.melds.push({ type: 'pung', claimed: true,
        tiles: [T(meldSuit, meldVal), T(meldSuit, meldVal), T(meldSuit, meldVal)] });
    }

    if (_demoSeat === 2) {
      // ---- TOP player (seat 2 = West) demo win ----
      // Other CPUs get placeholder hands + a visible pung meld each
      placeholderWithMeld(1, SUIT.CHAR, SUIT.BAMBOO, 9); // Right: pung of 9-bam
      placeholderWithMeld(3, SUIT.CHAR, SUIT.CIRCLE, 1); // Left:  pung of 1-dot

      const winner = game.players[2];
      // Concealed hand: 7-8-9 Wan + West-West-West + pair of 5-man  (7 tiles)
      // Melds: chow 1-2-3 Wan (claimed) + chow 4-5-6 Wan (claimed)
      winner.melds = [
        { type: 'chow', claimed: true,
          tiles: [T(SUIT.CHAR,1), T(SUIT.CHAR,2), T(SUIT.CHAR,3)] },
        { type: 'chow', claimed: true,
          tiles: [T(SUIT.CHAR,4), T(SUIT.CHAR,5), T(SUIT.CHAR,6)] },
      ];
      winner.hand = [
        T(SUIT.CHAR,7), T(SUIT.CHAR,8), T(SUIT.CHAR,9),
        T(SUIT.WIND,'West'), T(SUIT.WIND,'West'), T(SUIT.WIND,'West'),
        T(SUIT.CHAR,5),
      ];
      winner.bonus = [ T(SUIT.SEASON, 2) ];
      winTile = T(SUIT.CHAR, 5);
      console.log('[Demo] Top (West) wins');
    } else {
      // ---- LEFT (seat 3 = North) or RIGHT (seat 1 = South) demo win ----
      const oppSeat = _demoSeat === 3 ? 1 : 3;
      placeholderWithMeld(2,       SUIT.CHAR, SUIT.CIRCLE, 8); // Top:  pung of 8-dot
      placeholderWithMeld(oppSeat, SUIT.CHAR, SUIT.BAMBOO, 3); // Opp:  pung of 3-bam

      const seatWind = _demoSeat === 3 ? 'North' : 'South';
      const winner   = game.players[_demoSeat];
      // Concealed hand: 7-8-9 Wan + own-wind pung + pair of East  (7 tiles)
      // Melds: chow 1-2-3 Wan (claimed) + chow 4-5-6 Wan (claimed)
      winner.melds = [
        { type: 'chow', claimed: true,
          tiles: [T(SUIT.CHAR,1), T(SUIT.CHAR,2), T(SUIT.CHAR,3)] },
        { type: 'chow', claimed: true,
          tiles: [T(SUIT.CHAR,4), T(SUIT.CHAR,5), T(SUIT.CHAR,6)] },
      ];
      winner.hand = [
        T(SUIT.CHAR,7), T(SUIT.CHAR,8), T(SUIT.CHAR,9),
        T(SUIT.WIND,seatWind), T(SUIT.WIND,seatWind), T(SUIT.WIND,seatWind),
        T(SUIT.WIND,'East'),
      ];
      const flowerIdx = ['East','South','West','North'].indexOf(seatWind);
      winner.bonus = [ T(SUIT.FLOWER, flowerIdx) ];
      winTile = T(SUIT.WIND, 'East');
      console.log(`[Demo] ${_demoSeat === 3 ? 'Left (North)' : 'Right (South)'} wins`);
    }

    if (_demoSeat === 0) {
      // ---- HUMAN (seat 0 = bottom) demo win — self-draw 自摸 ----
      placeholderWithMeld(1, SUIT.CHAR, SUIT.BAMBOO, 6); // Right: pung of 6-bam
      placeholderWithMeld(2, SUIT.CHAR, SUIT.CIRCLE, 4); // Top:   pung of 4-dot
      placeholderWithMeld(3, SUIT.CHAR, SUIT.BAMBOO, 2); // Left:  pung of 2-bam

      const winner = game.players[0];
      // Two claimed chows in the meld row
      winner.melds = [
        { type: 'chow', claimed: true,
          tiles: [T(SUIT.CHAR,1), T(SUIT.CHAR,2), T(SUIT.CHAR,3)] },
        { type: 'pung', claimed: true,
          tiles: [T(SUIT.DRAGON,'red'), T(SUIT.DRAGON,'red'), T(SUIT.DRAGON,'red')] },
      ];
      // Concealed hand: 4-5-6 Wan + 7-8-9 Wan + East-East pair + self-draw 9-man
      winner.hand = [
        T(SUIT.CHAR,4), T(SUIT.CHAR,5), T(SUIT.CHAR,6),
        T(SUIT.CHAR,7), T(SUIT.CHAR,8), T(SUIT.CHAR,9),
        T(SUIT.WIND,'East'), T(SUIT.WIND,'East'),
      ];
      winner.bonus = [ T(SUIT.FLOWER, 0) ]; // East flower bonus

      winTile = T(SUIT.WIND, 'East');
      winTile._justDrawn = true;
      winner.hand.push(winTile);
      winnerSeat = 0;

      // Self-draw: no discard — clear discard pile
      game.discardPile = [];
      game.discard     = null;
      game.discardSeat = null;
      game.phase       = PHASE.END;

      const ctx    = game.makeCtx(0, true);
      const result = canWin([...winner.hand], winner.melds, ctx);
      game.lastResult = {
        winner: 0, winTileId: winTile.id,
        faan: result.faan, label: result.label,
        selfDraw: true, gameOver: false,
      };
      game.currentSeat = 0;
      renderAll();

      // Advance cycle (same as main cycle path)
      _demoSeat = 3;
      _demoDealerIsWinner = !_demoDealerIsWinner;
      const dealerTagH = _demoDealerIsWinner ? ' 莊💡' : ' 💡';
      document.getElementById('demo-win-btn').textContent = `Demo Left${dealerTagH}`;
      return;
    }

    winTile._discardSeat = 0;
    winTile._discardIdxBySeat = 0;
    game.discardPile.push(winTile);
    game.discard     = winTile;
    game.discardSeat = 0;
    game.phase       = PHASE.END;

    const winner = game.players[winnerSeat];
    const ctx    = game.makeCtx(winnerSeat, false);
    const result = canWin([...winner.hand, winTile], winner.melds, ctx);
    game.lastResult = {
      winner: winnerSeat, winTileId: winTile.id,
      faan: result.faan, label: result.label,
      selfDraw: false, gameOver: false,
    };
    winner.hand.push(winTile);
    game.currentSeat = winnerSeat;

    renderAll();
    window.addMsg && window.addMsg('<strong>Demo Win</strong>: ' + (winnerSeat===3?'Left':winnerSeat===1?'Right':winnerSeat===2?'Top':'You') + ' wins — check tile layout');

    // Cycle: Left → Right → Top → You → Left(dealer) → Right(dealer) → Top(dealer) → Left ...
    // _demoDealerIsWinner flips after the full non-dealer cycle completes
    const prevSeat = _demoSeat;
    const prevDealer = _demoDealerIsWinner;
    if (_demoSeat === 3) { _demoSeat = 1; }
    else if (_demoSeat === 1) { _demoSeat = 2; }
    else if (_demoSeat === 2) { _demoSeat = 0; }
    else { // seat 0 (human)
      _demoSeat = 3;
      _demoDealerIsWinner = !_demoDealerIsWinner; // flip dealer mode after full cycle
    }
    const dealerTag = _demoDealerIsWinner ? ' 莊💡' : ' 💡';
    const nextName = { 3: `Left${dealerTag}`, 1: `Right${dealerTag}`, 2: `Top${dealerTag}`, 0: `You${dealerTag}` };
    document.getElementById('demo-win-btn').textContent = `Demo ${nextName[_demoSeat]}`;
  }

  document.getElementById('demo-win-btn').textContent = 'Demo Left 💡';
  document.getElementById('demo-win-btn').addEventListener('click', (e) => { e.stopPropagation(); runDemoWin(); });

  // ---- Demo Rob Kong button: set up 搶槓胡 (Robbing the Kong) scenarios ----
  // 4 variants cycle: A=Human robs, B=AI robs (human can't), C=Both can rob, D=Nobody robs (kong completes)
  // Kong is always declared by CPU1 (Right/South) for a consistent test seat.
  const _robVariants = ['A','B','C','D'];
  let _robVariantIdx = 0;

  document.getElementById('demo-rob-btn').addEventListener('click', (e) => { e.stopPropagation();
    let _robId = 7000;
    const T = (suit, value) => ({ id: _robId++, suit, value });
    const variant = _robVariants[_robVariantIdx];
    const kongSeat = 1; // CPU1 (Right/South) always declares the kong

    // Reset game state
    for (let i = 0; i < 4; i++) {
      game.players[i].hand  = [];
      game.players[i].melds = [];
      game.players[i].bonus = [];
    }
    game.discardPile  = [];
    game.discard      = null;
    game.discardSeat  = null;
    game.lastResult   = null;
    game.dealerSeat   = 0;
    game.phase        = PHASE.CLAIM;

    // The kong/robbing tile: 4 of Bamboo 🎋
    // Only sequence tiles can be robbed — someone can be waiting on 4-bam
    // to complete a 2-3-4 or 3-4-5 or 4-5-6 chow.
    const robbingTile = T(SUIT.BAMBOO, 4);

    // Kong declarer (CPU1/Right): pung of 4-Bamboo + the 4th tile in hand
    const kongDeclarer = game.players[kongSeat];
    kongDeclarer.melds = [
      { type: 'pung', claimed: true,
        tiles: [T(SUIT.BAMBOO,4), T(SUIT.BAMBOO,4), T(SUIT.BAMBOO,4)] },
      { type: 'chow', claimed: true,
        tiles: [T(SUIT.CHAR,7), T(SUIT.CHAR,8), T(SUIT.CHAR,9)] },
    ];
    kongDeclarer.hand = [
      T(SUIT.CHAR,1), T(SUIT.CHAR,2), T(SUIT.CHAR,3),
      T(SUIT.CHAR,4), T(SUIT.CHAR,5), T(SUIT.CHAR,6),
      robbingTile, // the 4th 4-Bam being upgraded to kong
    ];

    // Winning hand: waiting on 4-Bamboo to complete 2-3-[4] chow
    // Full hand: 1-2-3 Wan + 5-6-7 Wan + 8-9 Wan pair... 
    // Actually: 2-3 Bam (waiting for 4) + three other complete sets + pair
    // Sets: 1-2-3 Wan (chow) + 5-6-7 Wan (chow) + West-West-West (pung) + East-East (pair) + 2-3 Bam waiting
    const makeWinningHand = () => [
      T(SUIT.CHAR,1),  T(SUIT.CHAR,2),  T(SUIT.CHAR,3),   // chow 1-2-3 Wan
      T(SUIT.CHAR,5),  T(SUIT.CHAR,6),  T(SUIT.CHAR,7),   // chow 5-6-7 Wan
      T(SUIT.WIND,'West'), T(SUIT.WIND,'West'), T(SUIT.WIND,'West'), // pung West
      T(SUIT.WIND,'East'), T(SUIT.WIND,'East'),            // pair East
      T(SUIT.BAMBOO,2), T(SUIT.BAMBOO,3),                  // waiting for 4-Bam!
    ];

    // Dud hand: cannot win with 4-Bamboo
    const makeDudHand = () => {
      const h = [];
      for (let j = 0; j < 13; j++) h.push(T(SUIT.CHAR, (j % 9) + 1));
      return h;
    };

    // Set up each player's hand based on variant
    const human = game.players[0];
    // CPU3 (Left) is the potential AI robber bystander
    const aiRobSeat = 3;
    const aiRobPlayer = game.players[aiRobSeat];

    if (variant === 'A') {
      // Human robs (waiting 2-3 Bam), AI cannot
      human.hand = makeWinningHand();
      human.bonus = [ T(SUIT.FLOWER, 0) ];
      aiRobPlayer.hand = makeDudHand();
      aiRobPlayer.melds = [{ type:'pung', claimed:true,
        tiles:[T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6)] }];
    } else if (variant === 'B') {
      // AI (Left/CPU3) robs, human cannot
      human.hand = makeDudHand();
      aiRobPlayer.hand = makeWinningHand();
      aiRobPlayer.bonus = [ T(SUIT.FLOWER, 2) ];
      aiRobPlayer.melds = [{ type:'pung', claimed:true,
        tiles:[T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6)] }];
    } else if (variant === 'C') {
      // Both human AND AI (Left/CPU3) can rob — human gets first offer
      human.hand = makeWinningHand();
      human.bonus = [ T(SUIT.FLOWER, 0) ];
      aiRobPlayer.hand = makeWinningHand();
      aiRobPlayer.bonus = [ T(SUIT.FLOWER, 2) ];
      aiRobPlayer.melds = [{ type:'pung', claimed:true,
        tiles:[T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6)] }];
    } else {
      // D: Nobody can rob — pass to see kong complete normally
      human.hand = makeDudHand();
      aiRobPlayer.hand = makeDudHand();
      aiRobPlayer.melds = [{ type:'pung', claimed:true,
        tiles:[T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6)] }];
    }

    // CPU2 (Top) gets a plain placeholder
    game.players[2].hand = makeDudHand();
    game.players[2].melds = [{ type:'pung', claimed:true,
      tiles:[T(SUIT.BAMBOO,9),T(SUIT.BAMBOO,9),T(SUIT.BAMBOO,9)] }];

    // Compute human rob result
    const humanCtx = game.makeCtx(0, false);
    humanCtx.robbedKong = true;
    const humanRobResult = canWin([...human.hand, robbingTile], human.melds, humanCtx);
    const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 2;
    const humanCanRob = humanRobResult.win && humanRobResult.faan >= minF ? humanRobResult : false;

    // Compute AI rob result for CPU3
    const aiCtx = game.makeCtx(aiRobSeat, false);
    aiCtx.robbedKong = true;
    const aiRobResult = canWin([...aiRobPlayer.hand, robbingTile], aiRobPlayer.melds, aiCtx);
    const aiCanRob = aiRobResult.win && aiRobResult.faan >= minF ? aiRobResult : false;

    // Wire up robbing kong state
    game.robbingKongSeat    = kongSeat;
    game.robbingKongTile    = robbingTile;
    game.robbingKongTiles   = [robbingTile, ...kongDeclarer.melds[0].tiles];
    game.robbingKongPungIdx = 0;

    game.claimOptions = {
      win: humanCanRob,
      pung: false, kong: false, chow: false,
      robbingKong: true,
    };
    // AI robbers go into pendingClaims — if human passes, game.humanPass() resolves them
    game.pendingClaims = aiCanRob
      ? [{ seat: aiRobSeat, action: 'win', result: aiRobResult }]
      : [];

    game.currentSeat = kongSeat;
    game.discardSeat = kongSeat;
    game.phase = PHASE.CLAIM;

    renderAll();

    const variantDesc = {
      A: 'Human robs (waiting 2-3 Bam + 4) — AI cannot',
      B: 'AI Left/CPU3 robs (waiting 2-3 Bam + 4) — Human cannot (Pass to see AI win)',
      C: 'BOTH Human & AI waiting on 4-Bam — Human gets first choice',
      D: 'Nobody waiting on 4-Bam — Pass to see Kong complete normally',
    };
    console.log(`[Demo Rob] Variant ${variant}: ${variantDesc[variant]}`);
    console.log(`  Human rob: ${humanCanRob ? humanRobResult.faan+'f '+humanRobResult.label : 'NO'}`);
    console.log(`  AI rob:    ${aiCanRob ? aiRobResult.faan+'f '+aiRobResult.label : 'NO'}`);

    // Cycle through variants
    _robVariantIdx = (_robVariantIdx + 1) % 4;
    const nextVariant = _robVariants[_robVariantIdx];
    const nextLabel = { A:'Human 搶槓', B:'AI 搶槓', C:'Both 搶槓', D:'Nobody 搶槓' };
    document.getElementById('demo-rob-btn').textContent = `Demo Rob: ${nextLabel[nextVariant]}`;
  });

  // ---- Test: Rob Win 搶槓胡 — CPU1 upgrades pung→kong, CPU3 robs and wins ----
  document.getElementById('test-rob-win-btn')?.addEventListener('click', (e) => { e.stopPropagation();
    let _tid = 9000;
    const T = (suit, value) => ({ id: _tid++, suit, value, _justDrawn: false });

    // Suppress auto-advance during reset so startTurn(0) doesn't queue a stray aiPlay
    const origSchedule = game._scheduleOrStep.bind(game);
    game._scheduleOrStep = () => {};
    game.reset();
    game._scheduleOrStep = origSchedule;

    // after reset: roundWind='East', dealerSeat=0
    const kongTile = T(SUIT.BAMBOO, 4);
    const pungTiles = [T(SUIT.BAMBOO,4), T(SUIT.BAMBOO,4), T(SUIT.BAMBOO,4)];

    // CPU1 (seat 1): pung of 4-Bam in melds, 4th tile in hand
    const cpu1 = game.players[1];
    cpu1.melds = [
      { type:'pung', claimed:true, tiles: pungTiles },
      { type:'chow', claimed:true, tiles:[T(SUIT.CHAR,7),T(SUIT.CHAR,8),T(SUIT.CHAR,9)] },
    ];
    cpu1.hand = [
      kongTile,
      T(SUIT.CHAR,1),T(SUIT.CHAR,2),T(SUIT.CHAR,3),
      T(SUIT.CHAR,4),T(SUIT.CHAR,5),T(SUIT.CHAR,6),
      T(SUIT.BAMBOO,1),
    ];
    cpu1.bonus = [];

    // CPU3 (seat 3): waiting on 4-Bam. East pung = round wind = 1f, +1 robbed = 2f total
    const cpu3 = game.players[3];
    cpu3.melds = [];
    cpu3.hand = [
      T(SUIT.WIND,'East'), T(SUIT.WIND,'East'), T(SUIT.WIND,'East'), // pung East (round wind 1f)
      T(SUIT.CIRCLE,4), T(SUIT.CIRCLE,5), T(SUIT.CIRCLE,6),
      T(SUIT.CIRCLE,7), T(SUIT.CIRCLE,8), T(SUIT.CIRCLE,9),
      T(SUIT.BAMBOO,2), T(SUIT.BAMBOO,3),   // waiting for 4-Bam!
      T(SUIT.WIND,'North'), T(SUIT.WIND,'North'),  // pair
    ];
    cpu3.bonus = [];

    // Human and CPU2: dud hands (cannot rob)
    const makeDud = () => { const h=[]; for(let j=0;j<13;j++) h.push(T(SUIT.CHAR,(j%9)+1)); return h; };
    game.players[0].hand = makeDud(); game.players[0].melds = []; game.players[0].bonus = [];
    game.players[2].hand = makeDud(); game.players[2].melds = []; game.players[2].bonus = [];

    game.discardPile = []; game.discard = null; game.discardSeat = null;
    game.claimOptions = null; game.pendingClaims = [];
    game.currentSeat = 1;
    game.phase = PHASE.DISCARD;

    addMsg('<strong>Test: Rob Win</strong> — CPU1 (seat 1) upgrades 4-Bamboo pung→Kong. CPU3 (seat 3) is waiting on 4-Bam and can rob it (East pung + Robbed Kong = 2 faan). <em>HUMAN mode: click Pass to let CPU3 rob and win.</em>');
    renderAll();
    game.doSelfKong(1, [kongTile, ...pungTiles]);
    renderAll();
  });

  // ---- Test: Kong Completes 槓完 — CPU1 upgrades pung→kong, nobody robs, game continues ----
  document.getElementById('test-kong-done-btn')?.addEventListener('click', (e) => { e.stopPropagation();
    let _tid = 9500;
    const T = (suit, value) => ({ id: _tid++, suit, value, _justDrawn: false });

    const origSchedule = game._scheduleOrStep.bind(game);
    game._scheduleOrStep = () => {};
    game.reset();
    game._scheduleOrStep = origSchedule;

    const kongTile = T(SUIT.BAMBOO, 4);
    const pungTiles = [T(SUIT.BAMBOO,4), T(SUIT.BAMBOO,4), T(SUIT.BAMBOO,4)];

    // CPU1 (seat 1): pung of 4-Bam in melds, 4th tile in hand
    const cpu1 = game.players[1];
    cpu1.melds = [
      { type:'pung', claimed:true, tiles: pungTiles },
      { type:'chow', claimed:true, tiles:[T(SUIT.CHAR,7),T(SUIT.CHAR,8),T(SUIT.CHAR,9)] },
    ];
    cpu1.hand = [
      kongTile,
      T(SUIT.CHAR,1),T(SUIT.CHAR,2),T(SUIT.CHAR,3),
      T(SUIT.CHAR,4),T(SUIT.CHAR,5),T(SUIT.CHAR,6),
      T(SUIT.BAMBOO,1),
    ];
    cpu1.bonus = [];

    // All others: dud hands — nobody can rob
    const makeDud = () => { const h=[]; for(let j=0;j<13;j++) h.push(T(SUIT.CHAR,(j%9)+1)); return h; };
    game.players[0].hand = makeDud(); game.players[0].melds = []; game.players[0].bonus = [];
    game.players[2].hand = makeDud(); game.players[2].melds = []; game.players[2].bonus = [];
    game.players[3].hand = makeDud(); game.players[3].melds = []; game.players[3].bonus = [];

    game.discardPile = []; game.discard = null; game.discardSeat = null;
    game.claimOptions = null; game.pendingClaims = [];
    game.currentSeat = 1;
    game.phase = PHASE.DISCARD;

    addMsg('<strong>Test: Kong Completes</strong> — CPU1 (seat 1) upgrades 4-Bamboo pung→Kong. Nobody can rob. Kong completes immediately: CPU1 draws a replacement tile, discards, and the game continues.');
    renderAll();
    game.doSelfKong(1, [kongTile, ...pungTiles]);
    renderAll();
  });

  // ---- Demo Overflow 溢: extreme side-player layouts to verify claim-column capping ----
  document.getElementById('demo-overflow-btn')?.addEventListener('click', (e) => { e.stopPropagation();
    let _ovId = 6000;
    const T = (suit, value) => ({ id: _ovId++, suit, value, _justDrawn: false });

    for (let i = 0; i < 4; i++) {
      game.players[i].hand  = [];
      game.players[i].melds = [];
      game.players[i].bonus = [];
    }
    game.discardPile = []; game.discard = null; game.discardSeat = null;
    game.lastResult = null; game.dealerSeat = 1; game.currentSeat = 1;
    game.phase = PHASE.DISCARD;

    // BOTTOM / Human (seat 0): 4 kongs → 3 fit in melds row (12 cap), 4th kong + all bonus → hand row
    const human = game.players[0];
    human.melds = [
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,1),T(SUIT.BAMBOO,1),T(SUIT.BAMBOO,1),T(SUIT.BAMBOO,1)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,2),T(SUIT.BAMBOO,2),T(SUIT.BAMBOO,2),T(SUIT.BAMBOO,2)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,3),T(SUIT.BAMBOO,3),T(SUIT.BAMBOO,3),T(SUIT.BAMBOO,3)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,4),T(SUIT.BAMBOO,4),T(SUIT.BAMBOO,4),T(SUIT.BAMBOO,4)] },
    ];
    human.bonus = [T(SUIT.FLOWER,0), T(SUIT.FLOWER,1), T(SUIT.SEASON,0), T(SUIT.SEASON,1)];
    human.hand = [T(SUIT.CHAR,1), T(SUIT.CHAR,2)];

    // TOP (seat 2): 4 kongs → 3 fit in melds row (12 cap), 4th kong + all bonus → hand row
    const top = game.players[2];
    top.melds = [
      { type:'kong', claimed:true, tiles:[T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6),T(SUIT.CIRCLE,6)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.CIRCLE,7),T(SUIT.CIRCLE,7),T(SUIT.CIRCLE,7),T(SUIT.CIRCLE,7)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.CIRCLE,8),T(SUIT.CIRCLE,8),T(SUIT.CIRCLE,8),T(SUIT.CIRCLE,8)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.CIRCLE,9),T(SUIT.CIRCLE,9),T(SUIT.CIRCLE,9),T(SUIT.CIRCLE,9)] },
    ];
    top.bonus = [T(SUIT.FLOWER,2), T(SUIT.FLOWER,3), T(SUIT.SEASON,2), T(SUIT.SEASON,3)];
    top.hand = [T(SUIT.WIND,'East'), T(SUIT.WIND,'South')];

    // RIGHT (seat 1): 4 kongs (16 tiles) + 8 bonus tiles → only 3 kongs fit (12) in claim
    // 4th kong and all 8 bonus overflow into hand column
    const right = game.players[1];
    right.melds = [
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,1),T(SUIT.BAMBOO,1),T(SUIT.BAMBOO,1),T(SUIT.BAMBOO,1)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,2),T(SUIT.BAMBOO,2),T(SUIT.BAMBOO,2),T(SUIT.BAMBOO,2)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,3),T(SUIT.BAMBOO,3),T(SUIT.BAMBOO,3),T(SUIT.BAMBOO,3)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.BAMBOO,4),T(SUIT.BAMBOO,4),T(SUIT.BAMBOO,4),T(SUIT.BAMBOO,4)] },
    ];
    right.bonus = [
      T(SUIT.FLOWER,0), T(SUIT.FLOWER,1), T(SUIT.FLOWER,2), T(SUIT.FLOWER,3),
      T(SUIT.SEASON,0), T(SUIT.SEASON,1), T(SUIT.SEASON,2), T(SUIT.SEASON,3),
    ];
    const winTileR = T(SUIT.WIND,'East'); winTileR._justDrawn = true;
    right.hand = [ winTileR ];

    // LEFT (seat 3): 2 kongs + 3 pungs + 4 bonus → kongs(8) + pung1(3)=11, pung2→overflow, pung3→overflow
    // bonus: 1 fits (12-11=1), remaining 3 overflow
    const left = game.players[3];
    left.melds = [
      { type:'kong', claimed:true, tiles:[T(SUIT.CIRCLE,1),T(SUIT.CIRCLE,1),T(SUIT.CIRCLE,1),T(SUIT.CIRCLE,1)] },
      { type:'kong', claimed:true, tiles:[T(SUIT.CIRCLE,2),T(SUIT.CIRCLE,2),T(SUIT.CIRCLE,2),T(SUIT.CIRCLE,2)] },
      { type:'pung', claimed:true, tiles:[T(SUIT.CIRCLE,3),T(SUIT.CIRCLE,3),T(SUIT.CIRCLE,3)] },
      { type:'pung', claimed:true, tiles:[T(SUIT.CIRCLE,4),T(SUIT.CIRCLE,4),T(SUIT.CIRCLE,4)] },
      { type:'pung', claimed:true, tiles:[T(SUIT.CIRCLE,5),T(SUIT.CIRCLE,5),T(SUIT.CIRCLE,5)] },
    ];
    left.bonus = [
      T(SUIT.FLOWER,0), T(SUIT.FLOWER,1), T(SUIT.FLOWER,2), T(SUIT.FLOWER,3),
    ];
    for (let j = 0; j < 2; j++) left.hand.push(T(SUIT.WIND, 'West'));

    renderAll();
  });

  // ---- Demo Discard Ovf: fill discard pile to show center-row overflow scanning ----
  // Each seat gets 7 normal discards (first row) then 3 overflow tiles, interleaved
  // in time order so the scan-and-skip logic plays out exactly as it would in a real game.
  // Seat colours: bottom=bamboo, right=circle, top=char, left=wind.
  document.getElementById('demo-discard-ovf-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    let _id = 8000;
    const T = (suit, val, seat, idx) => ({
      id: _id++, suit, value: val, _justDrawn: false,
      _discardSeat: seat, _discardIdxBySeat: idx,
    });
    for (let i = 0; i < 4; i++) {
      game.players[i].hand = []; game.players[i].melds = []; game.players[i].bonus = [];
    }
    game.discardPile = []; game.discard = null; game.discardSeat = null;
    game.lastResult = null; game.phase = PHASE.DISCARD;
    game.currentSeat = 0; game.dealerSeat = 0;

    const SEAT_SUIT = [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR, SUIT.WIND];
    const WINDS     = ['East','South','West','North'];
    const tileVal   = (suit, n) => suit === SUIT.WIND ? WINDS[n % 4] : (n % 9) + 1;

    // 7 normal tiles per seat (fills outermost discard row for each zone), interleaved
    for (let idx = 0; idx < 7; idx++)
      for (let seat = 0; seat < 4; seat++)
        game.discardPile.push(T(SEAT_SUIT[seat], tileVal(SEAT_SUIT[seat], idx), seat, idx));

    // 3 overflow tiles per seat, interleaved — tests scan-and-skip across all 7 center slots
    for (let oi = 0; oi < 3; oi++)
      for (let seat = 0; seat < 4; seat++)
        game.discardPile.push(T(SEAT_SUIT[seat], tileVal(SEAT_SUIT[seat], oi), seat, 21 + oi));

    renderAll();
  });

  // ---- Demo Discard T+B Ovf: Top and Bottom overflow only; Left and Right sit tight ----
  // Shows the round-robin scan in isolation: only seats 0 (bottom/bamboo) and 2 (top/char)
  // discard. 7 normal tiles each fill their zones, then 4 overflow tiles each exercise all
  // 7 center slots — no Left/Right interference to cloud the picture.
  document.getElementById('demo-discard-tb-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    let _id = 9000;
    const T = (suit, val, seat, idx) => ({
      id: _id++, suit, value: val, _justDrawn: false,
      _discardSeat: seat, _discardIdxBySeat: idx,
    });
    for (let i = 0; i < 4; i++) {
      game.players[i].hand = []; game.players[i].melds = []; game.players[i].bonus = [];
    }
    game.discardPile = []; game.discard = null; game.discardSeat = null;
    game.lastResult = null; game.phase = PHASE.DISCARD;
    game.currentSeat = 0; game.dealerSeat = 0;

    const tileVal = (suit, n) => suit === SUIT.WIND ? ['East','South','West','North'][n % 4] : (n % 9) + 1;

    // 7 normal tiles per seat, interleaved Bottom then Top
    for (let idx = 0; idx < 7; idx++) {
      game.discardPile.push(T(SUIT.BAMBOO, tileVal(SUIT.BAMBOO, idx), 0, idx)); // Bottom
      game.discardPile.push(T(SUIT.CHAR,   tileVal(SUIT.CHAR,   idx), 2, idx)); // Top
    }
    // 4 overflow tiles each — enough to exhaust one side's primary range and trigger fallback
    for (let oi = 0; oi < 4; oi++) {
      game.discardPile.push(T(SUIT.BAMBOO, tileVal(SUIT.BAMBOO, oi), 0, 21 + oi)); // Bottom
      game.discardPile.push(T(SUIT.CHAR,   tileVal(SUIT.CHAR,   oi), 2, 21 + oi)); // Top
    }
    renderAll();
  });

  // ---- Run All Tests 🧪 -------------------------------------------------------
  // Runs the in-browser demo test suite and stores results in window._testResults.
  // AI agents: click #run-all-tests-btn, then poll window._testResults.done.
  document.getElementById('run-all-tests-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    window._testResults = { done: false };
    const _res = [];
    const ok  = name       => { _res.push({ name, ok: true });        };
    const err = (name, why) => { _res.push({ name, ok: false, why }); };

    const delay = ms => new Promise(r => setTimeout(r, ms));
    const tap   = id => { document.getElementById(id)?.click(); return delay(450); };
    const gs    = ()  => ({
      phase:      game.phase,
      lastWinner: game.lastResult?.winner ?? null,
      win:        game.claimOptions?.win !== false && !!game.claimOptions?.win,
      winLabel:   game.claimOptions?.win?.label ?? null,
      earthly:    !!game.claimOptions?._earthlyHand,
      robbing:    game.robbingKongSeat ?? null,
      hand0:      game.players[0].hand.length,
    });

    // Demo Win — cycles Left(3)→Right(1)→Top(2)→You(0)
    const winSeats = [3,1,2,0], winNames=['Left(3)','Right(1)','Top(2)','You(0)'];
    for (let i = 0; i < 4; i++) {
      await tap('demo-win-btn');
      const s = gs();
      s.lastWinner === winSeats[i] ? ok(`Demo Win ${winNames[i]}`) : err(`Demo Win ${winNames[i]}`, `winner=${s.lastWinner}`);
    }

    // Demo Heavenly 天胡
    game.reset(); await tap('demo-heavenly-btn');
    { const s = gs(); (s.phase==='claim' && s.win && s.winLabel?.includes('Heavenly') && s.hand0===14) ? ok('Demo Heavenly 天胡') : err('Demo Heavenly 天胡', JSON.stringify(s)); }

    // Demo Earthly 地胡
    game.reset(); await tap('demo-earthly-btn');
    { const s = gs(); (s.phase==='claim' && s.win && s.earthly) ? ok('Demo Earthly 地胡') : err('Demo Earthly 地胡', JSON.stringify(s)); }

    // Demo Concealed Kong 暗槓
    game.reset(); await tap('demo-ckong-btn');
    { const s = gs();
      const bam1 = game.players[0].hand.filter(t => t.suit==='bamboo' && t.value===1).length;
      (s.phase==='discard' && bam1===4) ? ok('Demo Concealed Kong 暗槓') : err('Demo Concealed Kong 暗槓', `phase=${s.phase} bam1=${bam1}`); }

    // Demo Last Tile 海底撈月 (has 500ms internal setTimeout)
    game.reset(); await tap('demo-lasttile-btn');
    await delay(800);
    { const s = gs(); (s.phase==='claim' && s.win && s.winLabel?.includes('Last Tile')) ? ok('Demo Last Tile 海底') : err('Demo Last Tile 海底', JSON.stringify(s)); }

    // Demo Rob 搶槓 — 4 variants
    const robExpect = [
      { label:'A Human robs', humanWin:true },
      { label:'B AI robs',    humanWin:false },
      { label:'C Both rob',   humanWin:true },
      { label:'D Nobody robs',humanWin:false },
    ];
    for (const v of robExpect) {
      game.reset(); await tap('demo-rob-btn');
      const s = gs();
      (s.robbing !== null && (game.claimOptions?.win !== false) === v.humanWin)
        ? ok(`Demo Rob ${v.label}`) : err(`Demo Rob ${v.label}`, `robbing=${s.robbing} humanWin=${game.claimOptions?.win !== false}`);
    }

    // Test Rob Win 搶槓胡
    game.reset(); await tap('test-rob-win-btn');
    { const s = gs();
      const cpu3Robs = game.pendingClaims?.some(c => c.action==='win' && c.seat===3);
      (s.robbing !== null && cpu3Robs) ? ok('Test Rob Win 搶槓胡') : err('Test Rob Win 搶槓胡', `robbing=${s.robbing} cpu3Robs=${cpu3Robs}`); }

    // Test Kong Completes 槓完
    game.reset(); await tap('test-kong-done-btn');
    { const cpu1Kong = game.players[1].melds.some(m => m.type==='kong' && m.tiles.some(t => t.suit==='bamboo' && t.value===4));
      cpu1Kong ? ok('Test Kong Completes 槓完') : err('Test Kong Completes 槓完', 'CPU1 kong not found'); }

    // Publish results
    const passed = _res.filter(r => r.ok).length;
    const failed = _res.filter(r => !r.ok);
    window._testResults = { done: true, passed, total: _res.length, failed: failed.length, details: _res };

    // Show floating result panel
    let panel = document.getElementById('_test-results-panel');
    if (!panel) { panel = document.createElement('div'); panel.id = '_test-results-panel';
      Object.assign(panel.style, { position:'fixed', top:'10px', left:'50%', transform:'translateX(-50%)',
        background:'#1a1a2e', border:'2px solid #4a9', borderRadius:'8px', padding:'12px 16px',
        zIndex:9999, fontFamily:'monospace', fontSize:'13px', color:'#eee', maxHeight:'80vh',
        overflowY:'auto', minWidth:'340px', boxShadow:'0 4px 24px #000a' });
      document.body.appendChild(panel); }
    panel.innerHTML = `<strong>🧪 Test Results — ${passed}/${_res.length} passed</strong><br>`
      + _res.map(r => `${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '<br>  <small style="color:#f88">'+r.why+'</small>'}`).join('<br>')
      + `<br><br><button onclick="this.parentElement.remove()" style="cursor:pointer">Close</button>`;
  });

  // ---- Rotate Seats button ----
  (function setupRotateSeats() {
    const modal    = document.getElementById('rotate-modal');
    const openBtn  = document.getElementById('rotate-seats-btn');
    const cancelBtn= document.getElementById('rotate-cancel-btn');
    const shuffleBtn= document.getElementById('rotate-shuffle-btn');
    const confirmBtn= document.getElementById('rotate-confirm-btn');
    const select   = document.getElementById('last-dealer-select');
    const preview  = document.getElementById('rotate-preview');
    const previewSeats = document.getElementById('rotate-preview-seats');

    // Position names for display
    const POS_LABEL = ['Bottom (You)', 'Right', 'Top', 'Left'];
    const POS_WIND  = ['East 東','South 南','West 西','North 北'];

    let _pendingOrder = null; // shuffled CPU names for seats 1,2,3
    let _pendingDealerSeat = null; // the seat that will be East after apply

    function openModal() {
      // Populate last-dealer dropdown with all players
      select.innerHTML = '';
      for (const p of game.players) {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name === 'You' ? 'You (Human)' : p.name;
        // Pre-select current dealer
        if (p.seat === game.dealerSeat) opt.selected = true;
        select.appendChild(opt);
      }
      _pendingOrder = null;
      _pendingDealerSeat = null;
      preview.style.display = 'none';
      confirmBtn.style.display = 'none';
      modal.classList.remove('hidden');
    }

    function doShuffle() {
      // Shuffle CPU seats 1-3 randomly, avoiding current and last-pending arrangements
      const cpuNames = [1,2,3].map(s => game.players[s].name);
      const avoid1 = [...cpuNames];
      const avoid2 = _pendingOrder ? [..._pendingOrder] : null;

      let shuffled;
      let tries = 0;
      do {
        shuffled = [...cpuNames];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        tries++;
      } while (tries < 200 && (
        shuffled.every((n,i) => n === avoid1[i]) ||
        (avoid2 && shuffled.every((n,i) => n === avoid2[i]))
      ));
      _pendingOrder = shuffled;

      // New dealer seat is fully random among all 4 seats, avoid repeating current dealer
      let newDealerSeat;
      let dtries = 0;
      do {
        newDealerSeat = Math.floor(Math.random() * 4);
        dtries++;
      } while (dtries < 50 && newDealerSeat === (_pendingDealerSeat ?? game.dealerSeat));
      _pendingDealerSeat = newDealerSeat;

      // Build preview: seat 0=You always, seats 1-3=shuffled CPUs; winds relative to new dealer
      const newSeats = ['You', ...shuffled];
      let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<tr style="color:#ffd34d;border-bottom:1px solid #2a8b4e;">';
      html += '<th style="text-align:left;padding:3px 6px;">Position</th>';
      html += '<th style="text-align:left;padding:3px 6px;">Player</th>';
      html += '<th style="text-align:left;padding:3px 6px;">Wind</th></tr>';
      for (let s = 0; s < 4; s++) {
        const name = newSeats[s];
        const windIdx = (s - _pendingDealerSeat + 4) % 4;
        const wind = POS_WIND[windIdx];
        const isDealer = s === _pendingDealerSeat;
        const isHuman  = s === 0;
        html += `<tr style="${isDealer ? 'color:#ffd34d;font-weight:700;' : ''}">`;
        html += `<td style="padding:3px 6px;">${POS_LABEL[s]}</td>`;
        html += `<td style="padding:3px 6px;">${name}${isHuman ? ' 👤' : ''}${isDealer ? ' 🎲' : ''}</td>`;
        html += `<td style="padding:3px 6px;">${wind}${isDealer ? ' (Dealer/East)' : ''}</td>`;
        html += '</tr>';
      }
      html += '</table>';
      previewSeats.innerHTML = html;
      preview.style.display = 'block';
      confirmBtn.style.display = 'inline-block';
    }

    function doConfirm() {
      const lastDealerName = select.value;
      game.rotatePlayers(lastDealerName, _pendingOrder, _pendingDealerSeat);
      renderAll();
      modal.classList.add('hidden');
      _pendingOrder = null;
      _pendingDealerSeat = null;
    }

    openBtn.addEventListener('click', (e) => { e.stopPropagation(); openModal(); });
    cancelBtn.addEventListener('click', () => { modal.classList.add('hidden'); });
    shuffleBtn.addEventListener('click', doShuffle);
    confirmBtn.addEventListener('click', doConfirm);
    // Click outside modal content to cancel
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  })();

  function getHumanHandLayoutSummary() {
    const handEl = document.querySelector('.seat-bottom .hand');
    if (!handEl) {
      return {
        tileCount: 0,
        ghostCount: 0,
        drawSlotCount: 0,
        smallCount: 0,
        slotCount: 0,
        uiLayoutOk: false,
        reason: 'missing bottom hand',
      };
    }

    const tileCount = handEl.querySelectorAll('.tile').length;
    const ghostCount = handEl.querySelectorAll('.tile-ghost').length;
    const drawSlotCount = handEl.querySelectorAll('.draw-slot').length;
    const smallCount = handEl.querySelectorAll('.small').length;
    const slotCount = tileCount + ghostCount;
    const hasJustDrawn = !!game.players?.[0]?.hand?.some(t => t._justDrawn);
    const isClaimPath = game.phase === 'claim';

    const uiLayoutOk = hasJustDrawn
      ? (tileCount === 14 && ghostCount === 0 && drawSlotCount === 0 && smallCount === 0)
      : isClaimPath
        ? (slotCount === 14 && drawSlotCount === 1 && smallCount === 0)
        : (tileCount === 14 && ghostCount === 0 && drawSlotCount === 0 && smallCount === 0);

    return {
      tileCount,
      ghostCount,
      drawSlotCount,
      smallCount,
      slotCount,
      uiLayoutOk,
    };
  }

  // ---- Scenario tester: poll localStorage for injected test states ----
  setInterval(() => {
    try {
      const raw = localStorage.getItem('mahjongScenario');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s.scenario || !s.ts) return;
      if (Date.now() - s.ts > 30000) return; // ignore stale (>30s)
      localStorage.removeItem('mahjongScenario'); // consume it

      console.log('[Scenario] Injecting:', JSON.stringify(s).slice(0,300));

      // Clear all player hands/melds so old game state doesn't bleed through
      for (let i = 0; i < 4; i++) {
        game.players[i].hand  = [];
        game.players[i].melds = [];
        game.players[i].bonus = [];
      }

      // Apply per-seat hands from allPlayers (new format) or fall back to humanHand (legacy)
      if (s.allPlayers && s.allPlayers.length > 0) {
        for (const pd of s.allPlayers) {
          const p = game.players[pd.seat];
          p.hand  = (pd.hand  || []).map(t => ({...t}));
          p.melds = (pd.melds || []).map(m => ({...m, tiles: m.tiles.map(t=>({...t}))}));
          p.bonus = (pd.bonus || []).map(t => ({...t}));
        }
      } else {
        const human = game.players[0];
        human.hand  = (s.humanHand  || []).map(t => ({...t}));
        human.melds = (s.humanMelds || []).map(m => ({...m, tiles: m.tiles.map(t=>({...t}))}));
        human.bonus = (s.humanBonus || []).map(t => ({...t}));
      }

      // Give CPU players without explicit hands placeholder tiles
      for (let i = 1; i <= 3; i++) {
        if (game.players[i].hand.length === 0) {
          for (let j = 0; j < 13; j++) game.players[i].hand.push({ id: 9000+i*100+j, suit:'char', value:1, _placeholder:true });
        }
      }

      game.dealerSeat  = s.dealerSeat ?? 0;
      game.roundWind   = s.roundWind  ?? 'East';
      game.currentSeat = 0;
      game.discardPile = [];
      game.lastResult  = null;
      // Always reset rob-kong state so a previous rob-kong injection doesn't bleed into the next scenario
      game.robbingKongSeat = null; game.robbingKongTile = null;
      game.robbingKongTiles = null; game.robbingKongPungIdx = null;

      const human = game.players[0];

      if (s._robbingKong) {
        // Robbing-kong scenario: a CPU player upgrades pung→kong, others may rob
        const kongSeat = s.robbingKongSeat ?? 1;
        const kongTile = s.robbingKongTile ? { ...s.robbingKongTile } : null;
        game.robbingKongSeat     = kongSeat;
        game.robbingKongTile     = kongTile;
        game.robbingKongTiles    = (s.robbingKongTiles || []).map(t => ({...t}));
        game.robbingKongPungIdx  = s.robbingKongPungIdx ?? 0;
        game.discard = null;
        game.discardSeat = kongSeat;

        let humanCanRob = false;
        const aiRobbers = [];
        const minFRob = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
        if (kongTile) {
          // Check human
          const hCtx = game.makeCtx(0, false); hCtx.robbedKong = true;
          const hRes = canWin([...human.hand, kongTile], human.melds, hCtx);
          if (hRes.win && hRes.faan >= minFRob) humanCanRob = hRes;
          // Check AIs
          for (let i = 1; i <= 3; i++) {
            const s2 = (kongSeat + i) % 4;
            if (s2 === 0) continue;
            const ap = game.players[s2];
            const aCtx = game.makeCtx(s2, false); aCtx.robbedKong = true;
            const aRes = canWin([...ap.hand, kongTile], ap.melds, aCtx);
            if (aRes.win && aRes.faan >= minFRob) aiRobbers.push({ seat: s2, result: aRes });
          }
          // Counter-clockwise priority
          const hDiff = (0 - kongSeat + 4) % 4;
          if (humanCanRob) {
            const closerAI = aiRobbers.find(r => ((r.seat - kongSeat + 4) % 4) < hDiff);
            if (closerAI) humanCanRob = false;
          }
          aiRobbers.sort((a, b) => ((a.seat - kongSeat + 4) % 4) - ((b.seat - kongSeat + 4) % 4));
        }

        if (humanCanRob || aiRobbers.length > 0) {
          game.claimOptions  = { win: humanCanRob, pung: false, kong: false, chow: false, robbingKong: true };
          game.pendingClaims = aiRobbers.map(r => ({ seat: r.seat, action: 'win', result: r.result }));
          game.phase = PHASE.CLAIM;
        } else {
          game.claimOptions  = null;
          game.pendingClaims = [];
          game.phase = PHASE.DISCARD; // nobody can rob — no pause
        }
      } else if (s.phase === 'claim') {
        game.phase = 'claim';
        const discardSeat = s.discardFrom ?? 1;
        game.discardSeat = discardSeat;
        const dt = s.discardTile ? { ...s.discardTile, _discardSeat: discardSeat } : null;
        game.discard = dt;
        if (dt) {
          game.discardPile.push(dt);
          // Use processClaims — it handles priority, hijack suppression, pendingClaims all at once
          // Temporarily suppress onUpdate side-effects by overriding it
          const origUpdate = game.onUpdate;
          const origSchedule = game._scheduleOrStep.bind(game);
          game._scheduleOrStep = () => {}; // don't auto-advance
          game.processClaims(discardSeat, dt);
          game._scheduleOrStep = origSchedule;
          game.onUpdate = origUpdate;
        }
      } else {
        game.phase = 'discard';
        game.discard = null;
        // Honour _justDrawn flags already set by tester; if none set, mark last tile
        const hasJustDrawn = human.hand.some(t => t._justDrawn);
        if (!hasJustDrawn && human.hand.length > 0) {
          human.hand[human.hand.length - 1]._justDrawn = true;
        }
        const bCtx = game.makeCtx(0, true);
        const bResult = canWin(human.hand, human.melds, bCtx);
        // Check self-kong (4 in hand, or drawn tile matches existing pung meld)
        const selfKong = game.findSelfKong(human);
        if (bResult.win) {
          game.claimOptions = { win: bResult, pung: false, kong: !!selfKong, chow: false };
          game.phase = PHASE.CLAIM;
        } else if (selfKong) {
          game.claimOptions = { win: false, pung: false, kong: selfKong, chow: false };
          game.phase = PHASE.CLAIM;
        } else {
          game.claimOptions = null;
        }
      }

      renderAll();
      console.log('[Scenario] Done. phase='+game.phase+' claimOptions='+JSON.stringify(game.claimOptions));
      console.log('[Scenario] pendingClaims='+JSON.stringify(game.pendingClaims));

      // Always write action log — includes hijack info and UI layout verification
      const opts = game.claimOptions || {};
      const hijacker = game.pendingClaims && game.pendingClaims.length > 0
        ? game.pendingClaims.find(c => c.action === 'win') : null;
      const uiSummary = getHumanHandLayoutSummary();

      // Compute post-PASS winner: which AI player wins if human presses Pass?
      let passWinnerSeat = null, passWinFaan = null, passWinLabel = null;
      if (game.phase === PHASE.CLAIM && game.robbingKongSeat !== null && game.pendingClaims.length > 0) {
        // Robbing-kong: best pending robber wins on pass
        const minFpw = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
        const robbers = game.pendingClaims.filter(c => c.action === 'win' && c.result?.faan >= minFpw);
        if (robbers.length > 0) {
          passWinnerSeat = robbers[0].seat;
          passWinFaan    = robbers[0].result.faan;
          passWinLabel   = robbers[0].result.label;
        }
      } else if (game.phase === PHASE.CLAIM && game.discard && game.pendingClaims && game.pendingClaims.length > 0) {
        const fromSeat = game.discardSeat ?? 0;
        const winClaims = game.pendingClaims
          .filter(c => c.action === 'win')
          .sort((a, b) => ((a.seat - fromSeat + 4) % 4) - ((b.seat - fromSeat + 4) % 4));
        if (winClaims.length > 0) {
          const best = winClaims[0];
          const pw = game.players[best.seat];
          if (pw) {
            const pwCtx = game.makeCtx(best.seat, false);
            const pwHand = [...pw.hand, game.discard];
            const minFpw = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
            const pwResult = canWin(pwHand, pw.melds, pwCtx);
            if (pwResult.win && pwResult.faan >= minFpw) {
              passWinnerSeat = best.seat;
              passWinFaan = pwResult.faan;
              passWinLabel = pwResult.label;
            }
          }
        }
      }

      localStorage.setItem('mahjongActionLog', JSON.stringify({
        ts: Date.now(),
        injectId: s.injectId ?? null,   // echo back the injection ID for matching
        win:  !!(opts.win),
        pung: !!(opts.pung),
        kong: !!(opts.kong),
        chow: !!(opts.chow),
        hijackedBy: hijacker ? hijacker.seat : null,
        winSuppressed: !!(opts._winSuppressed),
        uiLayoutOk: !!uiSummary.uiLayoutOk,
        uiSummary,
        passWinnerSeat,
        passWinFaan,
        passWinLabel,
      }));
    } catch(e) {
      console.error('[Scenario] inject error:', e);
    }
  }, 1500);
});
