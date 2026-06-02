// ============================================================
// ui.js  — DOM rendering and input handling
// ============================================================

let _game = null;
let _selectedTileId = null;
let _chowChoices = []; // tiles the player picks for chow
let _peekWin = null;
let _wallWin = null;
let _wallBC = null;
let _sprintLogWin = null;
let _sprintLogBC = null;

function _broadcastWallState() {
  if (!_game) return;
  const data = {
    wall:          _game.wall.map(t => ({ id: t.id, suit: t.suit, value: t.value })),
    wallIdx:       _game.wallIdx       ?? 0,
    tailCol:       _game.tailCol       ?? 71,
    tailPhase:     _game.tailPhase     ?? 0,
    wallBreakSeat: _game.wallBreakSeat ?? 0,
    wallBreakCount:_game.wallBreakCount?? 0,
    dice:          _game.dice          ?? [],
    diceTotal:     _game.diceTotal     ?? 0,
    dealerSeat:    _game.dealerSeat    ?? 0,
  };
  try { localStorage.setItem('mahjong-wall-state', JSON.stringify(data)); } catch(e) {}
  if (!_wallBC) _wallBC = new BroadcastChannel('mahjong-wall');
  _wallBC.postMessage(data);
}

function _getSchemeLabel(selId) {
  const sel = document.getElementById(selId);
  if (!sel || !sel.value) return null;
  return sel.options[sel.selectedIndex]?.text || null;
}

function _broadcastSprintLog() {
  const payload = {
    log:        window._sprintLog ?? [],
    done:       window._sprintDone ?? 0,
    target:     window._sprintTarget ?? 50,
    startScores: window._sprintStartScores ?? null,
    levels: [
      window.AUTO_USER_LEVEL ?? 1,
      parseInt(document.getElementById('cpu1-level')?.value) || 1,
      parseInt(document.getElementById('cpu2-level')?.value) || 1,
      parseInt(document.getElementById('cpu3-level')?.value) || 1,
    ],
    schemes: [
      _getSchemeLabel('user-scheme-select'),
      _getSchemeLabel('cpu1-scheme'),
      _getSchemeLabel('cpu2-scheme'),
      _getSchemeLabel('cpu3-scheme'),
    ],
  };
  if (!_sprintLogBC) _sprintLogBC = new BroadcastChannel('mahjong-sprint-log');
  _sprintLogBC.postMessage(payload);
  try { localStorage.setItem('mahjong-sprint-log-state', JSON.stringify(payload)); } catch(e) {}
}

let _windIndicatorChinese = true;
let _showSeatParens = false;
let _alwaysHint = false;

// Dice face unicode
function dieFace(n) {
  return ['','⚀','⚁','⚂','⚃','⚄','⚅'][n] || n;
}

function seatName(seat) {
  if (!_game) return SEAT_NAMES[seat];
  const wind = _game.getSeatWind(seat);
  const zh = { East:'東', South:'南', West:'西', North:'北' }[wind] || '';
  const p = _game.players[seat];
  const pname = p ? (p.isHuman ? 'You' : p.name) : '';
  if (_showSeatParens) return pname ? `${pname} (${wind} ${zh})` : `${wind} ${zh}`;
  return pname ? pname : `${wind} ${zh}`;
}

