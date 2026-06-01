// ============================================================
// handlog.js — persistent hand-by-hand log written to hand.html
// ============================================================

const _HL_KEY   = 'mahjong-hand-log';
const _HL_LEVEL = ['', 'Beginner', 'Inter', 'Expert', 'Master'];

function _hlRead() {
  try { const r = localStorage.getItem(_HL_KEY); return r ? JSON.parse(r) : []; }
  catch(e) { return []; }
}

function _hlWrite(log) {
  try { localStorage.setItem(_HL_KEY, JSON.stringify(log)); } catch(e) {}
}

function _hlModeLabel(mode) {
  if (!mode) return 'HUMAN';
  if (mode === 'slow')         return 'AUTO-SLOW';
  if (mode === 'fast')         return 'AUTO-FAST';
  if (mode === 'sprint')       return 'SPRINT';
  if (mode === 'sprint_slow')  return 'SPRINT-SL';
  return String(mode).toUpperCase();
}

function _hlStrategyState(game) {
  const autoMode = window.AUTO_MODE ?? null;
  const players = ['You','CPU1','CPU2','CPU3'].map(name => {
    const isHuman = name === 'You';
    let level;
    if (isHuman) {
      // In AUTO/SPRINT mode the You seat uses an AI level; in HUMAN mode it's human-played.
      level = autoMode
        ? (_HL_LEVEL[window.AUTO_USER_LEVEL ?? 1] ?? 'Beginner')
        : 'Human';
    } else {
      level = _HL_LEVEL[window.CPU_LEVELS_BY_NAME?.[name] ?? 1] ?? 'Beginner';
    }
    const sobj = isHuman
      ? (typeof USER_SCHEME !== 'undefined' ? USER_SCHEME : null)
      : (window.CPU_SCHEMES_BY_NAME?.[name] ?? null);
    return { name, level, scheme: sobj?.name ?? null };
  });

  // seats[i] = name of player currently sitting at seat i
  const seats = game?.players ? game.players.map(p => p.name) : ['You','CPU1','CPU2','CPU3'];

  return { players, mode: autoMode, seats };
}

function _hlSame(a, b) {
  if (!a || !b) return false;
  if (a.mode !== b.mode) return false;
  if (!a.players || !b.players || a.players.length !== b.players.length) return false;
  // Only compare seats when both entries have them (backward compat with old log entries)
  if (a.seats && b.seats && a.seats.join(',') !== b.seats.join(',')) return false;
  return a.players.every((p, i) =>
    p.name === b.players[i].name && p.level === b.players[i].level && p.scheme === b.players[i].scheme
  );
}

window.handLog = {
  checkStrategyChange(game) {
    const cur = _hlStrategyState(game);
    const log = _hlRead();
    let last = null;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].type === 'strategy') {
        last = { players: log[i].players, mode: log[i].mode ?? null, seats: log[i].seats ?? null };
        break;
      }
    }
    if (!_hlSame(last, cur)) {
      log.push({ type: 'strategy', ts: Date.now(), players: cur.players, mode: cur.mode, seats: cur.seats });
      _hlWrite(log);
    }
  },

  recordHand(game) {
    if (!game?.lastResult) return;
    this.checkStrategyChange(game); // ensure strategy header exists

    const r      = game.lastResult;
    const isDraw = r.winner === -1;
    const winner = isDraw ? 'Draw' : (game.players[r.winner]?.name ?? 'Unknown');
    const deltas = {}, scores = {};

    if (!isDraw) {
      try {
        const prev = JSON.parse(localStorage.getItem('mahjongPrevScores') ?? 'null');
        for (const p of game.players) {
          deltas[p.name] = p.score - (prev ? (prev[p.seat] ?? p.score) : p.score);
          scores[p.name] = p.score;
        }
      } catch(e) {
        for (const p of game.players) { deltas[p.name] = 0; scores[p.name] = p.score; }
      }
    } else {
      for (const p of game.players) { deltas[p.name] = 0; scores[p.name] = p.score; }
    }

    // seatOrder[i] = name of player at seat i when this hand was played
    const seatOrder = game.players.map(p => p.name);

    const log = _hlRead();

    // Hand number: count hand entries since last strategy entry
    let handNum = 1;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].type === 'strategy') {
        handNum = log.slice(i + 1).filter(e => e.type === 'hand').length + 1;
        break;
      }
      if (i === 0) handNum = log.filter(e => e.type === 'hand').length + 1;
    }
    if (log.length === 0) handNum = 1;

    log.push({ type: 'hand', handNum, winner, faan: r.faan, label: isDraw ? '' : (r.label ?? ''), deltas, scores, seatOrder });
    _hlWrite(log);
  },

  clear(game) {
    const state = _hlStrategyState(game);
    _hlWrite([{ type: 'strategy', ts: Date.now(), players: state.players, mode: state.mode, seats: state.seats }]);
  },

  open() {
    const w = window.open('hand.html', 'hand-log', 'width=1100,height=720,resizable=yes');
    if (w) w.focus();
  },
};
