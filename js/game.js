// ============================================================
// game.js  — Game state and turn logic
// ============================================================

const PHASE = {
  DRAW:    'draw',
  DISCARD: 'discard',
  CLAIM:   'claim',
  END:     'end',
  IDLE:    'idle',
};

const SEAT_NAMES = ['East 東', 'South 南', 'West 西', 'North 北'];

function playerTag(player) {
  return `Seat ${player.seat}`;
}

class Game {
  constructor(onUpdate) {
    this.onUpdate = onUpdate; // called whenever state changes
    this.reset();
  }

  reset() {
    // Clear stale score deltas from previous game
    try { localStorage.removeItem('mahjongPrevScores'); } catch(e) {}
    this.wall = buildWall();
    this.wallIdx  = 0;   // head: normal draws advance forward
    this.tailCol  = 71;  // tail column (0-71): replacement draws retreat left
    this.tailPhase = 0;  // 0 = top tile next, 1 = bottom tile next

    const startPts = (typeof START_POINTS !== 'undefined') ? START_POINTS : 2000;

    // 4 players: 0 = human, 1-3 = CPU1/CPU2/CPU3
    this.players = WINDS.map((wind, i) => ({
      seat: i,
      wind,
      hand: [],
      melds: [],
      bonus: [],
      score: startPts,
      isHuman: i === 0,
      name: i === 0 ? 'You' : `CPU${i}`,
      lastDiscard: null,
    }));

    this.roundWind = 'East';
    this.dealerSeat = 0;
    this._roundStartDealer = 0; // seat that opened the current wind round
    this.currentSeat = 0;
    this.phase = PHASE.IDLE;
    this.discard = null;        // last discarded tile
    this.discardSeat = null;
    this.discardPile = [];
    this.claimOptions = null;   // { win, pung, kong, chow } for human
    this.claimSeat = null;
    this.pendingClaims = [];    // [{seat, action}] AI claims waiting
    this.firstDraw = true;
    this.dealerFirstDiscard = false; // true after dealer's very first discard (for Earthly Hand)
    this.handActionCount = 0;        // counts any claim/kong action (for Heavenly/Earthly detection)
    this.lastResult = null;
    this.lastCheckFaan = 0;
    this.robbingKongSeat = null;    // seat of kong declarer when rob-check is pending
    this.robbingKongTile = null;    // the tile being konged
    this.robbingKongTiles = null;   // all 4 kong tiles
    this.robbingKongPungIdx = null; // index of pung in melds being upgraded

    this._captureMoves = [];
    this._captureWall = null;
    this._captureDice = null;

    this._initLog('New Game');
    this.deal();
  }

  deal() {
    // Replay: inject saved wall + dice instead of shuffling
    if (window.REPLAY_MODE && window._replayData) {
      const rd = window._replayData;
      this.dice = [...rd.dice];
      this.diceTotal = this.dice.reduce((a, b) => a + b, 0);
      const breakSeat = (this.dealerSeat + (this.diceTotal - 1) % 4) % 4;
      this.wallBreakSeat  = breakSeat;
      this.wallBreakCount = this.diceTotal;
      this.wall = rd.wall.map(({ suit, value }) => makeTile(suit, value));
      this.wallIdx = 0;
      this._captureWall = rd.wall;
      this._captureDice = [...this.dice];
      this._captureMoves = [];
      window._moveQueue = rd.moves ? [...rd.moves] : null;
      this.addLog(`Wall built and shuffled — 144 tiles.`);
      this.addLog(`Dealer ${playerTag(this.players[this.dealerSeat])} rolls dice: ${this.dice[0]}+${this.dice[1]}+${this.dice[2]} = ${this.diceTotal}.`);
      this.addLog(`Wall break: ${playerTag(this.players[breakSeat])}'s side, ${this.diceTotal} stacks from right — dealing starts here.`);
      this.addLog(`Wall: ${JSON.stringify(this._captureWall)}`);
      return this._dealTiles();
    }

    // Roll three dice to determine wall break point
    this.dice = [
      Math.floor(Math.random()*6)+1,
      Math.floor(Math.random()*6)+1,
      Math.floor(Math.random()*6)+1
    ];
    this.diceTotal = this.dice.reduce((a,b)=>a+b,0);

    // WALL BREAK — Cantonese rules:
    //
    // Seats: counter-clockwise order. 0=dealer(bottom), 1=right, 2=top, 3=left.
    // Dice counting starts at dealer=1, goes counter-clockwise:
    //   1=dealer(0), 2=left(3), 3=top(2), 4=right(1), 5=dealer(0), ...
    // So breakSeat = (dealerSeat + (diceTotal-1) % 4) % 4
    //
    // Verification (dealer=seat 0):
    //   dice=8 → (0 + 7%4)%4 = 3 = left   ✓
    //   dice=2,6,10,14 → (0 + 1%4)%4 = 1 = right ✓
    //   dice=3,7,11 → (0 + 2%4)%4 = 2 = top
    //   dice=4,8,12 → (0 + 3%4)%4 = 3 = left  ← wait, 8%4=0 not 3
    // Recheck dice=8: (8-1)%4 = 7%4 = 3 → (0+3)%4 = 3 = left ✓
    // dice=4: (4-1)%4 = 3 → (0+3)%4 = 3 = left
    // dice=5: (5-1)%4 = 0 → (0+0)%4 = 0 = dealer
    //
    // Wall array segments are in counter-clockwise order:
    //   [0..35]   = seat 0 (bottom/dealer side)
    //   [36..71]  = seat 3 (left)
    //   [72..107] = seat 2 (top)
    //   [108..143]= seat 1 (right)
    // ccwOrder[i] gives the seat number for segment i.
    //
    // Within the break segment, count diceTotal tiles clockwise from the
    // RIGHT end of that segment. Clockwise = decreasing array index.
    // The tile at position (segEnd - diceTotal + 1) becomes the first drawn tile (head).

    const tilesPerSide = 36;
    const ccwOrder = [0, 3, 2, 1]; // wall array segment index → seat number

    // Step 1: which seat's wall segment is broken
    // Count counter-clockwise from dealer starting at 1
    const breakSeat = (this.dealerSeat + (this.diceTotal - 1) % 4) % 4;

    // Step 2: find segment index and head tile index
    // Count diceTotal COLUMNS (pairs) from the player's right end of their wall.
    // segBase = first physical index of that segment.
    // headIdx = inner tile of the (diceTotal)th column from the right = segBase + 2*diceTotal.
    const segIdx  = ccwOrder.indexOf(breakSeat);
    const segBase = segIdx * tilesPerSide;
    const headIdx = (segBase + 2 * this.diceTotal) % this.wall.length;

    // Store break info for the visual wall ring renderer
    this.wallBreakSeat  = breakSeat;   // which seat's wall was broken
    this.wallBreakCount = this.diceTotal; // how many tiles from right end of that segment

    this.addLog(`Wall built and shuffled — 144 tiles.`);
    this.addLog(`Dealer ${playerTag(this.players[this.dealerSeat])} rolls dice: ${this.dice[0]}+${this.dice[1]}+${this.dice[2]} = ${this.diceTotal}.`);
    this.addLog(`Wall break: ${playerTag(this.players[breakSeat])}'s side, ${this.diceTotal} stacks from right — dealing starts here.`);

    // Rotate wall so index 0 = head (first tile drawn)
    this.wall = [...this.wall.slice(headIdx), ...this.wall.slice(0, headIdx)];
    this.wallIdx = 0;
    this._captureDice = [...this.dice];
    this._captureWall = this.wall.map(t => ({ suit: t.suit, value: t.value }));
    this.addLog(`Wall: ${JSON.stringify(this._captureWall)}`);
    this._captureMoves = [];
    window._moveQueue = null;
    return this._dealTiles();
  }