function initUI(game) {
  _game = game;

  // Settings toggle
  const settingsBtn = document.getElementById('settings-toggle-btn');
  const appEl = document.getElementById('app');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      appEl.classList.toggle('sidebar-open');
    });
  }

  // Always-hint toggle
  const alwaysHintChk = document.getElementById('always-hint-toggle');
  if (alwaysHintChk) {
    alwaysHintChk.addEventListener('change', () => setAlwaysHint(alwaysHintChk.checked));
  }

  // ---- Auto Mode — 3 large buttons: HUMAN / SLOW / FAST ----
  window.AUTO_MODE = null;
  window.AUTO_USER_LEVEL = 1;
  window.AUTO_FAST_DELAY = 120;
  window._autorunLeft = 0;
  window._autorunTimer = null;

  const autoLevelRow  = document.getElementById('auto-level-row');
  const autoLevelSel  = document.getElementById('auto-user-level');
  const autoStatus    = document.getElementById('auto-status');
  const btnHuman = document.getElementById('auto-btn-human');
  const btnSlow  = document.getElementById('auto-btn-slow');
  const btnFast  = document.getElementById('auto-btn-fast');

  function setAutoMode(mode) {
    const isSprint = mode === 'sprint' || mode === 'sprint_slow';
    window.AUTO_MODE = (mode === 'slow' || mode === 'fast' || isSprint) ? mode : null;
    window.AUTO_USER_LEVEL = parseInt(autoLevelSel?.value, 10) || 1;

    // Update button active states (sprint has no persistent button)
    [btnHuman, btnSlow, btnFast].forEach(b => b?.classList.remove('active-mode'));
    if (!window.AUTO_MODE) btnHuman?.classList.add('active-mode');
    else if (mode === 'slow') btnSlow?.classList.add('active-mode');
    else if (mode === 'fast') btnFast?.classList.add('active-mode');

    const active = !!window.AUTO_MODE;
    if (autoLevelRow) autoLevelRow.style.display = '';
    if (autoStatus) {
      autoStatus.style.display = (active && !isSprint) ? '' : 'none';
      autoStatus.textContent = mode === 'fast'
        ? 'Fast: auto plays — click Pass 通 at hand end.'
        : mode === 'slow' ? 'Slow: step-by-step.' : '';
    }

    // Cancel any autorun when returning to Human (or starting sprint)
    if (!window.AUTO_MODE || isSprint) {
      if (window._autorunTimer) { clearTimeout(window._autorunTimer); window._autorunTimer = null; }
      if (!isSprint) {
        window._autorunLeft = 0;
        delete window._autorunPrevMode;
        const ainp = document.getElementById('autorun-count');
        if (ainp) ainp.value = '0';
        const albl = document.getElementById('autorun-label');
        if (albl) albl.textContent = '';
      }
    }
    // If switching TO manual while game is waiting on human, just let them continue
    if (!window.AUTO_MODE && _game) {
      const msg = document.getElementById('message');
      if (msg && (_game.phase === PHASE.DISCARD && _game.currentSeat === 0)) {
        msg.textContent = 'Your turn — click a tile to discard, or Pass to discard the new tile';
      }
    }
    // If switching TO auto while game is waiting on human, prompt Pass
    if (window.AUTO_MODE && _game) {
      const isHumanTurn = (_game.phase === PHASE.DISCARD && _game.currentSeat === 0)
                       || _game.phase === PHASE.CLAIM;
      if (isHumanTurn) {
        const msg = document.getElementById('message');
        if (msg) msg.innerHTML = `Auto on — click <strong>Pass 通</strong> to hand over.`;
      }
    }
  }

  // Expose for tickAutorun and sprint (which live outside initUI closure)
  window._setAutoMode = setAutoMode;
  window._clearTileCache = () => _tileElCache.clear();

  btnHuman?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Cancelling autorun: clear saved mode so restoration doesn't re-apply fast
    delete window._autorunPrevMode;
    setAutoMode(null);
  });
  btnSlow?.addEventListener('click',  (e) => { e.stopPropagation(); setAutoMode('slow'); });
  btnFast?.addEventListener('click',  (e) => { e.stopPropagation(); setAutoMode('fast'); });
  document.getElementById('autorun-go-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const inp = document.getElementById('autorun-count');
    const n = Math.max(0, parseInt(inp?.value, 10) || 0);

    // Cancel any in-flight timer
    if (window._autorunTimer) { clearTimeout(window._autorunTimer); window._autorunTimer = null; }

    window._autorunLeft = n;

    if (n > 0) {
      // Save mode and force fast — autorun needs all-CPU play
      if (window._autorunPrevMode === undefined) {
        window._autorunPrevMode = window.AUTO_MODE;
      }
      if (!window.AUTO_MODE) setAutoMode('fast');

      // If stalled mid-game on seat 0, kick it now
      if (_game && _game.phase !== PHASE.END) {
        if ((_game.phase === PHASE.DISCARD || _game.phase === PHASE.CLAIM) && _game.currentSeat === 0) {
          _game._scheduleOrStep(() => _game.aiPlay(0));
          renderAll();
        }
      } else if (_game && _game.phase === PHASE.END && !(_game.lastResult?.gameOver)) {
        tickAutorun();
      }
    } else {
      // Count set to 0 — stop and restore
      if (window._autorunPrevMode !== undefined) {
        setAutoMode(window._autorunPrevMode);
        delete window._autorunPrevMode;
      }
    }
  });

  autoLevelSel?.addEventListener('change', (e) => {
    e.stopPropagation();
    window.AUTO_USER_LEVEL = parseInt(e.target.value, 10) || 1;
  });

  function _sprintStart(mode) {
    const n = parseInt(document.getElementById('sprint-count-input')?.value, 10) || 50;
    window._sprintTarget       = Math.max(1, Math.min(5000, n));
    window._sprintDone         = 0;
    window._sprintLog          = [];
    window._sprintBrowseFullLog = [];  // accumulated log across all hands for sprint-slow
    window._sprintStartScores  = _game ? _game.players.map(p => p.score) : null;
    window._sprintDisplayMs    = parseInt(document.getElementById('sprint-display-ms')?.value, 10) || 1500;
    setAutoMode(mode);
    if (_game) {
      _tileElCache.clear();
      _game.nextDeal();   // runs synchronously in sprint — entire first hand completes here
      renderAll();
    }
  }

  document.getElementById('sprint-fast-btn')?.addEventListener('click', (e) => {
    e.stopPropagation(); _sprintStart('sprint');
  });
  document.getElementById('sprint-browse-btn')?.addEventListener('click', (e) => {
    e.stopPropagation(); _sprintStart('sprint_slow');
  });
  // Handle clear broadcast from sprint-log.html popup
  if (!_sprintLogBC) _sprintLogBC = new BroadcastChannel('mahjong-sprint-log');
  _sprintLogBC.onmessage = ev => {
    if (ev.data?.type === 'clear') {
      window._sprintLog        = [];
      window._sprintDone       = 0;
      window._sprintStartScores = null;
      const sl = document.getElementById('sprint-status-label');
      if (sl) sl.textContent = '';
      _broadcastSprintLog();
    }
  };

  document.getElementById('sprint-log-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _broadcastSprintLog();
    if (!_sprintLogWin || _sprintLogWin.closed) {
      const _pl = window.screenLeft + window.outerWidth;
      const _pw = Math.max(300, screen.availWidth - _pl);
      _sprintLogWin = window.open('sprint-log.html', 'mahjong-sprint-log',
        `width=${_pw},height=${screen.availHeight},left=${_pl},top=${screen.availTop||0},resizable=yes,scrollbars=yes`);
    } else {
      _sprintLogWin.focus();
    }
  });

  document.getElementById('new-game-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (window._autorunTimer) { clearTimeout(window._autorunTimer); window._autorunTimer = null; }
    window._autorunLeft = 0;
    const ainp = document.getElementById('autorun-count');
    if (ainp) ainp.value = '0';
    try { sessionStorage.removeItem('mahjongGameState'); } catch(e2) {}
    // Reset any demo-activated toggles
    const ltChk = document.getElementById('last-tile-toggle');
    if (ltChk) { ltChk.checked = false; window.LAST_TILE_WIN = false; }
    _game.reset(); renderAll();
  });

  document.getElementById('new-hand-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window._autorunTimer) { clearTimeout(window._autorunTimer); window._autorunTimer = null; }
    window._autorunLeft = 0;
    const ainp = document.getElementById('autorun-count');
    if (ainp) ainp.value = '0';
    try { sessionStorage.removeItem('mahjongGameState'); } catch(e2) {}
    _tileElCache.clear();
    _game.redeal(); renderAll();
  });

  document.getElementById('tiles-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    populateTileGallery();
    document.getElementById('tiles-modal').classList.remove('hidden');
  });

  document.getElementById('peek-wall-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _broadcastWallState();
    if (!_peekWin || _peekWin.closed) {
      const _pl = window.screenLeft + window.outerWidth;
      const _pw = Math.max(300, screen.availWidth - _pl);
      _peekWin = window.open('peek.html', 'mahjong-peek',
        `width=${_pw},height=${screen.availHeight},left=${_pl},top=${screen.availTop||0},resizable=yes,scrollbars=yes`);
    } else {
      _peekWin.focus();
    }
  });

  document.getElementById('wall-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _broadcastWallState();
    if (!_wallWin || _wallWin.closed) {
      const _pl = window.screenLeft + window.outerWidth;
      const _pw = Math.max(300, screen.availWidth - _pl);
      _wallWin = window.open('wall.html', 'mahjong-wall',
        `width=${_pw},height=${screen.availHeight},left=${_pl},top=${screen.availTop||0},resizable=yes,scrollbars=yes`);
    } else {
      _wallWin.focus();
    }
  });
  document.getElementById('close-peek')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_peekWin && !_peekWin.closed) _peekWin.close();
  });

  // Draggable peek panel
  (function() {
    const content = document.querySelector('#peek-modal .modal-content');
    const handle  = document.querySelector('#peek-modal .peek-drag-handle');
    if (!content || !handle) return;
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('#close-peek')) return;
      dragging = true;
      const r = content.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      content.style.left = (e.clientX - ox) + 'px';
      content.style.top  = (e.clientY - oy) + 'px';
      content.style.bottom = 'auto';
      content.style.right  = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();
  document.getElementById('scenario-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open('scenario.html', 'mahjong-scenario');
  });

  document.getElementById('capture-state-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!_game) { alert('No game in progress.'); return; }

    // Build a scenario snapshot from the live game state
    const now = Date.now();
    const allPlayers = _game.players.map((p, seat) => ({
      seat,
      hand: p.hand.map(t => ({...t})),
      melds: p.melds.map(m => ({...m, tiles: m.tiles.map(t => ({...t}))})),
      bonus: p.bonus.map(t => ({...t})),
      drawnIdx: p.hand.findIndex(t => t._justDrawn),
    }));

    const discard = _game.discard ? {..._game.discard} : null;
    const discardFrom = _game.discardSeat ?? 1;

    const state = {
      ts: now,
      scenario: true,
      _presetName: (() => { const d = new Date(now); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; })(),
      phase: _game.phase === 'discard' ? 'discard' : 'claim',
      dealerSeat: _game.dealerSeat,
      roundWind: _game.roundWind,
      discardFrom,
      discardTile: discard ? {...discard, _discardSeat: discardFrom} : null,
      allPlayers,
      humanHand: allPlayers[0].hand,
      humanMelds: allPlayers[0].melds,
      humanBonus: allPlayers[0].bonus,
      // Default expectations — user adjusts in scenario builder
      _expectedWin: !!(_game.claimOptions?.win),
      _expectedPung: !!(_game.claimOptions?.pung),
      _expectedKong: !!(_game.claimOptions?.kong),
      _expectedChow: !!(_game.claimOptions?.chow),
    };

    // Write to a special key that scenario.html watches on load
    localStorage.setItem('mahjongCapturedState', JSON.stringify(state));

    // Open scenario builder — it will auto-load the captured state
    const w = window.open('scenario.html', 'mahjong-scenario');
    if (w) {
      // If already open, send a message to reload the capture
      setTimeout(() => w.postMessage({type:'loadCapture'}, '*'), 500);
    }

    // Show feedback
    const btn = document.getElementById('capture-state-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Captured!';
    btn.style.background = '#0e4d28';
    setTimeout(() => { btn.textContent = orig; btn.style.background = '#1a4a1a'; }, 2000);
  });
  document.getElementById('close-tiles').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('tiles-modal').classList.add('hidden');
  });
  document.getElementById('rules-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const overlay = document.getElementById('rules-overlay');
    const content = document.getElementById('rules-content');
    if (overlay) {
      if (content && !content.dataset.loaded) {
        fetch('rules.html').then(r => r.text()).then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const body = doc.querySelector('.content') || doc.body;
          content.innerHTML = body.innerHTML;
          content.dataset.loaded = '1';
        });
      }
      overlay.style.display = 'block';
    }
  });
  document.getElementById('close-rules-overlay')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('rules-overlay').style.display = 'none';
  });

  document.getElementById('hint-btn')?.addEventListener('click', () => {
    if (!_game || _game.phase === PHASE.END || _game.currentSeat !== 0) {
      showHint(['Hint is only available during your turn.']);
      return;
    }
    const p = _game.players[0];
    const ctx = _game.makeCtx(0, true);
    const hints = generateHint(p.hand, p.melds, _game.discardPile, ctx);
    showHint(hints);
  });
  document.getElementById('btn-chow').addEventListener('click', () => handleChow());
  document.getElementById('btn-pung').addEventListener('click', () => { _game.humanClaim('pung', null); renderAll(); });
  document.getElementById('btn-kong').addEventListener('click', () => {
    // Self-kong: phase is DISCARD normally, but CLAIM when injected via scenario builder
    if ((_game.phase === PHASE.DISCARD && _game.currentSeat === 0)
        || (_game.phase === PHASE.CLAIM && _game.claimOptions?.kong && !_game.discard)) {
      const kongTiles = _game.findSelfKong(_game.players[0]);
      if (kongTiles) { _game.doSelfKong(0, kongTiles); renderAll(); }
    } else {
      _game.humanClaim('kong', null); renderAll();
    }
  });
  document.getElementById('btn-win').addEventListener('click',  () => { _game.humanClaim('win',  null); renderAll(); });
  document.getElementById('btn-pass').addEventListener('click', () => {
    dismissHint();
    // Slow mode: fire the next queued step
    if (window.AUTO_MODE === 'slow' && _game && _game._pendingAutoStep) {
      _game.stepAuto(); return;
    }
    if (_game.phase === PHASE.END) {
      if (window._autorunTimer) { clearTimeout(window._autorunTimer); window._autorunTimer = null; }
      if (window.AUTO_MODE === 'sprint_slow') {
        if (window._sprintDone >= window._sprintTarget) {
          window._setAutoMode(null);
          const sl = document.getElementById('sprint-status-label');
          if (sl) sl.textContent = `✅ Done — ${window._sprintDone} hands`;
          renderAll(); return;
        }
        _tileElCache.clear(); _game.nextDeal(); renderAll(); return;
      }
      _tileElCache.clear(); _game.nextDeal(); renderAll(); return;
    }
    // Auto mode: hand this turn over to CPU-You
    if (window.AUTO_MODE && _game.currentSeat === 0) {
      if (_game.phase === PHASE.DISCARD) {
        _game._scheduleOrStep(() => _game.aiPlay(0));
      } else if (_game.phase === PHASE.CLAIM) {
        if (_game.claimOptions && _game.claimOptions.robbingKong) {
          if (_game.claimOptions.win) _game.humanClaim('win', null);
          else _game.humanPass();
        } else {
          _game._scheduleOrStep(() => _game.aiPlay(0));
        }
      }
      renderAll(); return;
    }
    // Normal manual play
    if (_game.phase === PHASE.DISCARD && _game.currentSeat === 0) {
      const justDrawn = _game.players[0].hand.find(t => t._justDrawn);
      if (justDrawn) { _game.humanDiscard(justDrawn.id); _selectedTileId = null; renderAll(); }
    } else {
      _game.humanPass(); renderAll();
    }
  });

  document.getElementById('table').addEventListener('click', (e) => {
    if (e.target.closest('#sidebar, #rules-overlay, #tiles-modal')) return;
    const interactive = e.target.closest('button, .tile, #action-bar, #discard-pile, .seat-label, .modal');
    if (interactive) return;
    if (window.AUTO_MODE === 'slow' && _game && _game._pendingAutoStep) {
      _game.stepAuto(); return;
    }
    if (window.AUTO_MODE && _game.currentSeat === 0) {
      if (_game.phase === PHASE.DISCARD || _game.phase === PHASE.CLAIM) {
        _game._scheduleOrStep(() => _game.aiPlay(0)); renderAll();
      }
      return;
    }
    if (_game.phase === PHASE.CLAIM) {
      _game.humanPass(); renderAll();
    } else if (_game.phase === PHASE.DISCARD && _game.currentSeat === 0) {
      const justDrawn = _game.players[0].hand.find(t => t._justDrawn);
      if (justDrawn) { _game.humanDiscard(justDrawn.id); _selectedTileId = null; renderAll(); }
    }
  });

  // Clicking the discard pile/center area during CLAIM counts as Pass,
  // and during DISCARD (human's turn) it discards the just-drawn tile
  document.getElementById('wall-ring-wrap').addEventListener('click', (e) => {
    if (e.target.closest('#sidebar, #rules-overlay, #tiles-modal')) return;
    const onButton = e.target.closest('button, .tile, #action-bar, .seat-label, .modal');
    if (onButton) return;
    if (_game.phase === PHASE.CLAIM) {
      _game.humanPass();
      renderAll();
    } else if (_game.phase === PHASE.DISCARD && _game.currentSeat === 0) {
      const justDrawn = _game.players[0].hand.find(t => t._justDrawn);
      if (justDrawn) {
        _game.humanDiscard(justDrawn.id);
        _selectedTileId = null;
        renderAll();
      }
    }
  });
}

