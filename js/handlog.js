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

function _hlStrategy(game) {
  return ['You','CPU1','CPU2','CPU3'].map(name => {
    const isHuman = name === 'You';
    const level   = isHuman ? 'Human'
      : (_HL_LEVEL[window.CPU_LEVELS_BY_NAME?.[name] ?? 1] ?? 'Beginner');
    const sobj    = isHuman
      ? (typeof USER_SCHEME !== 'undefined' ? USER_SCHEME : null)
      : (window.CPU_SCHEMES_BY_NAME?.[name] ?? null);
    return { name, level, scheme: sobj?.name ?? null };
  });
}

function _hlSame(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p.name === b[i].name && p.level === b[i].level && p.scheme === b[i].scheme);
}

window.handLog = {
  checkStrategyChange(game) {
    const cur = _hlStrategy(game);
    const log = _hlRead();
    let last = null;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].type === 'strategy') { last = log[i].players; break; }
    }
    if (!_hlSame(last, cur)) {
      log.push({ type: 'strategy', ts: Date.now(), players: cur });
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

    log.push({ type: 'hand', handNum, winner, faan: r.faan, label: isDraw ? '' : (r.label ?? ''), deltas, scores });
    _hlWrite(log);
  },

  clear(game) {
    _hlWrite([{ type: 'strategy', ts: Date.now(), players: _hlStrategy(game) }]);
  },

  open() {
    const w = window.open('hand.html', 'hand-log', 'width=1100,height=720,resizable=yes');
    if (w) w.focus();
  },
};