  _dealTiles() {
    // Round-robin deal: 3 rounds of 4 tiles each, then 1 tile each, then dealer's extra.
    const d = this.dealerSeat;
    const ccwSeats = [d, (d+1)%4, (d+2)%4, (d+3)%4];
    for (const seat of ccwSeats) {
      this.players[seat].hand = [];
      this.players[seat].melds = [];
      this.players[seat].bonus = [];
    }

    this.addLog(`${playerTag(this.players[d])} deals — distributing tiles.`);

    for (let round = 0; round < 3; round++) {
      for (const seat of ccwSeats) {
        const tiles = [this.drawFromWall(), this.drawFromWall(), this.drawFromWall(), this.drawFromWall()];
        this.players[seat].hand.push(...tiles);
        this.addLog(`${playerTag(this.players[seat])} gets 4 tiles: ${tiles.map(tileMain).join(' ')}`);
      }
    }

    for (const seat of ccwSeats) {
      const tile = this.drawFromWall();
      this.players[seat].hand.push(tile);
      this.addLog(`${playerTag(this.players[seat])} gets 1 tile: ${tileMain(tile)}`);
    }

    const extraTile = this.drawFromWall();
    this.players[d].hand.push(extraTile);
    this.addLog(`${playerTag(this.players[d])} gets 1 tile: ${tileMain(extraTile)}`);


    // Cantonese round-robin bonus replacement:
    // Each round every player (dealer first) replaces all bonus tiles currently
    // in hand. Replacement tiles received this round are NOT replaced until the
    // next round — the loop repeats until nobody draws a bonus tile.
    let anyBonus = true;
    while (anyBonus) {
      anyBonus = false;
      for (const seat of ccwSeats) {
        const p = this.players[seat];
        const toReplace = p.hand.filter(t => isBonus(t));
        if (toReplace.length === 0) continue;
        anyBonus = true;
        for (const b of toReplace) {
          p.hand.splice(p.hand.indexOf(b), 1);
          p.bonus.push(b);
          this.addLog(`${playerTag(p)} bonus ${tileMain(b)} → replacement`);
          const newTile = this.drawFromTail();
          if (!newTile) {
            this.addLog(`${playerTag(p)} bonus replacement: wall exhausted — hand ended 黃牌!`);
            this.phase = PHASE.END;
            this.lastResult = { winner: -1, faan: 0, label: 'Draw', selfDraw: false, base: 0 };
            this._saveReplay();
            this.onUpdate('draw');
            return;
          }
          this.addLog(`${playerTag(p)} bonus replacement: ${tileMain(newTile)}`);
          p.hand.push(newTile);
        }
      }
    }

    // Dealer already holds 14 tiles — go straight to discard (no draw needed).
    // Mark the last tile _justDrawn so Heavenly Hand detection works correctly.
    this.currentSeat = d;
    this.phase = PHASE.DISCARD;
    this.firstDraw = false;
    this.dealerFirstDiscard = false;
    this.handActionCount = 0;
    this._isFirstDealerDraw = true;
    this._drewLastTile = false;
    this.discard = null; this.discardSeat = null; this.lastClaimedTile = null; this.lastClaimedFromSeat = null;

    const dealerP = this.players[d];
    for (const pl of this.players) for (const t of pl.hand) t._justDrawn = false;
    if (dealerP.hand.length > 0) dealerP.hand[dealerP.hand.length - 1]._justDrawn = true;

    if (dealerP.isHuman && !window.AUTO_MODE) {
      const ctx = this.makeCtx(d, true);
      ctx.heavenlyHand = true;
      const result = canWin(dealerP.hand, dealerP.melds, ctx);
      const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
      if (result.win && result.faan >= minF) {
        this.claimOptions = { win: result, pung: false, kong: false, chow: false };
        this.phase = PHASE.CLAIM;
        this.pendingClaims = [];
        this._actForSeat(d, 'claim-prompt');
      } else {
        this.claimOptions = null;
        this.lastCheckFaan = result.faan || 0;
        this._actForSeat(d, 'your-turn');
      }
    } else {
      this._scheduleOrStep(() => this.aiPlay(d));
    }
  }

  drawFromWall() {
    if (this.wallRemaining() <= 0) return null;
    // If the tail already took the top tile of our current column, take the bottom instead
    if (this.wallIdx % 2 === 0 &&
        Math.floor(this.wallIdx / 2) === this.tailCol &&
        this.tailPhase === 1) {
      this.wallIdx++;
    }
    return this.wall[this.wallIdx++];
  }

  // Replacement tiles come from the TAIL — column by column right-to-left, top (even) first
  // Order: 142,143, 140,141, 138,139 … 2,3, 0,1
  drawFromTail() {
    if (this.wallRemaining() <= 0) return null;
    // If the head already took the top tile of our current column, use the bottom instead
    if (this.tailPhase === 0 && this.tailCol * 2 < this.wallIdx) {
      this.tailPhase = 1;
    }
    const idx = this.tailCol * 2 + this.tailPhase;
    if (idx < this.wallIdx) return null; // safety: truly exhausted
    if (this.tailPhase === 0) {
      this.tailPhase = 1;
    } else {
      this.tailPhase = 0;
      this.tailCol--;
    }
    return this.wall[idx];
  }

  // remaining = tiles not yet consumed from either end
  wallRemaining() { return Math.max(0, 2 * (this.tailCol + 1) - this.wallIdx - this.tailPhase); }
  tailTilesUsed() { return (71 - this.tailCol) * 2 + this.tailPhase; }

  replaceBonus(player) {
    let found = true;
    while (found) {
      found = false;
      for (let i = player.hand.length - 1; i >= 0; i--) {
        if (isBonus(player.hand[i])) {
          const b = player.hand.splice(i, 1)[0];
          player.bonus.push(b);
          this.addLog(`${playerTag(player)} bonus ${tileMain(b)} → replacement`);
          const newTile = this.drawFromTail(); // bonus replacement from tail
          if (newTile) {
            this.addLog(`${playerTag(player)} bonus replacement: ${tileMain(newTile)}`);
            for (const t of player.hand) t._justDrawn = false;
            newTile._justDrawn = true;
            if (player.isHuman) {
              player.hand.unshift(newTile);
            } else {
              player.hand.push(newTile);
            }
          } else {
            this.addLog(`${playerTag(player)} bonus replacement: wall exhausted — hand ended 黃牌!`);
            this.phase = PHASE.END;
            this.lastResult = { winner: -1, faan: 0, label: 'Draw', selfDraw: false, base: 0 };
            this._saveReplay();
            this.onUpdate('draw');
            return false;
          }
          found = true;
        }
      }
    }
    return true;
  }

  // Helper: add a newly drawn tile — leftmost + highlighted for human, appended for CPU
  _addDrawnTile(player, tile) {
    for (const t of player.hand) t._justDrawn = false;
    tile._justDrawn = true;
    if (player.isHuman) {
      player.hand.unshift(tile);
    } else {
      player.hand.push(tile);
    }
  }

  startTurn(seat) {
    this.currentSeat = seat;
    const p = this.players[seat];
    const drawn = this.drawFromWall();
    if (!drawn) {
      this.addLog('Wall exhausted — exhausted draw 黃牌!');
      this.phase = PHASE.END;
      this.lastResult = { winner: -1, faan: 0, label: 'Draw', selfDraw: false, base: 0 };
      this._saveReplay();
      this.onUpdate('draw');
      return;
    }
    // Clear the last-discard highlight now that a new tile has been drawn
    this.discard = null;
    this.discardSeat = null;
    this.lastClaimedTile = null;
    this.lastClaimedFromSeat = null;

    // Clear just-drawn highlight from all players before marking the new draw
    for (const player of this.players) {
      for (const t of player.hand) t._justDrawn = false;
    }
    drawn._justDrawn = true;
    // Track if this was the last tile from the wall
    this._drewLastTile = (this.wallRemaining() === 0);
    this.addLog(`${playerTag(p)} draws ${tileMain(drawn)}`);
    this._addDrawnTile(p, drawn);
    if (!this.replaceBonus(p)) return;
    this._checkHandCount(seat, 14 - 3 * p.melds.length, 'after-draw');

    // Track whether this is the dealer's very first draw (for Heavenly Hand)
    this._isFirstDealerDraw = (seat === this.dealerSeat && this.handActionCount === 0 && !this.dealerFirstDiscard);
    this.firstDraw = false;
    this.phase = PHASE.DISCARD;

    // In sprint mode treat human seat identically to CPU — bypasses the
    // intermediate claimOptions path and goes straight to aiPlay like every
    // other seat, eliminating any isHuman code-path bias in auto runs.
    if (p.isHuman && !window.AUTO_MODE) {
      // Check if the human can win by self-draw with the new tile
      const ctx = this.makeCtx(0, true);
      // Heavenly Hand: dealer wins on very first draw with no prior action
      if (seat === this.dealerSeat && this.handActionCount === 0 && this._isFirstDealerDraw) {
        ctx.heavenlyHand = true;
      }
      // Last Tile 海底撈月: self-draw on last wall tile (if option enabled)
      if (this._drewLastTile && (typeof LAST_TILE_WIN !== 'undefined') && LAST_TILE_WIN) {
        ctx.lastTile = true;
      }
      const result = canWin(p.hand, p.melds, ctx);
      const minFSelf = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
      if (result.win && result.faan >= minFSelf) {
        this.claimOptions = { win: result, pung: false, kong: false, chow: false };
        this.phase = PHASE.CLAIM;
        this.pendingClaims = [];
        this._actForSeat(0, 'claim-prompt');
      } else {
        this.claimOptions = null;
        this.lastCheckFaan = result.faan || 0;
        this._actForSeat(0, 'your-turn');
      }
    } else {
      this.onUpdate('cpu-drew');  // render draw state so just-drawn highlight is visible
      if (window.AUTO_MODE === 'slow') { this.aiPlay(seat); } else { this._scheduleOrStep(() => this.aiPlay(seat)); }
    }
  }