// Hint panel — shows/hides over the discard area
let _hintTimeout = null;
function showHint(lines) {
  let panel = document.getElementById('hint-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'hint-panel';
    panel.style.cssText = `
      position:fixed; bottom:260px; right:320px;
      background:rgba(10,30,10,0.97); border:2px solid #ffd34d;
      border-radius:8px; padding:8px 12px; max-width:210px;
      z-index:200; color:#f5f5f5; font-size:12px; line-height:1.5;
      box-shadow:0 4px 24px rgba(0,0,0,0.7);
    `;
    // Close button
    const close = document.createElement('div');
    close.textContent = '✕';
    close.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;color:#ffd34d;font-size:16px;font-weight:700;';
    close.addEventListener('click', () => panel.remove());
    panel.appendChild(close);
    document.body.appendChild(panel);
  }
  // Title
  const title = document.createElement('div');
  title.style.cssText = 'color:#ffd34d;font-weight:700;font-size:15px;margin-bottom:8px;';
  title.textContent = '💡 Hand Hint';
  // Clear old content (keep close button)
  while (panel.children.length > 1) panel.removeChild(panel.lastChild);
  panel.appendChild(title);
  for (const line of lines) {
    const p = document.createElement('div');
    p.style.marginBottom = '4px';
    p.textContent = line;
    panel.appendChild(p);
  }
  // Hint stays until player discards or passes
  if (_hintTimeout) clearTimeout(_hintTimeout);
  _hintTimeout = null;
}

function tickAutorun() {
  if (!_game || _game.phase !== PHASE.END) return;
  if (_game.lastResult && _game.lastResult.gameOver) {
    // Game over — stop and restore mode
    _autorunFinish();
    return;
  }
  if (!window._autorunLeft || window._autorunLeft <= 0) {
    _autorunFinish();
    return;
  }
  if (window._autorunTimer) return; // already scheduled
  const lbl = document.getElementById('autorun-label');
  if (lbl) lbl.textContent = `${window._autorunLeft} left`;
  window._autorunTimer = setTimeout(() => {
    window._autorunTimer = null;
    window._autorunLeft = Math.max(0, window._autorunLeft - 1);
    const inp = document.getElementById('autorun-count');
    if (inp) inp.value = window._autorunLeft;
    const lbl2 = document.getElementById('autorun-label');
    if (lbl2) lbl2.textContent = window._autorunLeft > 0 ? `${window._autorunLeft} left` : '';
    _tileElCache.clear();
    _game.nextDeal();
    renderAll();
  }, 1500);
}

function _autorunFinish() {
  const lbl = document.getElementById('autorun-label');
  if (lbl) lbl.textContent = '';
  const inp = document.getElementById('autorun-count');
  if (inp) inp.value = '0';
  if (window._autorunPrevMode !== undefined) {
    const prev = window._autorunPrevMode;
    delete window._autorunPrevMode;
    if (window._setAutoMode) window._setAutoMode(prev);
  }
}

function renderAll() {
  if (!_game) return;
  _tileElInUse = new Set();
  if (_game.phase !== PHASE.CLAIM || !_game.claimOptions?.chow) {
    const p = document.getElementById('chow-picker');
    if (p) { p.classList.add('hidden'); p.innerHTML = ''; }
  }
  renderInfoBar();
  renderSeats();
  renderDiscard();
  renderActionBar();
  renderMessage();
  renderSidebar();
  renderWallRing();
  populateWallPeek();
  _broadcastWallState();
  tickAutorun();
}

function renderInfoBar() {
  const ri = document.getElementById('round-info');
  const wi = document.getElementById('wall-info');
  const si = document.getElementById('seat-info');
  if (ri) ri.textContent = `Round: ${_game.roundWind} — Dealer: ${seatName(_game.dealerSeat)}`;
  if (wi) wi.textContent = `Wall: ${_game.wallRemaining()}`;
  if (si) si.textContent = `You: ${seatName(0)}`;
}