  // Route any game action through slow-mode gating or normal timeout
  _scheduleOrStep(fn) {
    if (window.AUTO_MODE === 'slow') {
      this._queueAutoStep(fn);  // gate ALL players behind Pass click
    } else if (window.AUTO_MODE === 'fast') {
      setTimeout(fn, window.AUTO_FAST_DELAY ?? 180); // fast but still visible
    } else if (window.AUTO_MODE === 'sprint' || window.AUTO_MODE === 'sprint_slow') {
      fn(); // synchronous — entire hand computes in one call stack, no delay
    } else {
      setTimeout(fn, 0);  // normal manual-mode timing
    }
  }

  // Auto-mode step queue: FIFO queue for slow mode only
  // Fast mode never calls this — it uses _scheduleOrStep which goes straight to setTimeout
  _queueAutoStep(fn) {
    if (!this._autoStepQueue) this._autoStepQueue = [];
    this._autoStepQueue.push(fn);
    this._pendingAutoStep = this._autoStepQueue[0];
    this.onUpdate('auto-step-ready');
  }

  stepAuto() {
    if (!this._autoStepQueue) this._autoStepQueue = [];
    if (this._autoStepQueue.length > 0) {
      const fn = this._autoStepQueue.shift();
      this._pendingAutoStep = this._autoStepQueue[0] ?? null;
      fn();
    }
  }

  // After a seat takes an action (claim/kong/discard-turn), route correctly:
  // human seat in auto mode -> schedule aiPlay; human seat manual -> wait; CPU -> schedule
  _actForSeat(seat, updateEvent = 'your-turn') {
    const p = this.players[seat];
    if (p.isHuman && window.AUTO_MODE) {
      this.onUpdate(updateEvent);
      if (window.AUTO_MODE === 'slow') { this.aiPlay(seat); } else { this._scheduleOrStep(() => this.aiPlay(seat)); }
    } else if (p.isHuman) {
      this.onUpdate(updateEvent);
    } else {
      this._scheduleOrStep(() => this.aiPlay(seat));
    }
  }