function renderSeats() {
  for (let seat = 0; seat < 4; seat++) {
    const p = _game.players[seat];
    const el = document.querySelector(`.seat[data-seat="${seat}"]`);
    if (!el) continue;

    const isDealer = seat === _game.dealerSeat;
    const isWinner = _game.phase === PHASE.END && _game.lastResult && _game.lastResult.winner === seat && _game.lastResult.winner !== -1;
    const isActive = _game.currentSeat === seat
      || (_game.phase === PHASE.CLAIM && seat === 0 && _game.claimOptions && (_game.claimOptions.win || _game.claimOptions.pung || _game.claimOptions.kong || _game.claimOptions.chow))
      || (_game.phase === PHASE.CLAIM && seat === _game.discardSeat);
    if (isWinner) el.classList.add('celebrating'); else el.classList.remove('celebrating');

    el.querySelectorAll('.seat-header, .seat-info-group').forEach(e => e.remove());

    const zhMap = { East:'東', South:'南', West:'西', North:'北' };
    const enMap = { East:'E', South:'S', West:'W', North:'N' };
    const seatWind = _game.getSeatWind(seat);
    const windText = _windIndicatorChinese
      ? (isDealer ? zhMap[_game.roundWind] : zhMap[seatWind])
      : (isDealer ? enMap[_game.roundWind] : enMap[seatWind]);
    const labelText = seatName(seat);
    const activeClass = isActive ? ' active' : '';
    const winnerClass = isWinner ? ' winner' : '';

    function makeDiceEl() {
      if (!isDealer) return null;
      const d = document.createElement('div');
      d.className = 'dice-display';
      d.innerHTML = (_game.dice||[1,1,1]).map(v=>makeDieSVG(v)).join('');
      return d;
    }
    function makeWindEl() {
      const w = document.createElement('div');
      w.className = 'badge-wind' + (isDealer ? ' dealer' : '');
      w.title = isDealer ? `Round Wind: ${_game.roundWind} — click to toggle` : `Seat Wind: ${seatWind} — click to toggle`;
      if (isDealer) {
        // Dealer: gold circle with white inner square showing round wind
        w.innerHTML = `<span class="wind-inner">${windText}</span>`;
      } else {
        // Non-dealer: muted circle showing seat wind
        w.innerHTML = `<span class="wind-char">${windText}</span>`;
      }
      w.addEventListener('click', () => { _windIndicatorChinese = !_windIndicatorChinese; renderAll(); });
      return w;
    }

    if (seat === 1 || seat === 3) {
      // Side players: use the original claim-row (order:3 for left, order:0 for right)
      // This sits in the inner empty space, tiles stay at outer edge
      const claimRow = el.querySelector('.claim-row');
      if (claimRow) {
        // Update label
        const lbl = claimRow.querySelector('.seat-label');
        if (lbl) {
          lbl.className = 'seat-label' + winnerClass;
          lbl.textContent = labelText;
        }
        // Update wind circle (dealer only)
        const windSlot = claimRow.querySelector('.seat-wind-indicator');
        if (windSlot) {
          windSlot.innerHTML = '';
          if (isDealer) windSlot.appendChild(makeWindEl());
        }
        // Update dice (dealer only)
        const diceSlot = claimRow.querySelector('.dice-slot');
        if (diceSlot) {
          diceSlot.innerHTML = '';
          if (isDealer) { const dc = makeDiceEl(); if(dc) diceSlot.appendChild(dc); }
        }
      }
    } else {
      // Top/bottom: indicators are injected as fake tiles in the hand row below
      // (old absolute-positioned badges are suppressed by CSS display:none)
    }

    // Melds
    const meldsEl = el.querySelector('.melds');
    meldsEl.innerHTML = '';
    const isSidePlayer = (seat === 1 || seat === 3);
    // Top player (seat 2) also needs rotation so tiles face toward the player
    const needsRotation = isSidePlayer || seat === 2;

    // Horizontal seats (0, 2): 14-tile melds row keeps both rows at exactly
    // 14 tile-widths at all times (ghost-padded), giving a rigid rectangle.
    // Side CPUs: 12-tile cap; excess spills into the hand row.
    let claimMelds = [], claimBonus = [];
    let overflowMelds = [], overflowBonus = [];
    {
      const meldCap = (seat === 0 || seat === 2) ? 14 : 12;
      let n = 0;
      for (const meld of p.melds) {
        if (n + meld.tiles.length <= meldCap) { claimMelds.push(meld); n += meld.tiles.length; }
        else overflowMelds.push(meld);
      }
      const room = Math.max(0, meldCap - n);
      claimBonus = p.bonus.slice(0, room);
      overflowBonus = p.bonus.slice(room);
    }

    for (const meld of claimMelds) {
      const meldDiv = document.createElement('div');
      meldDiv.className = 'meld';

      // Concealed Kong: render as [back][back][back][face-up]
      if (meld.type === 'kong' && meld.concealed) {
        const opts = needsRotation ? { small: true, seatRotation: seat } : { small: true };
        for (let i = 0; i < 3; i++) {
          const backTile = Object.assign({}, meld.tiles[0], { _forceBack: true });
          const el = makeTileEl(backTile, { ...opts, back: true });
          meldDiv.appendChild(el);
        }
        meldDiv.appendChild(makeTileEl(meld.tiles[0], opts));
        meldsEl.appendChild(meldDiv);
        continue;
      }

      const displayTiles = meld.type === 'chow'
        ? [...meld.tiles].sort((a, b) => a.value - b.value)
        : meld.tiles;
      for (const t of displayTiles) {
        const opts = needsRotation
          ? { small: true, seatRotation: seat }
          : { small: true };
        const tEl = makeTileEl(t, opts);
        if (_game.lastClaimedTile && t.id === _game.lastClaimedTile.id) {
          const inner = tEl.querySelector('.tile') || tEl;
          inner.classList.add('last-discard');
        }
        meldDiv.appendChild(tEl);
      }
      if (_game.robbingKongSeat === seat && _game.robbingKongTile &&
          meld.type === 'pung' && meld.tiles[0] &&
          _game.robbingKongTile.suit === meld.tiles[0].suit &&
          _game.robbingKongTile.value === meld.tiles[0].value) {
        const opts = needsRotation
          ? { small: true, seatRotation: seat }
          : { small: true };
        const pendingEl = makeTileEl(_game.robbingKongTile, opts);
        const innerTile = pendingEl.querySelector('.tile') || pendingEl;
        innerTile.style.outline = '3px solid #ff6600';
        innerTile.style.boxShadow = '0 0 10px 3px rgba(255,102,0,0.8)';
        meldDiv.appendChild(pendingEl);
      }
      meldsEl.appendChild(meldDiv);
    }

    if (claimBonus.length > 0) {
      const bonusDiv = document.createElement('div');
      bonusDiv.className = 'bonus-tiles';
      for (const b of claimBonus) {
        const bOpts = needsRotation ? { small: true, seatRotation: seat } : { small: true };
        bonusDiv.appendChild(makeTileEl(b, bOpts));
      }
      meldsEl.appendChild(bonusDiv);
    }

    // Fill melds row with invisible ghost placeholders to hold fixed height/size.
    // Seats 0 and 2: 14 slots so the melds row is always exactly 1 tile tall.
    // Side CPUs: 12 rotated slots.
    {
      const filled = claimMelds.reduce((s, m) => s + m.tiles.length, 0) + claimBonus.length;
      const ghostCls = isSidePlayer ? 'tile-ghost-rot' : 'tile-ghost';
      const cap = (seat === 0 || seat === 2) ? 14 : 12;
      for (let i = filled; i < cap; i++) {
        const g = document.createElement('div');
        g.className = ghostCls;
        meldsEl.appendChild(g);
      }
    }

    // Hand
    const handEl = el.querySelector('.hand');
    handEl.innerHTML = '';
    const isHuman = seat === 0;

    // Side players: inject label + dealer indicators as first item in hand column
    if (seat === 1 || seat === 3) {
      const wrap = document.createElement('div');
      const sideDir = el.classList.contains('seat-left') ? ' left' : ' right';
      wrap.className = 'side-hand-label' + sideDir + winnerClass;

      const lbl = document.createElement('div');
      lbl.className = 'side-hand-label-text';
      // Use plain player name only — no wind/direction suffix
      lbl.textContent = p.name;
      wrap.appendChild(lbl);

      // Name label — always first
      handEl.prepend(wrap);

      if (isDealer) {
        // Wind block — in flow, after name label
        const windBlock = document.createElement('div');
        windBlock.className = 'side-hand-fake-tile';
        windBlock.appendChild(makeWindEl());
        handEl.insertBefore(windBlock, handEl.children[1] || null);

        // Dice: 2 fake tiles for larger display
        const dice = _game.dice || [1, 1, 1];
        const diceBlock1 = document.createElement('div');
        diceBlock1.className = 'side-hand-fake-tile';
        const dc1 = document.createElement('div');
        dc1.className = 'dice-display';
        dc1.innerHTML = makeDieSVG(dice[0]) + makeDieSVG(dice[1]);
        diceBlock1.appendChild(dc1);
        handEl.insertBefore(diceBlock1, handEl.children[2] || null);
        const diceBlock2 = document.createElement('div');
        diceBlock2.className = 'side-hand-fake-tile';
        const dc2 = document.createElement('div');
        dc2.className = 'dice-display';
        dc2.innerHTML = makeDieSVG(dice[2]);
        diceBlock2.appendChild(dc2);
        handEl.insertBefore(diceBlock2, handEl.children[3] || null);
        handEl.style.marginTop = '-138px';
      } else {
        handEl.style.marginTop = '';
      }
    }
    // Top/bottom: prepend label + dealer indicators as first tiles in the hand row
    if (seat === 0 || seat === 2) {
      // Label fake tile
      const lblTile = document.createElement('div');
      lblTile.className = 'h-hand-fake-tile h-label-tile' + winnerClass;
      lblTile.textContent = p.name;
      handEl.prepend(lblTile);

      if (isDealer) {
        // Wind fake tile
        const windTile = document.createElement('div');
        windTile.className = 'h-hand-fake-tile';
        windTile.appendChild(makeWindEl());
        handEl.insertBefore(windTile, handEl.children[1] || null);

        // Dice: 2 fake tiles (dice[0]+dice[1] / dice[2])
        const dice = _game.dice || [1, 1, 1];
        const diceTile1 = document.createElement('div');
        diceTile1.className = 'h-hand-fake-tile';
        const dc1 = document.createElement('div');
        dc1.className = 'dice-display';
        dc1.innerHTML = makeDieSVG(dice[0]) + makeDieSVG(dice[1]);
        diceTile1.appendChild(dc1);
        handEl.insertBefore(diceTile1, handEl.children[2] || null);

        const diceTile2 = document.createElement('div');
        diceTile2.className = 'h-hand-fake-tile';
        const dc2 = document.createElement('div');
        dc2.className = 'dice-display';
        dc2.innerHTML = makeDieSVG(dice[2]);
        diceTile2.appendChild(dc2);
        handEl.insertBefore(diceTile2, handEl.children[3] || null);
      }
    }

    // For human: keep a stable 14-slot hand row.
    // When the hand was not just drawn (for example, a claim win), render all tiles
    // normally and only use the draw slot when a `_justDrawn` tile is present.
    // NOTE: this path intentionally bypasses the shared tile cache because cached
    // nodes can be reused incorrectly after a claim win or other non-draw render,
    // which causes the bottom hand to lose or misplace tiles.
    if (isHuman) {
      const overflowCount = overflowMelds.reduce((s, m) => s + m.tiles.length, 0) + overflowBonus.length;
      const justDrawnTile = p.hand.find(t => t._justDrawn);
      const displayTiles = justDrawnTile
        ? [...sortHand(p.hand.filter(t => !t._justDrawn)), justDrawnTile]
        : sortHand(p.hand);

      // Leave exactly overflowCount slots at the right end for overflow melds
      const slotCount = Math.max(displayTiles.length, 14 - overflowCount);
      for (let i = 0; i < slotCount; i++) {
        const t = displayTiles[i];
        if (t) {
          const opts = {
            clickable: _game.phase === PHASE.DISCARD && _game.currentSeat === 0,
            winTile: isWinner && t.id === _game.lastResult?.winTileId,
            justDrawn: !!justDrawnTile && t.id === justDrawnTile.id,
            selected: t.id === _selectedTileId,
            seatRotation: 0,
            skipCache: true,
          };
          const el2 = makeTileEl(t, opts);
          el2.onclick = (opts.clickable || _game.phase === PHASE.CLAIM) ? () => {
            if (_game.phase === PHASE.DISCARD) {
              dismissHint(); _game.humanDiscard(t.id); _selectedTileId = null; renderAll();
            } else if (_game.phase === PHASE.CLAIM) {
              if (_game.claimOptions && _game.claimOptions.chow) { toggleChowTile(t.id); }
              else { _game.humanPass(); }
              renderAll();
            }
          } : null;
          handEl.appendChild(el2);
        } else {
          const ghost = document.createElement('div');
          ghost.className = justDrawnTile || i !== slotCount - 1 ? 'tile-ghost' : 'tile-ghost draw-slot';
          handEl.appendChild(ghost);
        }
      }
      // Overflow melds spill into hand row at the free (right) end
      if (overflowMelds.length > 0 || overflowBonus.length > 0) {
        for (const meld of overflowMelds) {
          const meldDiv = document.createElement('div');
          meldDiv.className = 'meld';
          if (meld.type === 'kong' && meld.concealed) {
            for (let i = 0; i < 3; i++) {
              const bt = Object.assign({}, meld.tiles[0], { _forceBack: true });
              meldDiv.appendChild(makeTileEl(bt, { small: true, back: true, seatRotation: 0 }));
            }
            meldDiv.appendChild(makeTileEl(meld.tiles[0], { small: true, seatRotation: 0 }));
          } else {
            const dTiles = meld.type === 'chow'
              ? [...meld.tiles].sort((a, b) => a.value - b.value)
              : meld.tiles;
            for (const t of dTiles) {
              meldDiv.appendChild(makeTileEl(t, { small: true, seatRotation: 0 }));
            }
          }
          handEl.appendChild(meldDiv);
        }
        if (overflowBonus.length > 0) {
          const bonusDiv = document.createElement('div');
          bonusDiv.className = 'bonus-tiles';
          for (const b of overflowBonus) {
            bonusDiv.appendChild(makeTileEl(b, { small: true, seatRotation: 0 }));
          }
          handEl.appendChild(bonusDiv);
        }
      }
    } else {
      // CPU players: render tiles face-down normally, or face-up if Open Hands enabled

      // Side + top players: render overflow melds/bonus (beyond claim-row cap) into hand row
      if ((isSidePlayer || seat === 2) && (overflowMelds.length > 0 || overflowBonus.length > 0)) {
        for (const meld of overflowMelds) {
          const meldDiv = document.createElement('div');
          meldDiv.className = 'meld';
          if (meld.type === 'kong' && meld.concealed) {
            for (let i = 0; i < 3; i++) {
              const bt = Object.assign({}, meld.tiles[0], { _forceBack: true });
              meldDiv.appendChild(makeTileEl(bt, { small: true, back: true, seatRotation: seat }));
            }
            meldDiv.appendChild(makeTileEl(meld.tiles[0], { small: true, seatRotation: seat }));
          } else {
            const dTiles = meld.type === 'chow'
              ? [...meld.tiles].sort((a, b) => a.value - b.value)
              : meld.tiles;
            for (const t of dTiles) {
              meldDiv.appendChild(makeTileEl(t, { small: true, seatRotation: seat }));
            }
          }
          handEl.appendChild(meldDiv);
        }
        if (overflowBonus.length > 0) {
          const bonusDiv = document.createElement('div');
          bonusDiv.className = 'bonus-tiles';
          for (const b of overflowBonus) {
            bonusDiv.appendChild(makeTileEl(b, { small: true, seatRotation: seat }));
          }
          handEl.appendChild(bonusDiv);
        }
      }

      const openHands = !!window.OPEN_HANDS;
      const cpuTiles = sortHand(p.hand);

      // If open hands + Level 4, compute AI groupings for color hints
      let groupings = null;
      if (openHands && getLevel(seat) >= 3) {
        groupings = getHandGroupings(p.hand, p.melds);
      }

      for (const t of cpuTiles) {
        const showFace = openHands && !isWinner;
        const opts = {
          small: true,
          back: !showFace && !isWinner,
          winTile: isWinner && t.id === _game.lastResult?.winTileId,
          seatRotation: seat,
          openHand: showFace,
        };
        const tileEl = makeTileEl(t, opts);

        // Color-code groupings in open hands mode
        if (showFace && groupings) {
          const key = `${t.suit}|${t.value}`;
          const group = groupings[t.id];
          if (group === 'complete')  tileEl.style.outline = '2px solid #5dde7a';  // green = complete set
          else if (group === 'pair') tileEl.style.outline = '2px solid #ffd34d';  // gold = pair
          else if (group === 'partial') tileEl.style.outline = '2px solid #8ad4ff'; // blue = partial seq
          else tileEl.style.opacity = '0.7'; // dim = isolated
        }
        // Highlight newly drawn tile (regular draw or bonus replacement)
        if (showFace && t._justDrawn) {
          tileEl.style.outline = '3px solid #00e5ff';
          tileEl.style.boxShadow = '0 0 8px 2px rgba(0,229,255,0.5)';
        }
        handEl.appendChild(tileEl);
      }
      // Pad all CPU hand columns to 14 real tile slots with invisible ghost tiles
      // so the column is always full and the board never shifts.
      const overflowTileCount = (isSidePlayer || seat === 2)
        ? overflowMelds.reduce((s, m) => s + m.tiles.length, 0) + overflowBonus.length
        : 0;
      const handGhostCls = isSidePlayer ? 'tile-ghost-rot' : 'tile-ghost';
      for (let i = cpuTiles.length + overflowTileCount; i < 14; i++) {
        const ghost = document.createElement('div');
        ghost.className = handGhostCls;
        handEl.appendChild(ghost);
      }
    }
  }
}

function renderDiscard() {
  const el = document.getElementById('discard-pile');
  el.innerHTML = '';

  // Discard area dimensions (must match CSS #discard-pile)
  // Discard area dimensions — inset from wall (matches CSS top:26 left:26 width:668 height:488)
  const W = 668, H = 556;
  const TW = 46, TH = 66;
  const GAP = 3;            // gap between tiles

  // Each seat gets a triangular zone. Tiles are placed in rows/columns
  // starting near the player's edge and working inward.
  // The layout never reflows — position is calculated from the tile index.

  for (const t of _game.discardPile) {
    const seat = t._discardSeat ?? 0;
    // Use stable index stamped at discard time — never shifts when tiles are claimed/spliced out
    const idx = t._discardIdxBySeat ?? 0;

    let x, y;

    if (seat === 0) {
      // Bottom: 4 rows x 7 cols, stacking upward from bottom edge
      const cols = 7;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const totalRowW = cols * TW + (cols - 1) * GAP;
      const startX = (W - totalRowW) / 2;
      const startY = H - TH - 4;
      x = startX + col * (TW + GAP);
      y = startY - row * (TH + GAP);

    } else if (seat === 2) {
      // Top: 4 rows x 7 cols, stacking downward from top edge
      const cols = 7;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const totalRowW = cols * TW + (cols - 1) * GAP;
      const startX = (W - totalRowW) / 2;
      const startY = 4;
      x = startX + col * (TW + GAP);
      y = startY + row * (TH + GAP);

    } else if (seat === 3) {
      // Left: 8 rows x 3 cols — innermost col's right edge aligns with center startX
      const rows = 8;
      const row = idx % rows;
      const col = Math.floor(idx / rows);
      const totalColH = rows * TH + (rows - 1) * GAP;
      const startY = (H - totalColH) / 2;
      const startX = 20;
      x = startX + col * (TW + GAP);
      y = startY + row * (TH + GAP);

    } else {
      // Right (seat 1): 8 rows x 3 cols — innermost col's left edge aligns with center end
      const rows = 8;
      const row = idx % rows;
      const col = Math.floor(idx / rows);
      const totalColH = rows * TH + (rows - 1) * GAP;
      const startY = (H - totalColH) / 2;
      const startX = W - TW - 20;
      x = startX - col * (TW + GAP);
      y = startY + row * (TH + GAP);
    }


    const te = makeTileEl(t, { small: true });
    te.style.left = x + 'px';
    te.style.top  = y + 'px';
    if (_game.discard && t.id === _game.discard.id) te.classList.add('last-discard');
    el.appendChild(te);
  }
}

function renderActionBar() {
  const opts = _game.claimOptions;
  const isDiscard = _game.phase === PHASE.DISCARD && _game.currentSeat === 0;
  const isClaim = _game.phase === PHASE.CLAIM;

  const btnChow = document.getElementById('btn-chow');
  const btnPung = document.getElementById('btn-pung');
  const btnKong = document.getElementById('btn-kong');
  const btnWin  = document.getElementById('btn-win');
  const btnPass = document.getElementById('btn-pass');
  const isHijacked = isClaim && opts && opts._hijackedBy !== undefined;
  btnChow.disabled = !(isClaim && opts && opts.chow) || isHijacked;
  btnPung.disabled = !(isClaim && opts && opts.pung) || isHijacked;
  const hasSelfKong = isDiscard && !!_game.findSelfKong(_game.players[0]);
  btnKong.disabled = (!(isClaim && opts && opts.kong) && !hasSelfKong) || isHijacked;
  btnWin.disabled  = !(isClaim && opts && opts.win);
  btnPass.disabled = !isClaim && !isDiscard && _game.phase !== PHASE.END &&
                     !(window.AUTO_MODE === 'slow' && _game._pendingAutoStep);


  if (_game.phase === PHASE.END) {
    const isGameOver = _game.lastResult && _game.lastResult.gameOver;
    if (isGameOver) {
      btnPass.textContent = 'Game Over';
      btnPass.disabled = true;
      btnPass.style.background = '#555';
      btnPass.style.color = '#ccc';
    } else {
      btnPass.textContent = 'Next Hand ▶';
      btnPass.disabled = false;
      btnPass.style.background = '#ffd34d';
      btnPass.style.color = '#07301a';
    }
  } else if (window.AUTO_MODE === 'slow' && _game._pendingAutoStep) {
    // Slow mode: Pass = advance to next action
    btnPass.textContent = 'Pass 通 ▶';
    btnPass.disabled = false;
    btnPass.style.background = '#ffd34d';
    btnPass.style.color = '#07301a';
  } else {
    btnPass.textContent = 'Pass 通';
    btnPass.style.background = '';
    btnPass.style.color = '';
  }
}

function renderMessage() {
  const el = document.getElementById('message');
  if (!el) return;

  if (_game.phase === PHASE.END) {
    if (_game.lastResult) {
      const { winner, faan, label, gameOver } = _game.lastResult;
      if (winner === -1) {
        el.textContent = 'Exhausted draw 黃牌';
      } else {
        const total = typeof faan === 'number' ? faan : 0;
        const winVerb = (winner === 0 && _game.players[0]?.isHuman) ? 'win' : 'wins';
        el.innerHTML = `<strong>${seatName(winner)} ${winVerb}! ${total} faan</strong><br><span style="font-size:12px;opacity:0.85">${label || ''}</span>`;
      }
      if (gameOver) {
        const busted = _game.players.find(pl => pl.score < 0);
        el.innerHTML += `<br><span style="color:#ff6666;font-weight:700">GAME OVER — ${busted ? busted.name : 'A player'} went below 0! Start a New Game.</span>`;
      }
    } else {
      el.textContent = 'Wall exhausted — draw!';
    }
    return;
  }
  if (_game.phase === PHASE.DISCARD && _game.currentSeat === 0) {
    if (_alwaysHint) {
      const hp = _game.players[0];
      const hctx = _game.makeCtx(0, true);
      showHint(generateHint(hp.hand, hp.melds, _game.discardPile, hctx));
    }
    el.textContent = '';
    return;
  }
  el.textContent = '';
}