  aiPlay(seat) {
    // Refresh CPU_LEVELS and CPU_SCHEMES by current seat from name-based maps
    if (typeof CPU_LEVELS !== 'undefined' && typeof window !== 'undefined' &&
        window.CPU_LEVELS_BY_NAME) {
      for (const pl of this.players) {
        if (!pl.isHuman && window.CPU_LEVELS_BY_NAME[pl.name] !== undefined) {
          CPU_LEVELS[pl.seat] = window.CPU_LEVELS_BY_NAME[pl.name];
        }
      }
    }
    if (window.CPU_SCHEMES_BY_NAME) {
      if (!window.CPU_SCHEMES) window.CPU_SCHEMES = [null, null, null, null];
      for (const pl of this.players) {
        if (!pl.isHuman && window.CPU_SCHEMES_BY_NAME[pl.name] !== undefined) {
          window.CPU_SCHEMES[pl.seat] = window.CPU_SCHEMES_BY_NAME[pl.name];
        }
      }
    }
    // In auto mode, seat 0 (human) uses AUTO_USER_LEVEL
    if (seat === 0 && window.AUTO_MODE && typeof CPU_LEVELS !== 'undefined') {
      CPU_LEVELS[0] = window.AUTO_USER_LEVEL ?? 1;
    }
    const p = this.players[seat];
    const ctx = this.makeCtx(seat, true);
    // Heavenly Hand: dealer's initial 14 dealt tiles form a winning hand
    const isHeavenly = (seat === this.dealerSeat && this.handActionCount === 0 && this._isFirstDealerDraw);
    if (isHeavenly) ctx.heavenlyHand = true;
    // Last Tile 海底撈月
    if (this._drewLastTile && (typeof LAST_TILE_WIN !== 'undefined') && LAST_TILE_WIN) {
      ctx.lastTile = true;
    }

    // Move-log replay: execute the saved action instead of re-running AI
    if (window.REPLAY_MODE && window._moveQueue) {
      const m = window._moveQueue[0];
      if (m && m.s === seat) {
        if (m.a === 'W') {
          window._moveQueue.shift();
          const result2 = canWin(p.hand, p.melds, ctx);
          this.resolveWin(seat, null, result2);
          return;
        }
        if (m.a === 'KS') {
          window._moveQueue.shift();
          const kong2 = this.findSelfKong(p);
          if (kong2) this.doSelfKong(seat, kong2);
          return;
        }
        if (m.a === 'D') {
          window._moveQueue.shift();
          const tile2 = p.hand.find(t => t.suit === m.t[0] && t.value === m.t[1]);
          if (tile2) this.doDiscard(seat, tile2);
          else console.warn(`[replay] discard tile not in hand: ${m.t} seat ${seat}`);
          return;
        }
      }
      // Queue entry doesn't match this seat — fall through to AI (shouldn't happen normally)
    }

    const result = canWin(p.hand, p.melds, ctx);
    const _scheme = seat === 0
      ? ((typeof USER_SCHEME !== 'undefined') ? USER_SCHEME : null)
      : (window.CPU_SCHEMES?.[seat] ?? null);
    const minF = Math.max(
      (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3,
      _scheme?.claim?.winMinFaan ?? 0
    );
    // Heavenly Hand needs no _justDrawn tile — all 14 were dealt. Regular
    // self-draw wins require the completing tile to have just been drawn.
    if (result.win && result.faan >= minF && (isHeavenly || p.hand.some(t => t._justDrawn))) {
      this.resolveWin(seat, null, result);
      return;
    }
    // Check self-kong (4 of same in hand)
    const kong = this.findSelfKong(p);
    if (kong) { this.doSelfKong(seat, kong); return; }

    const tile = aiChooseDiscardByLevel(seat, p.hand, p.melds, this.discardPile, this.players);
    this.doDiscard(seat, tile);
  }

  // Find concealed kong: 4 of same all in hand (never claimed)
  _findConcealedKong(player) {
    const counts = {};
    for (const t of player.hand) {
      const k = t.suit + '|' + t.value;
      counts[k] = (counts[k] || 0) + 1;
    }
    for (const [k, cnt] of Object.entries(counts)) {
      if (cnt === 4) {
        return player.hand.filter(t => t.suit + '|' + t.value === k);
      }
    }
    return null;
  }

  findSelfKong(player) {
    const counts = {};
    for (const t of player.hand) {
      const k = t.suit + '|' + t.value;
      counts[k] = (counts[k] || 0) + 1;
    }
    for (const [k, cnt] of Object.entries(counts)) {
      if (cnt === 4) return player.hand.filter(t => t.suit + '|' + t.value === k);
    }
    // Also check adding to existing pung (robbing the kong)
    for (const m of player.melds) {
      if (m.type === 'pung') {
        const extra = player.hand.find(t => sameType(t, m.tiles[0]));
        if (extra) return [extra, ...m.tiles];
      }
    }
    return null;
  }

  doSelfKong(seat, tiles) {
    const p = this.players[seat];
    const t = tiles[0];
    this._logMove({ a: 'KS', s: seat, t: [t.suit, t.value] });
    const existingPung = p.melds.findIndex(m => m.type === 'pung' && sameType(m.tiles[0], t));
    const isUpgrade = existingPung !== -1; // pung → kong upgrade can be robbed; concealed kong cannot

    if (isUpgrade) {
      // --- Check for Robbing the Kong (搶槓胡) before completing ---
      // Temporarily expose the kong tile so others can try to win with it
      const robbingTile = t;

      // Check if human (if not the kong declarer) can rob
      let humanCanRob = false;
      if (seat !== 0) {
        const hp = this.players[0];
        const handWith = [...hp.hand, robbingTile];
        const ctx = this.makeCtx(0, false);
        ctx.robbedKong = true;
        const result = canWin(handWith, hp.melds, ctx);
        const minFRobH = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
        if (result.win && result.faan >= minFRobH) humanCanRob = result;
      }

      // Check if any AI can rob
      const aiRobbers = [];
      for (let i = 1; i <= 3; i++) {
        const s = (seat + i) % 4;
        if (s === 0) continue; // human handled above
        const ap = this.players[s];
        const handWith = [...ap.hand, robbingTile];
        const ctx = this.makeCtx(s, false);
        ctx.robbedKong = true;
        const result = canWin(handWith, ap.melds, ctx);
        const minFRobA = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
        if (result.win && result.faan >= minFRobA) aiRobbers.push({ seat: s, result });
      }

      if (humanCanRob || aiRobbers.length > 0) {
        // Pause — store state so rob resolution knows what's happening
        this.robbingKongSeat = seat;      // who declared the kong
        this.robbingKongTile = robbingTile;
        this.robbingKongTiles = tiles;
        this.robbingKongPungIdx = existingPung;

        // Counter-clockwise priority: if an AI robber is closer to the kong declarer
        // than the human, suppress the human win offer — AI wins automatically.
        const humanDiff = (0 - seat + 4) % 4;
        if (humanCanRob) {
          const closerAI = aiRobbers.find(r => ((r.seat - seat + 4) % 4) < humanDiff);
          if (closerAI) humanCanRob = false;
        }

        // Sort AI robbers by proximity to kong declarer (counter-clockwise)
        aiRobbers.sort((a, b) => ((a.seat - seat + 4) % 4) - ((b.seat - seat + 4) % 4));

        // Offer human the rob-win if they are closest (or tied with no closer AI)
        this.claimOptions = humanCanRob
          ? { win: humanCanRob, pung: false, kong: false, chow: false, robbingKong: true }
          : { win: false, pung: false, kong: false, chow: false, robbingKong: true };
        this.pendingClaims = aiRobbers.map(r => ({ seat: r.seat, action: 'win', result: r.result }));
        this.phase = PHASE.CLAIM;
        this.addLog(`${playerTag(p)} declares Kong 槓 ${tileMain(t)} — can be robbed!`);
        this.onUpdate('claim-prompt');
        // If the kong declarer is the human they cannot rob their own kong — auto-resolve.
        // Also auto-resolve in all auto modes.
        if (seat === 0 || window.AUTO_MODE) {
          this._scheduleOrStep(() => {
            if (this.robbingKongSeat === null) return;
            if (this.claimOptions && this.claimOptions.win) {
              this.humanClaim('win', null);
            } else {
              this.humanPass();
            }
          });
        }
        return;
      }
    }

    // No rob possible (or concealed kong) — complete the kong normally
    this._completeKong(seat, tiles, existingPung);
  }

  _completeKong(seat, tiles, existingPungIdx) {
    const p = this.players[seat];
    const t = tiles[0];
    const idx = existingPungIdx !== undefined
      ? existingPungIdx
      : p.melds.findIndex(m => m.type === 'pung' && sameType(m.tiles[0], t));

    // Concealed Kong: all 4 tiles from hand (no existing pung meld being upgraded),
    // AND player has no claimed melds — concealed hand status preserved
    const isConcealedKong = (idx === -1) && p.melds.every(m => !m.claimed);

    if (idx !== -1) {
      p.melds[idx] = { type: 'kong', tiles, claimed: true };
      p.hand = p.hand.filter(x => !sameType(x, t));
    } else {
      const meld = { type: 'kong', tiles, claimed: false, concealed: isConcealedKong };
      if (seat === 0) p.melds.unshift(meld); else p.melds.push(meld);
      p.hand = p.hand.filter(x => !sameType(x, t));
    }
    const kongLabel = isConcealedKong ? 'Concealed Kong 暗槓' : 'Kong 槓';
    this.addLog(`${playerTag(this.players[seat])} ${kongLabel} ${tileMain(t)}`);
    // Draw replacement tile
    const repl = this.drawFromTail()  // kong replacement from tail wall;
    if (repl) {
      this.addLog(`${playerTag(p)} kong replacement: ${tileMain(repl)}`);
      this._addDrawnTile(p, repl); if (!this.replaceBonus(p)) return;
    } else {
      this.addLog(`${playerTag(p)} kong replacement: wall exhausted — exhausted draw 黃牌!`);
      this.phase = PHASE.END;
      this.lastResult = { winner: -1, faan: 0, label: 'Draw', selfDraw: false, base: 0 };
      this._saveReplay();
      this.onUpdate('draw');
      return;
    }
    this._checkHandCount(seat, 14 - 3 * p.melds.length, 'after-kong');
    this.phase = PHASE.DISCARD;
    this._actForSeat(seat);
  }

  resolveRobbedKong(robberSeat, result) {
    // Someone robbed the kong — resolve as a discard win against the kong declarer
    // The kong is NOT completed; the kong declarer's pung stays as-is
    const kongDeclarer = this.robbingKongSeat;
    this.robbingKongSeat = null;
    this.robbingKongTile = null;
    this.robbingKongTiles = null;
    this.robbingKongPungIdx = null;
    this.claimOptions = null;
    this.pendingClaims = [];
    this.resolveWin(robberSeat, kongDeclarer, result);
  }

  doDiscard(seat, tile) {
    const p = this.players[seat];
    const idx = p.hand.findIndex(t => t.id === tile.id);
    if (idx === -1) return;
    p.hand.splice(idx, 1);
    // 5.3: After human discards, sort their hand
    if (seat === 0) {
      p.hand = [...p.hand].sort((a, b) => tileSortKey(a) - tileSortKey(b));
    }
    tile._discardSeat = seat;
    tile._discardIdxBySeat = this.discardPile.filter(t => (t._discardSeat ?? 0) === seat).length;
    this.discardPile.push(tile);
    this.discard = tile;
    this.discardSeat = seat;
    p.lastDiscard = tile;
    this.addLog(`${playerTag(this.players[seat])} discards ${tileMain(tile)}`);
    this._logMove({ a: 'D', s: seat, t: [tile.suit, tile.value] });
    // Mark dealer's first discard for Earthly Hand detection
    if (seat === this.dealerSeat && !this.dealerFirstDiscard && this.handActionCount === 0) {
      this.dealerFirstDiscard = true;
    } else {
      // Any other discard means Heavenly/Earthly no longer possible
      this._earthlyPossible = false;
    }
    this.handActionCount++;
    this._checkHandCount(seat, 13 - 3 * p.melds.length, 'after-discard');
    this.phase = PHASE.CLAIM;
    this.processClaims(seat, tile);
  }

  processClaims(fromSeat, tile) {
    // Refresh CPU_LEVELS and CPU_SCHEMES by current seat (mirrors aiPlay — needed after seat rotation)
    if (typeof CPU_LEVELS !== 'undefined' && window.CPU_LEVELS_BY_NAME) {
      for (const pl of this.players) {
        if (!pl.isHuman && window.CPU_LEVELS_BY_NAME[pl.name] !== undefined)
          CPU_LEVELS[pl.seat] = window.CPU_LEVELS_BY_NAME[pl.name];
      }
    }
    if (window.CPU_SCHEMES_BY_NAME) {
      if (!window.CPU_SCHEMES) window.CPU_SCHEMES = [null, null, null, null];
      for (const pl of this.players) {
        if (!pl.isHuman && window.CPU_SCHEMES_BY_NAME[pl.name] !== undefined)
          window.CPU_SCHEMES[pl.seat] = window.CPU_SCHEMES_BY_NAME[pl.name];
      }
    }
    // Collect AI claims — in auto mode, seat 0 (human) also acts as CPU
    let claims = [];
    if (window.REPLAY_MODE && window._moveQueue) {
      // New-style replay: peek at the move queue for a CPU claim on this discard
      const m = window._moveQueue[0];
      if (m && ['P', 'C', 'KO', 'W'].includes(m.a) && m.s !== 0) {
        window._moveQueue.shift();
        const actMap = { P: 'pung', C: 'chow', KO: 'kong', W: 'win' };
        claims = [{ seat: m.s, action: actMap[m.a], _move: m }];
      }
      // If next entry is a human claim (m.s===0) or a discard, claims stays [] —
      // human claim is handled by replayStep; no-claim advances automatically below.
    } else {
      for (let i = 1; i <= 3; i++) {
        const seat = (fromSeat + i) % 4;
        const p = this.players[seat];
        if (p.isHuman && !window.AUTO_MODE) continue;
        const level = (p.isHuman && window.AUTO_MODE)
          ? (window.AUTO_USER_LEVEL ?? 1)
          : undefined;
        const aiCtx = this.makeCtx(seat, false);
        if (p.isHuman && window.AUTO_MODE) {
          if (typeof CPU_LEVELS !== 'undefined') CPU_LEVELS[0] = level;
        }
        const action = aiClaimDecisionByLevel(seat, p.hand, p.melds, tile, i, aiCtx, this.discardPile, this.players);
        if (action) claims.push({ seat, action });
      }
    }

    // Check if human can claim
    const humanSeat = 0;
    const humanDiff = (humanSeat - fromSeat + 4) % 4;
    const humanOptions = this.getHumanClaimOptions(tile, humanDiff);
    // Earthly Hand: dealer's first discard, no prior actions
    const isEarthly = (fromSeat === this.dealerSeat && 
                       this.handActionCount <= 1 &&
                       this.dealerFirstDiscard);
    if (isEarthly) {
      // Non-dealers get earthly hand bonus; dealer (discarder) cannot win their own discard
      if (humanSeat !== fromSeat) {
        humanOptions._earthlyHand = true;
      }
      for (const c of claims) {
        if (c.seat !== fromSeat) c._earthlyHand = true;
      }
    }

    // Counter-clockwise priority for wins: if an AI winner is closer to the discarder
    // than the human, suppress the human win offer — the AI wins automatically.
    if (humanOptions.win) {
      const closerAIWinner = claims.find(c => {
        if (c.action !== 'win') return false;
        const aiDiff = (c.seat - fromSeat + 4) % 4;
        return aiDiff < humanDiff;
      });
      if (closerAIWinner) {
        humanOptions.win = false;
        humanOptions._hijackedBy = closerAIWinner.seat; // remember who stole it
      }
    }

    this.claimOptions = humanOptions;
    this.pendingClaims = claims;

    if (fromSeat !== 0) {
      // A CPU discarded — show the board state
      this.onUpdate('claim-prompt');
      // In replay mode (new-style), auto-advance unless a human claim is queued next
      const replayNeedsHuman = window.REPLAY_MODE && window._moveQueue &&
        window._moveQueue[0] && ['P','C','KO','W'].includes(window._moveQueue[0].a) &&
        window._moveQueue[0].s === 0;
      if (window.AUTO_MODE || (window.REPLAY_MODE && window._moveQueue && !replayNeedsHuman)) {
        // CPU-You's claim was already decided above (in the claims array).
        // Just schedule resolving all claims, gated by Pass in slow mode.
        this._scheduleOrStep(() => {
          this.claimOptions = null;
          this.resolveAIClaims(fromSeat, tile, claims);
        });
      }
      // Manual mode (or replay with pending human claim): wait for human Pass click
    } else {
      // Seat 0 (human or CPU-You) just discarded
      this.onUpdate('claim-prompt');
      if (claims.length === 0) {
        const next = (fromSeat + 1) % 4;
        this._scheduleOrStep(() => this.startTurn(next));
      } else {
        this._scheduleOrStep(() => {
          this.claimOptions = null;
          this.resolveAIClaims(fromSeat, tile, claims);
        });
      }
    }
  }

  getHumanClaimOptions(tile, diff) {
    const p = this.players[0];
    const handWith = [...p.hand, tile];
    const ctx = this.makeCtx(0, false);
    const winResult = canWin(handWith, p.melds, ctx);
    const minFClaim = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
    // Also check bonus-tile special win (7/8 bonus tiles) — doesn't need the discard
    const bonusWinResult = canWin(p.hand, p.melds, ctx);
    const effectiveWin = (winResult.win && winResult.faan >= minFClaim) ? winResult
      : (bonusWinResult.win && bonusWinResult.special === 'bonus-win' && bonusWinResult.faan >= minFClaim) ? bonusWinResult
      : false;
    const canPung = p.hand.filter(t => sameType(t, tile)).length >= 2;
    // Kong: 3 matching tiles in hand, OR existing pung meld (discard is the 4th tile)
    const handMatchCount = p.hand.filter(t => sameType(t, tile)).length;
    const hasPungMeld = p.melds.some(m => m.type === 'pung' && sameType(m.tiles[0], tile));
    const canKong = handMatchCount === 3 || hasPungMeld;
    const canChow = diff === 1 && [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(tile.suit)
      && !!findChowWith(p.hand, tile);
    return {
      win:  effectiveWin,
      pung: canPung,
      kong: canKong,
      chow: canChow,
    };
  }

  resolveAIClaims(fromSeat, tile, claims) {
    // Priority: win > kong/pung > chow
    // Tiebreaker: counter-clockwise seat order from discarder (closest seat wins)
    const priority = { win: 3, kong: 2, pung: 2, chow: 1 };
    claims.sort((a, b) => {
      const pd = priority[b.action] - priority[a.action];
      if (pd !== 0) return pd;
      // Same priority — closest counter-clockwise seat to fromSeat wins
      const da = (a.seat - fromSeat + 4) % 4;
      const db = (b.seat - fromSeat + 4) % 4;
      return da - db;
    });
    if (claims.length === 0) {
      const next = (fromSeat + 1) % 4;
      if (window.AUTO_MODE === 'slow') { this.startTurn(next); } else { this._scheduleOrStep(() => this.startTurn(next)); }
      return;
    }
    const best = claims[0];
    const p = this.players[best.seat];
    const diff = (best.seat - fromSeat + 4) % 4;

    if (best.action === 'win') {
      const ctx = this.makeCtx(best.seat, false);
      if (best._earthlyHand) ctx.earthlyHand = true;
      const handWith = [...p.hand, tile];
      const result = canWin(handWith, p.melds, ctx);
      const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
      if (!result.win || result.faan < minF) {
        // Faan too low — skip win, treat as pass
        const next = (fromSeat + 1) % 4;
        if (window.AUTO_MODE === 'slow') { this.startTurn(next); } else { this._scheduleOrStep(() => this.startTurn(next)); }
        return;
      }
      this.resolveWin(best.seat, fromSeat, result, tile);
    } else if (best.action === 'pung' || best.action === 'kong') {
      this.doClaim(best.seat, tile, best.action, null);
    } else if (best.action === 'chow') {
      let chowTiles;
      if (best._move?.h) {
        const p2 = this.players[best.seat];
        const used = [];
        const handTiles = best._move.h.map(([st, v]) => {
          const t = p2.hand.find(x => x.suit === st && x.value === v && !used.includes(x.id));
          if (t) used.push(t.id);
          return t;
        }).filter(Boolean);
        chowTiles = handTiles.length === 2 ? [tile, ...handTiles] : findChowWith(p.hand, tile);
      } else {
        chowTiles = findChowWith(p.hand, tile);
      }
      if (chowTiles) this.doClaim(best.seat, tile, 'chow', chowTiles);
    }
  }

  humanPass() {
    this.claimOptions = null;
    if (this.robbingKongSeat !== null && this.robbingKongSeat !== undefined) {
      // Human passed on robbing — let AI rob or complete the kong
      const aiRobbers = this.pendingClaims.filter(c => c.action === 'win');
      const minFRob = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
      const validRobbers = aiRobbers.filter(r => r.result && r.result.faan >= minFRob);
      if (validRobbers.length > 0) {
        // AI robs it
        const robber = validRobbers[0];
        this.addLog(`${playerTag(this.players[robber.seat])} robs the Kong! 搶槓胡`);
        const kongDeclarer = this.robbingKongSeat;
        this.robbingKongSeat = null;
        this.pendingClaims = [];
        this.resolveWin(robber.seat, kongDeclarer, robber.result);
      } else {
        // Nobody robs — complete the kong
        const seat = this.robbingKongSeat;
        const tiles = this.robbingKongTiles;
        const idx = this.robbingKongPungIdx;
        this.robbingKongSeat = null;
        this.robbingKongTile = null;
        this.robbingKongTiles = null;
        this.robbingKongPungIdx = null;
        this.pendingClaims = [];
        this._completeKong(seat, tiles, idx);
      }
    } else if (this.discard === null && this.phase === PHASE.CLAIM) {
      // Was a self-draw win prompt — player declined, just discard normally
      this.phase = PHASE.DISCARD;
      this.onUpdate('your-turn');
    } else if (this.discard === null) {
      // Stale double-click — no-op, don't record
    } else if (this.discardSeat === 0) {
      // Human just discarded — processClaims already auto-scheduled resolution
      // via _scheduleOrStep. Phantom pass: don't record, don't double-resolve.
    } else {
      // Snapshot and clear before resolving so a rapid double-Pass is a no-op
      // on the second call (discard===null, phase still CLAIM → harmless branch above).
      const fromSeat = this.discardSeat;
      const tile     = this.discard;
      const claims   = this.pendingClaims;
      this.discard     = null;
      this.discardSeat = null;
      this.pendingClaims = [];
      this.resolveAIClaims(fromSeat, tile, claims);
    }
  }

  humanClaim(action, chowTiles) {
    if (!this.claimOptions) {
      // In auto mode, claimOptions may have been cleared already (race); recover gracefully
      if (window.AUTO_MODE && action === 'pass' && this.phase === PHASE.DISCARD && this.currentSeat === 0) {
        this._scheduleOrStep(() => this.aiPlay(0));
      }
      return;
    }
    if (action === 'win') {
      // Check if this is a rob-the-kong win
      if (this.claimOptions.robbingKong) {
        const tile = this.robbingKongTile;
        const kongDeclarer = this.robbingKongSeat;
        const hp = this.players[0];
        const handWith = [...hp.hand, tile];
        const ctx = this.makeCtx(0, false);
        ctx.robbedKong = true;
        const result = canWin(handWith, hp.melds, ctx);
        this.addLog(`${playerTag(this.players[0])} robs the Kong! 搶槓胡`);
        this.robbingKongSeat = null;
        this.robbingKongTile = null;
        this.robbingKongTiles = null;
        this.robbingKongPungIdx = null;
        this.claimOptions = null;
        this.pendingClaims = [];
        this.resolveWin(0, kongDeclarer, result);
      } else {
        const selfDraw = this.discard === null;
        if (selfDraw) {
          const ctx = this.makeCtx(0, true);
          if (this._isFirstDealerDraw && this.dealerSeat === 0 && this.handActionCount === 0) ctx.heavenlyHand = true;
          const result = canWin(this.players[0].hand, this.players[0].melds, ctx);
          this.resolveWin(0, null, result);
        } else {
          const tile = this.discard;
          const ctx = this.makeCtx(0, false);
          if (this.claimOptions && this.claimOptions._earthlyHand) ctx.earthlyHand = true;
          const handWith = [...this.players[0].hand, tile];
          const result = canWin(handWith, this.players[0].melds, ctx);
          this.resolveWin(0, this.discardSeat, result);
        }
      }
    } else {
      const tile = this.discard;
      this.doClaim(0, tile, action, chowTiles);
    }
  }

  doClaim(seat, tile, action, chowTiles) {
    const p = this.players[seat];
    // Remove discard from discard pile
    const dIdx = this.discardPile.findIndex(t => t.id === tile.id);
    if (dIdx !== -1) this.discardPile.splice(dIdx, 1);
    this.lastClaimedTile = tile;
    this.lastClaimedFromSeat = this.discardSeat;
    // Clear stale just-drawn highlights — startTurn won't fire for this cycle
    for (const pl of this.players) for (const t of pl.hand) t._justDrawn = false;

    if (action === 'pung') {
      const pair = p.hand.filter(t => sameType(t, tile)).slice(0, 2);
      p.hand = removeFromHandList(p.hand, pair);
      const newMeld = { type: 'pung', tiles: [tile, ...pair], claimed: true };
      if (seat === 0) p.melds.unshift(newMeld); else p.melds.push(newMeld);
      this.addLog(`${playerTag(this.players[seat])} Pung 碰 ${tileMain(tile)}`);
      this._logMove({ a: 'P', s: seat, t: [tile.suit, tile.value] });
    } else if (action === 'kong') {
      const pungIdx = p.melds.findIndex(m => m.type === 'pung' && sameType(m.tiles[0], tile));
      if (pungIdx !== -1) {
        // Upgrade existing pung meld → kong using the discard as the 4th tile
        const pungTiles = p.melds[pungIdx].tiles;
        p.melds[pungIdx] = { type: 'kong', tiles: [tile, ...pungTiles], claimed: true };
        this.addLog(`${playerTag(this.players[seat])} Kong 槓 ${tileMain(tile)} (upgraded pung)`);
      } else {
        // Standard: 3 matching in hand + discard = 4
        const three = p.hand.filter(t => sameType(t, tile)).slice(0, 3);
        p.hand = removeFromHandList(p.hand, three);
        const newMeld = { type: 'kong', tiles: [tile, ...three], claimed: true };
        if (seat === 0) p.melds.unshift(newMeld); else p.melds.push(newMeld);
        this.addLog(`${playerTag(this.players[seat])} Kong 槓 ${tileMain(tile)}`);
      }
      this._logMove({ a: 'KO', s: seat, t: [tile.suit, tile.value] });
      // Draw replacement
      const repl = this.drawFromTail()  // kong replacement from tail wall;
      if (repl) {
        this.addLog(`${playerTag(this.players[seat])} kong replacement: ${tileMain(repl)}`);
        this._addDrawnTile(p, repl); if (!this.replaceBonus(p)) return;
      } else {
        this.addLog(`${playerTag(this.players[seat])} kong replacement: wall exhausted — exhausted draw 黃牌!`);
        this.phase = PHASE.END;
        this.lastResult = { winner: -1, faan: 0, label: 'Draw', selfDraw: false, base: 0 };
        this._saveReplay();
        this.onUpdate('draw');
        return;
      }
    } else if (action === 'chow') {
      const fromHand = chowTiles ? chowTiles.filter(t => t.id !== tile.id) : findChowWith(p.hand, tile).filter(t => t !== tile);
      p.hand = removeFromHandList(p.hand, fromHand);
      const newMeld = { type: 'chow', tiles: [tile, ...fromHand], claimed: true };
      if (seat === 0) p.melds.unshift(newMeld); else p.melds.push(newMeld);
      this.addLog(`${playerTag(this.players[seat])} Chow 上 ${tileMain(tile)} [${fromHand.map(tileMain).join(' ')}]`);
      this._logMove({ a: 'C', s: seat, t: [tile.suit, tile.value], h: fromHand.map(t => [t.suit, t.value]) });
    }

    this.claimOptions = null;
    this.discard = null;
    this.phase = PHASE.DISCARD;
    this.currentSeat = seat;
    this.handActionCount++;
    this._checkHandCount(seat, 14 - 3 * p.melds.length, 'after-claim');

    if (p.isHuman) this._revealConcealedKongs(p);
    this._actForSeat(seat);
  }

  resolveWin(winnerSeat, loserSeat, result, winTile = null) {
    this.phase = PHASE.END;
    const p = this.players[winnerSeat];
    const selfDraw = loserSeat === null;
    const base = faanToPoints(capFaan(result.faan));
    this.addLog(`🏆 ${playerTag(this.players[winnerSeat])} WINS! ${result.faan} faan — ${result.label}`);

    // Save pre-win scores NOW so shareState() can compute correct deltas
    try { localStorage.setItem('mahjongPrevScores', JSON.stringify(this.players.map(p => p.score))); } catch(e) {}

    if (selfDraw) {
      // Self-draw 自摸: each of the 3 losers pays (base × 2), capped at 96 per player
      const payment = calcPayout(result.faan, true);
      for (const op of this.players) {
        if (op.seat === winnerSeat) continue;
        op.score -= payment;
        p.score += payment;
      }
    } else {
      // Discard win: loser pays all (base × 4), capped at 192 total
      const payment = calcPayout(result.faan, false);
      this.players[loserSeat].score -= payment;
      p.score += payment;
    }

    this.lastResult = {
      winner: winnerSeat,
      faan: result.faan,
      label: result.label,
      selfDraw,
      base,
      winTileId: selfDraw ? (p.hand.find(t => t._justDrawn)?.id ?? null) : ((winTile ?? this.discard)?.id ?? null),
    };

    // Check if game is over (any player below 0)
    const busted = this.players.find(pl => pl.score < 0);
    if (busted) {
      this.lastResult.gameOver = true;
      this.addLog(`💀 ${busted.name} has gone below 0 — GAME OVER!`);
    }

    this._saveReplay();
    this.onUpdate('win');
  }

  humanDeclareConcealedKong() {
    if (!this._concealedKongTiles) return;
    const p = this.players[0];
    const tiles = this._concealedKongTiles;
    const t = tiles[0];
    this._logMove({ a: 'KC', s: 0, t: [t.suit, t.value] });
    // Remove all 4 from hand
    p.hand = p.hand.filter(x => !sameType(x, t));
    // Add as concealed kong meld (concealed:true marks it)
    p.melds.unshift({ type: 'kong', tiles, concealed: true, claimed: false });
        this.handActionCount++;
    this.addLog(`${playerTag(p)} declares Concealed Kong 暗槓 ${tileMain(t)}`);
    // Draw replacement tile
    const repl = this.drawFromTail()  // kong replacement from tail wall;
    if (!repl) {
      this.addLog('Wall exhausted after Concealed Kong — exhausted draw 黃牌!');
      this.phase = PHASE.END;
      this.lastResult = { winner: -1, faan: 0, label: 'Draw', selfDraw: false, base: 0 };
      this._saveReplay();
      this.onUpdate('draw');
      return;
    }
    this.addLog(`${playerTag(p)} kong replacement: ${tileMain(repl)}`);
    this._addDrawnTile(p, repl);
    if (!this.replaceBonus(p)) return;
    this._drewLastTile = (this.wallRemaining() === 0);
        // Check win after replacement draw
    const ctx = this.makeCtx(0, true);
    if (this._drewLastTile && (typeof LAST_TILE_WIN !== 'undefined') && LAST_TILE_WIN) ctx.lastTile = true;
    const result = canWin(p.hand, p.melds, ctx);
    const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
    if (result.win && result.faan >= minF) {
      this.claimOptions = { win: result, pung: false, kong: false, chow: false };
      this.phase = PHASE.CLAIM;
      this.pendingClaims = [];
      this.onUpdate('claim-prompt');
    } else {
      this.phase = PHASE.DISCARD;
      this.onUpdate('your-turn');
    }
  }

  // When human claims a tile from another player, reveal any concealed kongs
  _revealConcealedKongs(player) {
    for (const m of player.melds) {
      if (m.type === 'kong' && m.concealed) {
        m.concealed = false; // all 4 tiles now visible
      }
    }
  }

  humanDiscard(tileId) {
    if (this.phase !== PHASE.DISCARD || this.currentSeat !== 0) return;
    const tile = this.players[0].hand.find(t => t.id === tileId);
    if (!tile) return;
    this.doDiscard(0, tile);
  }

  makeCtx(seat, selfDraw) {
    const p = this.players[seat];
    // Wind rotates with dealer: dealer=East, next=South, etc.
    const seatWind = WINDS[(seat - this.dealerSeat + 4) % 4];
    return {
      selfDraw,
      seatWind,
      roundWind: this.roundWind,
      bonusTiles: p.bonus,
      // Concealed kongs (m.concealed) don't break concealed hand status
      concealed: p.melds.every(m => !m.claimed || m.concealed),
      firstDraw: this.firstDraw,
    };
  }

  /** Helper: get the current wind title for a seat */
  getSeatWind(seat) {
    return WINDS[(seat - this.dealerSeat + 4) % 4];
  }

  shareState() {
    try {
      const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
      const maxF = (typeof MAX_FAAN !== 'undefined') ? MAX_FAAN : 0;
      const startPts = (typeof START_POINTS !== 'undefined') ? START_POINTS : 2000;
      const prevRaw = localStorage.getItem('mahjongPrevScores');
      const prevScores = prevRaw ? JSON.parse(prevRaw) : null;
      const state = {
        ts: Date.now(),
        minFaan: minF,
        maxFaan: maxF,
        startPts,
        scores: this.players.map((p, i) => {
          const prev = prevScores ? (prevScores[i] ?? p.score) : p.score;
          return {
            name: p.name,
            seat: this.getSeatWind(p.seat),
            score: p.score,
            lastDelta: p.score - prev,
          };
        }),
        lastHand: (this.lastResult && this.lastResult.winner >= 0)
          ? `${this.players[this.lastResult.winner]?.name} — ${this.lastResult.faan} faan. ${this.lastResult.label}`
          : (this.lastResult && this.lastResult.winner === -1 ? 'Draw 黃牌' : '—'),
        log: this.log,
      };
      localStorage.setItem('mahjongSharedState', JSON.stringify(state));
    } catch(e) {}
  }

  addLog(msg) {
    this.log.unshift(msg);
  }

  // Record a move for deterministic replay. Only captures during live manual play.
  _logMove(m) {
    if (!window.REPLAY_MODE && !window.AUTO_MODE) this._captureMoves.push(m);
  }

  dumpState() {
    const tileDesc = t => t ? `${t.suit}/${t.value}` : null;
    const meldDesc = m => ({
      type: m.type,
      tiles: m.tiles.map(tileDesc),
      concealed: m.concealed ?? false,
      claimed: m.claimed ?? false,
    });
    return {
      format: 'mahjong-debug',
      savedAt: new Date().toISOString(),
      version: document.getElementById('game-version-tag')?.textContent ?? '?',
      phase: this.phase,
      currentSeat: this.currentSeat,
      dealerSeat: this.dealerSeat,
      roundWind: this.roundWind,
      wallRemaining: this.wallRemaining(),
      discard: tileDesc(this.discard),
      discardSeat: this.discardSeat,
      players: this.players.map(p => ({
        seat: this.players.indexOf(p),
        name: p.name,
        isHuman: p.isHuman,
        score: p.score,
        handCount: p.hand.length,
        meldCount: p.melds.length,
        hand: p.hand.map(tileDesc),
        melds: p.melds.map(meldDesc),
        bonus: p.bonus.map(tileDesc),
      })),
      discardPile: this.discardPile.map(tileDesc),
      lastResult: this.lastResult ?? null,
      log: [...this.log].reverse(),
    };
  }

  _saveReplay() {
    if (window.REPLAY_MODE) return; // don't overwrite replay data during playback
    if (!this._captureWall || !this._captureDice) return;
    const r = this.lastResult;
    try {
      localStorage.setItem('mahjongReplay', JSON.stringify({
        format:     'mahjong-replay',
        savedAt:    new Date().toISOString(),
        winner:     r ? (r.winner >= 0 ? (this.players[r.winner]?.name ?? 'Unknown') : 'Draw') : null,
        faan:       r?.faan ?? 0,
        label:      r?.label ?? '',
        selfDraw:   r?.selfDraw ?? false,
        dealerSeat: this.dealerSeat,
        roundWind:  this.roundWind,
        logLabel:   this._logLabel ?? 'New Hand',
        players:    this.players.map(p => ({ seat: p.seat, name: p.name, isHuman: p.isHuman })),
        wall:       this._captureWall,
        dice:       this._captureDice,
        moves:      this._captureMoves,
        log:        [...this.log].reverse(),
        cpuLevels:  window.CPU_LEVELS_BY_NAME ? { ...window.CPU_LEVELS_BY_NAME } : null,
        cpuSchemes: (() => {
          if (!window.CPU_SCHEMES_BY_NAME) return null;
          const out = {};
          for (const [name, s] of Object.entries(window.CPU_SCHEMES_BY_NAME)) {
            out[name] = s ? s.id : null;
          }
          return out;
        })(),
      }));
    } catch(e) {}
  }

  applyReplayContext(data) {
    if (data.dealerSeat != null) this.dealerSeat   = data.dealerSeat;
    if (data.roundWind)          this.roundWind    = data.roundWind;
    if (data.logLabel)           this._replayLabel = data.logLabel;
    if (data.players) {
      for (const sp of data.players) {
        const p = this.players[sp.seat];
        if (p) { p.name = sp.name; p.isHuman = sp.isHuman; }
      }
    }
    // Restore CPU levels by name so AI claim/discard decisions match original game
    if (data.cpuLevels) {
      window.CPU_LEVELS_BY_NAME = { ...data.cpuLevels };
      if (typeof CPU_LEVELS !== 'undefined') {
        for (const p of this.players) {
          if (!p.isHuman && data.cpuLevels[p.name] != null)
            CPU_LEVELS[p.seat] = data.cpuLevels[p.name];
        }
      }
    }
    // Restore CPU schemes by name
    if (data.cpuSchemes && typeof SCHEMES !== 'undefined') {
      if (!window.CPU_SCHEMES_BY_NAME) window.CPU_SCHEMES_BY_NAME = {};
      if (!window.CPU_SCHEMES) window.CPU_SCHEMES = [null, null, null, null];
      for (const [name, schemeId] of Object.entries(data.cpuSchemes)) {
        const scheme = schemeId ? SCHEMES.find(s => s.id === schemeId) ?? null : null;
        window.CPU_SCHEMES_BY_NAME[name] = scheme;
      }
      for (const p of this.players) {
        if (!p.isHuman && window.CPU_SCHEMES_BY_NAME[p.name] !== undefined)
          window.CPU_SCHEMES[p.seat] = window.CPU_SCHEMES_BY_NAME[p.name];
      }
    }
    window._moveQueue = data.moves ? [...data.moves] : null;
  }

  replayStep() {
    // New-style replay: moves[] queue (saves that have a moves field)
    if (window._moveQueue) {
      const queue = window._moveQueue;
      if (!queue.length) return; // queue drained; game ends naturally via AI win detection
      const m = queue[0];
      if (m.s !== 0) return; // CPU move — aiPlay/processClaims will consume it; do nothing here
      if (m.a === 'D') {
        if (this.phase !== PHASE.DISCARD || this.currentSeat !== 0) return;
        queue.shift();
        const tile = this.players[0].hand.find(t => t.suit === m.t[0] && t.value === m.t[1]);
        if (tile) this.doDiscard(0, tile);
        else console.warn(`[replay] discard tile not in hand: ${JSON.stringify(m.t)}`);
      } else if (m.a === 'P' || m.a === 'KO' || m.a === 'W') {
        if (this.phase !== PHASE.CLAIM || !this.claimOptions) return;
        queue.shift();
        const actMap = { P: 'pung', KO: 'kong', W: 'win' };
        this.humanClaim(actMap[m.a], null);
      } else if (m.a === 'C') {
        if (this.phase !== PHASE.CLAIM || !this.claimOptions) return;
        queue.shift();
        const used = [];
        const handTiles = (m.h || []).map(([st, v]) => {
          const t = this.players[0].hand.find(h => h.suit === st && h.value === v && !used.includes(h.id));
          if (t) used.push(t.id);
          return t;
        }).filter(Boolean);
        this.humanClaim('chow', handTiles.length === 2 ? handTiles : null);
      } else if (m.a === 'KS') {
        queue.shift();
        const kong = this.findSelfKong(this.players[0]);
        if (kong) this.doSelfKong(0, kong);
      } else if (m.a === 'KC') {
        queue.shift();
        this.humanDeclareConcealedKong();
      }
    }
  }

  // Invariant: hand.length === 13 - 3*melds (waiting) or 14 - 3*melds (after draw/claim)
  _checkHandCount(seat, expected, context) {
    const p = this.players[seat];
    const bonusInHand = p.hand.filter(t => isBonus(t)).length;
    const h = p.hand.length - bonusInHand;
    if (h !== expected) {
      const extra = bonusInHand > 0 ? ` (+${bonusInHand} bonus not yet moved)` : '';
      const msg = `⚠ Hand count error [${context}]: ${p.name} has ${h} tiles${extra}, ${p.melds.length} melds — expected ${expected}`;
      console.error(msg);
      this.addLog(msg);
      this.lastValidationError = msg;
      this.onUpdate('validation-error');
    }
  }

  /**
   * Reshuffle the three CPU players into new seats.
   * The human stays at seat 0.
   * lastDealerName: name of the CPU who was last dealer (they become starting East dealer).
   * Returns the new seat arrangement as { seat: playerName } map.
   */
  rotatePlayers(lastDealerName, forcedOrder = null, forcedDealerSeat = null) {
    // Use forcedOrder if provided (from modal preview), otherwise shuffle randomly
    let newOrder;
    if (forcedOrder && forcedOrder.length === 3) {
      newOrder = forcedOrder;
    } else {
      const cpuNames = [1, 2, 3].map(s => this.players[s].name);
      const currentOrder = [1, 2, 3].map(s => this.players[s].name);
      let attempts = 0;
      do {
        newOrder = [...cpuNames];
        for (let i = newOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
        }
        attempts++;
      } while (
        attempts < 100 &&
        newOrder.every((n, i) => n === currentOrder[i])
      );
    }

    // Preserve scores
    const scoreByName = {};
    for (const p of this.players) scoreByName[p.name] = p.score;

    // Rebuild players array: seat 0 = human, seats 1-3 = shuffled CPUs
    const startPts = (typeof START_POINTS !== 'undefined') ? START_POINTS : 2000;
    this.players = [
      { seat: 0, hand: [], melds: [], bonus: [], score: scoreByName['You'] ?? startPts,
        isHuman: true, name: 'You', lastDiscard: null },
      ...newOrder.map((name, i) => ({
        seat: i + 1, hand: [], melds: [], bonus: [],
        score: scoreByName[name] ?? startPts,
        isHuman: false, name, lastDiscard: null,
      }))
    ];

    // Use explicitly passed dealerSeat if provided, otherwise derive from lastDealerName
    if (forcedDealerSeat !== null) {
      this.dealerSeat = forcedDealerSeat;
    } else {
      const lastDealerSeat = this.players.findIndex(p => p.name === lastDealerName);
      this.dealerSeat = lastDealerSeat >= 0 ? lastDealerSeat : 0;
    }

    this.roundWind  = 'East';
    this._roundStartDealer = this.dealerSeat; // first dealer of new game sets the round anchor
    this.wall       = buildWall();
    this.wallIdx    = 0;
    this.tailCol    = 71;
    this.tailPhase  = 0;
    this.discard    = null; this.discardSeat = null; this.discardPile = [];
    this.claimOptions = null; this.claimSeat = null; this.pendingClaims = [];
    this.firstDraw  = true; this.dealerFirstDiscard = false; this.handActionCount = 0; this.lastResult = null;
    this.phase      = PHASE.IDLE;
    this.deal();

    return this.players.map(p => ({ seat: p.seat, name: p.name }));
  }

  nextDeal() {
    // Block if game over
    if (this.lastResult && this.lastResult.gameOver) return;
    // Clear prev score snapshot so score.html shows fresh deltas next hand
    try { localStorage.removeItem('mahjongPrevScores'); } catch(e) {}

    // Rotate dealer (keep if dealer won)
    if (!(this.lastResult && this.lastResult.winner === this.dealerSeat)) {
      this.dealerSeat = (this.dealerSeat + 1) % 4;
      // Wind round completes when dealership returns to whoever opened this round.
      // Using _roundStartDealer (not hardcoded 0) so games starting at non-zero
      // seats (after rotatePlayers) still run full 4-player wind rounds.
      if (this.dealerSeat === this._roundStartDealer) {
        const ri = WINDS.indexOf(this.roundWind);
        const nextWind = WINDS[(ri + 1) % 4];
        // Full game complete (North round just finished) — rotate seats
        if (nextWind === 'East') {
          const winnerName = (this.lastResult?.winner >= 0)
            ? (this.players[this.lastResult.winner]?.name ?? null)
            : null;
          this.rotatePlayers(winnerName ?? this.players[this.dealerSeat].name);
          return;
        }
        this.roundWind = nextWind;
        this._roundStartDealer = this.dealerSeat; // anchor the new wind round
      }
    }
    // Preserve scores and names across deals
    const savedPlayers = this.players.map(p => ({ score: p.score, name: p.name, isHuman: p.isHuman }));
    this.wall = buildWall();
    this.wallIdx   = 0;
    this.tailCol   = 71;
    this.tailPhase = 0;
    this.players = WINDS.map((wind, i) => ({
      seat: i, wind, hand: [], melds: [], bonus: [],
      score: savedPlayers[i].score,
      name: savedPlayers[i].name,
      isHuman: savedPlayers[i].isHuman,
      lastDiscard: null,
    }));
    this.discard = null; this.discardSeat = null; this.discardPile = [];
    this.claimOptions = null; this.claimSeat = null; this.pendingClaims = [];
    this.firstDraw = true; this.dealerFirstDiscard = false; this.handActionCount = 0; this.lastResult = null;
    this.phase = PHASE.IDLE;
    this._initLog('Next Hand');
    this.deal();
  }

  redeal() {
    try { localStorage.removeItem('mahjongPrevScores'); } catch(e) {}
    const savedPlayers = this.players.map(p => ({ score: p.score, name: p.name, isHuman: p.isHuman }));
    this.wall = buildWall();
    this.wallIdx = 0;
    this.tailCol = 71;
    this.tailPhase = 0;
    this.players = WINDS.map((wind, i) => ({
      seat: i, wind, hand: [], melds: [], bonus: [],
      score: savedPlayers[i].score,
      name: savedPlayers[i].name,
      isHuman: savedPlayers[i].isHuman,
      lastDiscard: null,
    }));
    this.discard = null; this.discardSeat = null; this.discardPile = [];
    this.claimOptions = null; this.claimSeat = null; this.pendingClaims = [];
    this.robbingKongSeat = null; this.robbingKongTile = null;
    this.robbingKongTiles = null; this.robbingKongPungIdx = null;
    this.firstDraw = true; this.dealerFirstDiscard = false; this.handActionCount = 0; this.lastResult = null;
    this.lastCheckFaan = 0;
    this.phase = PHASE.IDLE;
    const label = this._replayLabel ?? 'New Hand';
    this._replayLabel = null;
    this._initLog(label);
    this.deal();
  }

  _initLog(label) {
    this._logLabel = label;
    const ver = (typeof document !== 'undefined' && document.getElementById('game-version-tag')?.textContent) || '?';
    this.log = [];
    this.log.push(`=== ${label}: Seat ${this.dealerSeat} dealer, ${this.roundWind} round ===`);
    this.log.push(ver);
    if (typeof window !== 'undefined') {
      const LVL = ['', 'Bgn', 'Int', 'Exp', 'Mst'];
      const parts = [...this.players].sort((a, b) => a.seat - b.seat).map(p => {
        let lvlIdx, sc;
        if (p.isHuman) {
          lvlIdx = window.AUTO_USER_LEVEL ?? 1;
          sc = (typeof USER_SCHEME !== 'undefined') ? USER_SCHEME : null;
        } else {
          lvlIdx = window.CPU_LEVELS_BY_NAME?.[p.name] ?? 1;
          sc = window.CPU_SCHEMES_BY_NAME?.[p.name] ?? null;
        }
        const lvl = LVL[lvlIdx] ?? `L${lvlIdx}`;
        const strategy = sc ? `${lvl}[${sc.name}]` : lvl;
        return `S${p.seat}:${p.name}(${strategy})`;
      });
      this.log.push(`⚙ ${parts.join(' · ')}`);
    }
  }
}