function renderSidebar() {
  // Inline player scores in PLAYERS section
  for (const p of _game.players) {
    const id = p.isHuman ? 'you-score' : `cpu${p.name.replace('CPU', '')}-score`;
    const el = document.getElementById(id);
    if (el) el.textContent = p.score;
  }
  // Scoreboard (optional — only present if sidebar has score section)
  const tbody = document.querySelector('#scoreboard tbody');
  if (tbody) {
    tbody.innerHTML = '';
    for (const p of _game.players) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${seatName(p.seat)}</td><td>${p.name}</td><td>${p.score}</td>`;
      tbody.appendChild(tr);
    }
  }
  const dealerEl = document.getElementById('game-dealer-seat');
  if (dealerEl) dealerEl.value = _game.dealerSeat;
  const windEl = document.getElementById('game-round-wind');
  if (windEl) windEl.value = _game.roundWind;
  const lh = document.getElementById('last-hand');
  if (lh) {
    if (_game.lastResult && _game.lastResult.faan > 0) {
      lh.textContent = `${seatName(_game.lastResult.winner)} — ${_game.lastResult.faan} faan. ${_game.lastResult.label}`;
    } else {
      lh.textContent = '—';
    }
  }
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.innerHTML = _game.log.slice(0, 30).map(e => `<div class="entry">${e}</div>`).join('');
  }
  renderSprintLog();
}

function renderSprintLog() {
  _broadcastSprintLog();
}

const SPRINT_COLORS = ['#ffd34d', '#7dffff', '#aaffaa', '#ffaaff'];

// ---- Graphical tile face renderers (Bamboo & Circle) --------

function bambooStalkLayout(n) {
  if (n <= 4) {
    return Array.from({ length: n }, (_, i) => ({ cx: (i + 0.5) / n * 100, top: 8, bottom: 92 }));
  }
  if (n <= 6) {
    const r1 = Math.ceil(n / 2), r2 = n - r1;
    return [
      ...Array.from({ length: r1 }, (_, i) => ({ cx: (i + 0.5) / r1 * 100, top: 5,  bottom: 48 })),
      ...Array.from({ length: r2 }, (_, i) => ({ cx: (i + 0.5) / r2 * 100, top: 52, bottom: 95 })),
    ];
  }
  const r1 = Math.ceil(n / 3), r3 = Math.floor(n / 3), r2 = n - r1 - r3;
  return [
    ...Array.from({ length: r1 }, (_, i) => ({ cx: (i + 0.5) / r1 * 100, top: 4,  bottom: 34 })),
    ...Array.from({ length: r2 }, (_, i) => ({ cx: (i + 0.5) / r2 * 100, top: 37, bottom: 63 })),
    ...Array.from({ length: r3 }, (_, i) => ({ cx: (i + 0.5) / r3 * 100, top: 66, bottom: 96 })),
  ];
}

function buildBambooSVG(n) {
  const stalks = bambooStalkLayout(n);
  const maxInRow = n <= 4 ? n : n <= 6 ? Math.ceil(n / 2) : Math.ceil(n / 3);
  const sw = Math.max(7, Math.min(24, 84 / maxInRow - 2));
  const hw = sw * 0.5;
  let s = '';
  for (const { cx, top, bottom } of stalks) {
    const x  = cx - sw / 2;
    const h  = bottom - top;
    const n1 = top + h / 3;
    const n2 = top + 2 * h / 3;
    s += `<rect x="${(x+1).toFixed(1)}" y="${(top+1).toFixed(1)}" width="${sw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="rgba(0,0,0,0.22)"/>`;
    s += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${sw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#1f7a1f" stroke="#0d4d0d" stroke-width="0.7"/>`;
    s += `<rect x="${(cx - hw/2).toFixed(1)}" y="${top.toFixed(1)}" width="${hw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#3daa3d" opacity="0.75"/>`;
    for (const ny of [n1, n2]) {
      s += `<rect x="${x.toFixed(1)}" y="${(ny-1).toFixed(1)}" width="${sw.toFixed(1)}" height="2.5" rx="0.8" fill="#0d4d0d"/>`;
      s += `<rect x="${(x+1).toFixed(1)}" y="${ny.toFixed(1)}" width="${(sw-2).toFixed(1)}" height="0.8" rx="0.4" fill="#5ac45a"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width:100%;height:100%;display:block">${s}</svg>`;
}

const CIRCLE_POS = [
  null,
  [[50,50]],
  [[50,28],[50,72]],
  [[50,20],[50,50],[50,80]],
  [[28,28],[72,28],[28,72],[72,72]],
  [[28,20],[72,20],[50,50],[28,80],[72,80]],
  [[28,18],[72,18],[28,50],[72,50],[28,82],[72,82]],
  [[28,14],[72,14],[28,43],[72,43],[50,71],[28,86],[72,86]],
  [[25,14],[50,14],[75,14],[25,50],[75,50],[25,86],[50,86],[75,86]],
  [[25,15],[50,15],[75,15],[25,50],[50,50],[75,50],[25,85],[50,85],[75,85]],
];

function buildCircleSVG(n) {
  const positions = CIRCLE_POS[n];
  const r = n === 1 ? 28 : n <= 4 ? 20 : n <= 6 ? 17 : 14;
  let s = '';
  for (const [cx, cy] of positions) {
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#c81a1a" stroke="#7a0000" stroke-width="1.5"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${(r*0.62).toFixed(1)}" fill="none" stroke="#ff6060" stroke-width="${(r*0.16).toFixed(1)}" opacity="0.55"/>`;
    s += `<circle cx="${(cx - r*0.28).toFixed(1)}" cy="${(cy - r*0.28).toFixed(1)}" r="${(r*0.22).toFixed(1)}" fill="rgba(255,215,215,0.55)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width:100%;height:100%;display:block">${s}</svg>`;
}

// ---- Image support -----------------------------------------
function tileImagePath(t) {
  return `img/tiles/${t.suit}_${t.value}.png`;
}

const _imgCache = window._imgCache || (window._imgCache = {});

// Tile element cache — keeps <img> elements alive between renders so the browser
// never has to re-decode a PNG that was already on screen.  Keyed by `${tileId}:${rot}`.
// Back tiles (concealed kongs) are excluded because 3 backs share one tile ID.
const _tileElCache = new Map();

// Per-render-cycle in-use tracking: prevents two appendChild calls stealing the same
// cached element (which would move it out of its first position, leaving a hole).
// Set to a new Set() at the start of renderAll(); null between render cycles.
let _tileElInUse = null;

function _resetTileEl(el, opts = {}) {
  // el is the value stored in _tileElCache: wrapper div (rotated) or tile div (non-rotated)
  const inner = el.classList.contains('tile') ? el : (el.querySelector('.tile') || el);
  inner.classList.remove('selected', 'clickable', 'win-tile', 'just-drawn', 'last-discard', 'small');
  if (opts.small) inner.classList.add('small');
  // Clear inline styles from discard-pile positioning (left/top) and robbing-kong scale
  // (.tile has position:relative, so leftover style.top causes tiles to shift downward)
  el.style.left = '';
  el.style.top = '';
  el.style.transform = '';
  el.style.zIndex = '';
  // Clear size overrides injected by wall-peek mini rendering (width:30px!important etc.)
  inner.style.removeProperty('width');
  inner.style.removeProperty('height');
  inner.style.removeProperty('font-size');
  inner.style.removeProperty('cursor');
  // Clear any inline styles set by Open Hands colour hints or robbing-kong highlight
  inner.style.outline = '';
  inner.style.opacity = '';
  inner.style.boxShadow = '';
  el.style.outline = '';
  el.style.opacity = '';
  el.style.boxShadow = '';
  el.onclick = null;
}

function renderTileFace(t, div) {
  const path = tileImagePath(t);
  // If we already confirmed this PNG is missing, use SVG fallback immediately
  if (_imgCache[path] === false) { _applyFallback(t, div); return; }
  // Otherwise render the <img> directly — no SVG-first, no DOM swap, no white flash.
  // The browser shares the in-flight preload request so the image fills in without
  // replacing any existing content.
  div.classList.add('tile-img');
  div.classList.remove('graphical');
  const img = document.createElement('img');
  img.src = path;
  img.alt = tileEnglish(t);
  img.draggable = false;
  img.onload  = () => { _imgCache[path] = true; };
  img.onerror = () => {
    _imgCache[path] = false;
    div.classList.remove('tile-img');
    div.innerHTML = '';
    _applyFallback(t, div);
  };
  div.appendChild(img);
  const en = document.createElement('span');
  en.className = 'tile-en';
  en.textContent = tileEnglish(t);
  div.appendChild(en);
}


function _applyFallback(t, div) {
  const isGraphical = t.suit === SUIT.BAMBOO || t.suit === SUIT.CIRCLE;
  if (isGraphical) {
    div.classList.add('graphical');
    const graphic = document.createElement('div');
    graphic.className = 'tile-graphic';
    graphic.innerHTML = t.suit === SUIT.BAMBOO ? buildBambooSVG(t.value) : buildCircleSVG(t.value);
    div.appendChild(graphic);
  } else {
    const main = document.createElement('span');
    main.className = 'tile-main';
    main.textContent = tileMain(t);
    div.appendChild(main);
    const num = document.createElement('span');
    num.className = 'tile-num';
    num.textContent = tileNum(t);
    div.appendChild(num);
  }
  const en = document.createElement('span');
  en.className = 'tile-en';
  en.textContent = tileEnglish(t);
  div.appendChild(en);
}


// SVG dice — crisp rendered pips on a clean face
function makeDieSVG(n) {
  const isRed = n >= 4;
  const bg = '#f5f0e8';
  const pipColor = isRed ? '#cc2222' : '#1a1a1a';
  const border = '#8a7560';
  // Pip positions [cx,cy] for each face value (in a 24x24 viewBox)
  const pips = {
    1: [[12,12]],
    2: [[7,7],[17,17]],
    3: [[7,7],[12,12],[17,17]],
    4: [[7,7],[17,7],[7,17],[17,17]],
    5: [[7,7],[17,7],[12,12],[7,17],[17,17]],
    6: [[7,6],[17,6],[7,12],[17,12],[7,18],[17,18]],
  };
  const dots = (pips[n]||[]).map(([cx,cy]) =>
    `<circle cx="${cx}" cy="${cy}" r="2.2" fill="${pipColor}"/>`
  ).join('');
  return `<svg class="die-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="4" fill="${bg}" stroke="${border}" stroke-width="1.2"/>
    <rect x="1.5" y="1.5" width="10" height="6" rx="2" fill="rgba(255,255,255,0.5)"/>
    ${dots}
  </svg>`;
}

// ---- Tile element factory ----------------------------------
function makeTileEl(t, opts = {}) {
  const rot = opts.seatRotation || 0;

  // Return a cached element when possible so the <img> inside is never destroyed
  // between renders — the browser keeps its decoded pixel data alive.
  // Back tiles are excluded: a concealed kong has three backs sharing one tile ID.
  // In-use guard: if the same key was already placed this render cycle, skip the
  // cache and build a fresh element — prevents DOM theft (holes / split melds).
  // The human hand uses `skipCache` when it is rendered in a special layout path
  // (for example, claim wins with no `_justDrawn` tile); cached nodes must not be
  // reused there because they can leave stale tiles attached to the old row.
  const canUseCache = !opts.back && !opts.skipCache;
  if (canUseCache) {
    const key = `${t.id}:${rot}`;
    if (_tileElCache.has(key) && (!_tileElInUse || !_tileElInUse.has(key))) {
      const cached = _tileElCache.get(key);
      _resetTileEl(cached, opts);
      if (_tileElInUse) _tileElInUse.add(key);
      const inner = rot ? cached.querySelector('.tile') : cached;
      if (opts.clickable)  inner.classList.add('clickable');
      if (opts.justDrawn)  inner.classList.add('just-drawn');
      if (opts.selected)   inner.classList.add('selected');
      if (opts.winTile)    inner.classList.add('win-tile');
      return cached;
    }
  }

  const div = document.createElement('div');
  const classes = ['tile'];
  if (opts.small)     classes.push('small');
  if (opts.back)      classes.push('back');
  if (opts.clickable) classes.push('clickable');
  if (opts.justDrawn) classes.push('just-drawn');
  if (opts.selected)  classes.push('selected');
  if (opts.winTile)   classes.push('win-tile');
  if (t.suit === SUIT.BAMBOO) classes.push('suit-bamboo');
  if (t.suit === SUIT.CIRCLE) classes.push('suit-circle');
  if (t.suit === SUIT.CHAR)   classes.push('suit-char');
  if (t.suit === SUIT.WIND)   classes.push('suit-wind');
  if (t.suit === SUIT.DRAGON) { classes.push('suit-dragon'); classes.push('dragon-' + t.value); }
  if (t.suit === SUIT.FLOWER) classes.push('flower');
  if (t.suit === SUIT.SEASON) classes.push('season');
  div.className = classes.join(' ');
  div.dataset.id = t.id;
  if (!opts.back) renderTileFace(t, div);

  // Rotate tiles for side players — applies to both hidden hand tiles AND face-up meld tiles
  if (rot) {
    const TW = 46, TH = 66;
    const wrapper = document.createElement('div');
    wrapper.className = 'tile-rot-wrap';
    wrapper.style.flexShrink = '0';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    if (rot === 1) {
      wrapper.style.width  = TH + 'px';
      wrapper.style.height = TW + 'px';
      div.style.transform = 'rotate(-90deg)';
      div.style.flexShrink = '0';
    } else if (rot === 2) {
      wrapper.style.width  = TW + 'px';
      wrapper.style.height = TH + 'px';
      div.style.transform = 'rotate(180deg)';
    } else if (rot === 3) {
      wrapper.style.width  = TH + 'px';
      wrapper.style.height = TW + 'px';
      div.style.transform = 'rotate(90deg)';
      div.style.flexShrink = '0';
    }
    wrapper.appendChild(div);
    if (!opts.back && !opts.skipCache) {
      const k = `${t.id}:${rot}`;
      if (!_tileElCache.has(k)) _tileElCache.set(k, wrapper);
      if (_tileElInUse) _tileElInUse.add(k);
    }
    return wrapper;
  }

  if (!opts.back && !opts.skipCache) {
    const k = `${t.id}:0`;
    if (!_tileElCache.has(k)) _tileElCache.set(k, div);
    if (_tileElInUse) _tileElInUse.add(k);
  }
  return div;
}

// Chow selection
function toggleChowTile(id) {
  const idx = _chowChoices.indexOf(id);
  if (idx === -1) { if (_chowChoices.length < 2) _chowChoices.push(id); }
  else { _chowChoices.splice(idx, 1); }
  if (_chowChoices.length === 2) {
    const p = _game.players[0];
    const selected = _chowChoices.map(id => p.hand.find(t => t.id === id)).filter(Boolean);
    selected.push(_game.discard);
    _chowChoices = [];
    _game.humanClaim('chow', selected);
    renderAll();
  }
}

function handleChow() {
  const opts = _game.claimOptions;
  if (!opts || !opts.chow) return;
  const p = _game.players[0];
  const allChows = findAllChowsWith(p.hand, _game.discard);
  if (allChows.length === 0) return;
  if (allChows.length === 1) {
    _game.humanClaim('chow', allChows[0]);
    renderAll();
  } else {
    renderChowPicker(allChows);
  }
}

function renderChowPicker(chowOptions) {
  const picker = document.getElementById('chow-picker');
  picker.innerHTML = '';
  picker.classList.remove('hidden');
  const lbl = document.createElement('div');
  lbl.className = 'chow-label';
  lbl.textContent = '🀄 Choose Chow 上:';
  picker.appendChild(lbl);
  for (const combo of chowOptions) {
    const opt = document.createElement('div');
    opt.className = 'chow-option';
    const claimTile = _game.discard;
    const sorted = [...combo].sort((a, b) => a.value - b.value);
    for (const t of sorted) {
      const tEl = makeTileEl(t, { small: true });
      if (claimTile && t.id === claimTile.id) {
        tEl.style.outline = '2px solid #ff9800';
        tEl.style.boxShadow = '0 0 5px 2px rgba(255,152,0,0.5)';
      }
      opt.appendChild(tEl);
    }
    opt.addEventListener('click', () => {
      picker.classList.add('hidden');
      picker.innerHTML = '';
      _game.humanClaim('chow', combo);
      renderAll();
    });
    picker.appendChild(opt);
  }
}

// ---- Tile Gallery ------------------------------------------
function populateWallPeek() {
  const el = document.getElementById('peek-content');
  if (!el || !_game) return;
  el.innerHTML = '';

  const wall      = _game.wall;
  const wallIdx   = _game.wallIdx   ?? 0;
  const tailCol   = _game.tailCol   ?? 71;
  const tailPhase = _game.tailPhase ?? 0;
  const remain    = Math.max(0, 2 * (tailCol + 1) - wallIdx - tailPhase);
  const tailUsed  = (71 - tailCol) * 2 + tailPhase;
  const exhausted = remain === 0;

  if (!wall || wall.length === 0) {
    el.innerHTML = '<p style="color:#aaa;padding:10px;">No game in progress.</p>'; return;
  }

  // Match drawFromWall skip: if head is at top of tailCol but tail already took it, advance by 1
  const headSkips = wallIdx % 2 === 0 && Math.floor(wallIdx / 2) === tailCol && tailPhase === 1;
  const effectiveHeadIdx = wallIdx + (headSkips ? 1 : 0);
  // Match drawFromTail skip: if head took the top of tailCol, tail uses bottom instead
  const effTailPhase = (tailPhase === 0 && tailCol * 2 < wallIdx) ? 1 : tailPhase;
  const effectiveTailIdx = tailCol * 2 + effTailPhase;
  // Last-tile case: head and tail converge on same index
  const lastTile = !exhausted && effectiveHeadIdx === effectiveTailIdx;

  // ── Stats bar ────────────────────────────────────────────────
  const stats = document.createElement('div');
  stats.style.cssText = 'display:flex;gap:16px;padding:6px 10px;background:rgba(0,0,0,.3);border-radius:6px;margin-bottom:8px;font-size:11px;flex-wrap:wrap;';
  if (exhausted) {
    stats.innerHTML = `
      <span style="color:#ff4444;font-weight:700;font-size:12px;">🏁 WALL EXHAUSTED — 0 tiles left</span>
      <span style="color:#aaa">${wallIdx} drawn · ${tailUsed} replaced</span>
    `;
  } else if (lastTile) {
    stats.innerHTML = `
      <span style="color:#ff4444;font-weight:700">▼▲ LAST TILE — head &amp; tail meet</span>
      <span style="color:#7dffff">1 live</span>
      <span style="color:#aaa">${wallIdx} drawn · ${tailUsed} replaced</span>
      <span style="color:#555">dim = used</span>
    `;
  } else {
    stats.innerHTML = `
      <span style="color:#7dffff">${remain} live</span>
      <span style="color:#aaa">${wallIdx} drawn · ${tailUsed} replaced</span>
      <span style="color:#ffd34d">▼ next draw</span>
      <span style="color:#ff9800">▲ next replacement</span>
      <span style="color:#555">dim = used</span>
    `;
  }
  el.appendChild(stats);

  function isTailConsumed(i) {
    const c = Math.floor(i / 2);
    const isTop = (i % 2 === 0);
    if (c > tailCol) return true;
    if (c === tailCol && isTop && tailPhase === 1) return true;
    return false;
  }

  const colsDiv = document.createElement('div');
  colsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;align-items:flex-start;';

  for (let c = 0; c < 72; c++) {
    const topIdx = c * 2;
    const botIdx = c * 2 + 1;

    const colDiv = document.createElement('div');
    colDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:1px;flex-shrink:0;';

    for (const i of [topIdx, botIdx]) {
      const isHead     = !exhausted && i === effectiveHeadIdx;
      const isTail     = !exhausted && !lastTile && i === effectiveTailIdx;
      const isBoth     = !exhausted && lastTile && i === effectiveHeadIdx;
      const isHeadUsed = i < wallIdx;
      const isTailUsed = isTailConsumed(i);

      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;';

      const te = makeTileEl(wall[i], { small: true, skipCache: true });
      te.style.cssText += 'width:30px!important;height:42px!important;font-size:11px;cursor:default;';

      if (isBoth) {
        te.style.outline = '3px solid #ff4444';
        te.style.boxShadow = '0 0 8px 3px rgba(255,68,68,0.7)';
      } else if (isHead) {
        te.style.outline = '3px solid #ffd34d';
        te.style.boxShadow = '0 0 6px 2px rgba(255,211,77,0.5)';
      } else if (isTail) {
        te.style.outline = '3px solid #ff9800';
        te.style.boxShadow = '0 0 6px 2px rgba(255,152,0,0.5)';
      } else if (exhausted || isHeadUsed) {
        te.style.opacity = '0.18';
      } else if (isTailUsed) {
        te.style.opacity = '0.22';
        te.style.outline = '1px solid rgba(255,152,0,0.35)';
      }

      wrap.appendChild(te);
      if (isHead || isTail || isBoth) {
        const lbl = document.createElement('div');
        lbl.style.cssText = `font-size:7px;font-weight:700;line-height:1;margin-top:1px;color:${isBoth?'#ff4444':isHead?'#ffd34d':'#ff9800'};`;
        lbl.textContent = isBoth ? '▼▲' : isHead ? '▼' : '▲';
        wrap.appendChild(lbl);
      }
      colDiv.appendChild(wrap);
    }

    // Column label under pointer columns
    const isHeadCol  = !exhausted && c === Math.floor(effectiveHeadIdx / 2);
    const isTailColH = !exhausted && !lastTile && c === Math.floor(effectiveTailIdx / 2);
    const isBothCol  = !exhausted && lastTile && c === Math.floor(effectiveHeadIdx / 2);
    if (isHeadCol || isTailColH || isBothCol) {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:8px;font-weight:700;line-height:1;margin-top:2px;';
      if (isBothCol) { lbl.style.color = '#ff4444'; lbl.textContent = '▼▲'; }
      else if (isHeadCol && isTailColH) { lbl.style.color = '#fff'; lbl.textContent = '▼▲'; }
      else if (isHeadCol) { lbl.style.color = '#ffd34d'; lbl.textContent = '▼'; }
      else { lbl.style.color = '#ff9800'; lbl.textContent = '▲'; }
      colDiv.appendChild(lbl);
    }

    colsDiv.appendChild(colDiv);
  }

  el.appendChild(colsDiv);

  if (exhausted) {
    const banner = document.createElement('div');
    banner.style.cssText = 'margin-top:10px;padding:8px 14px;background:rgba(255,68,68,0.12);border:2px solid #ff4444;border-radius:8px;text-align:center;font-size:12px;font-weight:700;color:#ff8080;';
    banner.textContent = '🏁 Wall exhausted — no tiles remain. This hand ends in a draw (黃牌).';
    el.appendChild(banner);
  }
}



function populateTileGallery() {
  function fill(id, tiles) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    for (const t of tiles) el.appendChild(makeTileEl(t, {}));
  }
  let id = 9000;
  const mk = (suit, value) => ({ id: id++, suit, value });
  fill('gal-bamboo', Array.from({length:9}, (_,i) => mk(SUIT.BAMBOO, i+1)));
  fill('gal-circle', Array.from({length:9}, (_,i) => mk(SUIT.CIRCLE, i+1)));
  fill('gal-char',   Array.from({length:9}, (_,i) => mk(SUIT.CHAR,   i+1)));
  fill('gal-wind',   WINDS.map(w => mk(SUIT.WIND, w)));
  fill('gal-dragon', DRAGONS.map(d => mk(SUIT.DRAGON, d)));
  fill('gal-flower', Array.from({length:4}, (_,i) => mk(SUIT.FLOWER, i)));
  fill('gal-season', Array.from({length:4}, (_,i) => mk(SUIT.SEASON, i)));
}

// ---- Wall drawn as tile-backs around the perimeter ----
// The SVG viewBox is larger than the discard area — wall tiles are drawn
// in the margin OUTSIDE the 720x540 discard area.
// viewBox: 0 0 720 540, but wall tiles drawn in the outer ~20px border
const WALL_SLOTS = { top:18, bottom:18, left:18, right:18 };
const WALL_TOTAL_SLOTS = 18*4; // 72
const WT_W = 16, WT_H = 20, WT_GAP = 2;
const WALL_MARGIN = 4; // px from edge of viewBox

function renderWallRing() {
  const svg = document.getElementById('wall-ring-svg');
  if (!svg || !_game) return;

  const W = 720, H = 608;
  const remaining = Math.max(0, _game.wallRemaining());
  const total = WALL_TOTAL_SLOTS;

  // Exact head/tail column counts (no rounding — matches peek.html logic)
  const wallIdx   = _game.wallIdx   ?? 0;
  const tailCol   = _game.tailCol   ?? 71;
  const tailPhase = _game.tailPhase ?? 0;
  const effTP     = (tailPhase === 0 && tailCol * 2 < wallIdx) ? 1 : tailPhase;
  // headSlots = number of ring columns fully or partially consumed from the head
  const headSlots = Math.ceil(wallIdx / 2);
  // tailSlots = number of ring columns fully or partially consumed from the tail
  const tailSlots = (71 - tailCol) + (effTP > 0 ? 1 : 0);

  // Build clockwise ring
  const ring = [];
  const botCount = WALL_SLOTS.bottom;
  const botTotalW = botCount * WT_W + (botCount-1) * WT_GAP;
  const botEndX = (W + botTotalW) / 2 - WT_W;
  for (let i = 0; i < botCount; i++)
    ring.push({ x: botEndX - i*(WT_W+WT_GAP), y: H - WT_H - WALL_MARGIN, w: WT_W, h: WT_H });

  const leftCount = WALL_SLOTS.left;
  const leftTotalH = leftCount * WT_W + (leftCount-1) * WT_GAP;
  const leftEndY = (H + leftTotalH) / 2 - WT_W;
  for (let i = 0; i < leftCount; i++)
    ring.push({ x: WALL_MARGIN, y: leftEndY - i*(WT_W+WT_GAP), w: WT_H, h: WT_W });

  const topCount = WALL_SLOTS.top;
  const topTotalW = topCount * WT_W + (topCount-1) * WT_GAP;
  const topStartX = (W - topTotalW) / 2;
  for (let i = 0; i < topCount; i++)
    ring.push({ x: topStartX + i*(WT_W+WT_GAP), y: WALL_MARGIN, w: WT_W, h: WT_H });

  const rightCount = WALL_SLOTS.right;
  const rightTotalH = rightCount * WT_W + (rightCount-1) * WT_GAP;
  const rightStartY = (H - rightTotalH) / 2;
  for (let i = 0; i < rightCount; i++)
    ring.push({ x: W - WT_H - WALL_MARGIN, y: rightStartY + i*(WT_W+WT_GAP), w: WT_H, h: WT_W });

  const seatSlotStart = { 0: 0, 3: botCount, 2: botCount + leftCount, 1: botCount + leftCount + topCount };
  const breakSeat  = _game.wallBreakSeat  ?? 0;
  const breakCount = _game.wallBreakCount ?? _game.diceTotal ?? 9;
  const headSlot   = (seatSlotStart[breakSeat] + breakCount) % total;
  const slots = [...ring.slice(headSlot), ...ring.slice(0, headSlot)];

  // slots[0..headSlots-1]               = head gap (normal draws consumed)
  // slots[headSlots..total-tailSlots-1]  = live wall (green)
  // slots[total-tailSlots..total-1]      = tail gap (kong/bonus consumed, shown amber)

  let svgContent = '';

  for (let i = 0; i < total; i++) {
    const s = slots[i];
    const {x, y, w, h} = s;
    const isHeadGap = i < headSlots;
    const isTailGap = i >= total - tailSlots;

    if (!isHeadGap && !isTailGap) {
      // Live wall tile — green back
      svgContent += `<rect x="${(x+1.5).toFixed(1)}" y="${(y+1.5).toFixed(1)}" width="${w}" height="${h}" rx="2" fill="rgba(0,0,0,0.4)"/>`;
      svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="2" fill="#1a6b3a" stroke="#042510" stroke-width="1"/>`;
      svgContent += `<rect x="${(x+2).toFixed(1)}" y="${(y+2).toFixed(1)}" width="${w-4}" height="${h-4}" rx="1" fill="none" stroke="#2a8b4e" stroke-width="1"/>`;
      svgContent += `<rect x="${(x+1).toFixed(1)}" y="${(y+1).toFixed(1)}" width="${w-2}" height="${Math.ceil(h*0.3)}" rx="1" fill="rgba(255,255,255,0.15)"/>`;
    } else if (isTailGap && tailSlots > 0) {
      // Tail consumed — faint amber ghost
      svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="2" fill="rgba(180,100,0,0.18)" stroke="rgba(255,152,0,0.4)" stroke-width="1"/>`;
    }
    // head gap: empty, no render
  }

  // Yellow dot = next normal draw (head end)
  if (remaining > 0 && headSlots < total - tailSlots) {
    const s = slots[headSlots];
    svgContent += `<circle cx="${(s.x+s.w/2).toFixed(1)}" cy="${(s.y+s.h/2).toFixed(1)}" r="3.5" fill="#ffd34d" opacity="0.9"/>`;
  }

  // Orange dot = next tail draw (tail end) — always show to orient the player
  if (total - tailSlots - 1 >= headSlots) {
    const s = slots[total - tailSlots - 1];
    const op = tailSlots > 0 ? 0.85 : 0.3;
    svgContent += `<circle cx="${(s.x+s.w/2).toFixed(1)}" cy="${(s.y+s.h/2).toFixed(1)}" r="3" fill="#ff9800" opacity="${op}"/>`;
  }

  // Center text — tail replacement count
  const tailDrawn = (71 - tailCol) * 2 + effTP;
  if (tailDrawn > 0) {
    svgContent += `<text x="360" y="320" text-anchor="middle" font-size="11" fill="rgba(255,152,0,0.5)" font-family="sans-serif">+${tailDrawn} tail</text>`;
  }

  svg.innerHTML = svgContent;
}

function setShowSeatParens(v) { _showSeatParens = v; }
function dismissHint() { const p = document.getElementById('hint-panel'); if (p) p.remove(); }
function setAlwaysHint(v) { _alwaysHint = v; if (!v) dismissHint(); }
