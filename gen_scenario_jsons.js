// gen_scenario_jsons.js — generate organised scenario JSONs for scenario_run.js
//
// Each batch adds new files; existing ones are overwritten on re-run.
// Run:  node gen_scenario_jsons.js
//
// Naming: scenario_win_*.json  (picked up by defaultFiles() in scenario_run.js)
//
// Architecture:
//   Type A — seat-0 dealer self-draw:  14 complete tiles dealt to seat 0, {a:'W',s:0}.
//             The REPLAY_MODE branch of aiPlay() calls resolveWin() directly, bypassing
//             the _justDrawn check, so these are 100% deterministic.
//   Type B — CPU wins on seat-0 discard: seat-0 discards via {a:'D',s:0}, the target
//             CPU holds a tenpai hand; it wins naturally through resolveAIClaims().
//             CPU1/2 hands are explicit to prevent accidental hijacking.

'use strict';
const fs   = require('fs');
const path = require('path');

// ── wall-building logic (ported verbatim from scenario.html) ──────────────────

function makeFullTilePool() {
  const pool = [];
  for (const s of ['bamboo','circle','char'])
    for (let v = 1; v <= 9; v++)
      for (let c = 0; c < 4; c++) pool.push({suit:s, value:v});
  for (const w of ['East','South','West','North'])
    for (let c = 0; c < 4; c++) pool.push({suit:'wind', value:w});
  for (const d of ['red','green','white'])
    for (let c = 0; c < 4; c++) pool.push({suit:'dragon', value:d});
  for (let i = 0; i < 4; i++) pool.push({suit:'flower', value:i});
  for (let i = 0; i < 4; i++) pool.push({suit:'season', value:i});
  return pool; // 144 tiles
}

function computeDealPositions(dealerSeat, diceTotal) {
  const ccwOrder  = [0, 3, 2, 1];
  const breakSeat = (dealerSeat + (diceTotal - 1) % 4) % 4;
  const segIdx    = ccwOrder.indexOf(breakSeat);
  const headIdx   = (segIdx * 36 + 2 * diceTotal) % 144;
  const ccwSeats  = [0,1,2,3].map(i => (dealerSeat + i) % 4);
  const rotPos    = {0:[],1:[],2:[],3:[]};
  let idx = 0;
  for (let r = 0; r < 3; r++) for (const s of ccwSeats) for (let t = 0; t < 4; t++) rotPos[s].push(idx++);
  for (const s of ccwSeats) rotPos[s].push(idx++);
  rotPos[dealerSeat].push(idx++); // dealer's extra 14th tile
  const origPos = {};
  for (const s of [0,1,2,3]) origPos[s] = rotPos[s].map(p => (p + headIdx) % 144);
  return { headIdx, origPos };
}

function buildWall(desired, dealerSeat, diceTotal) {
  const { headIdx, origPos } = computeDealPositions(dealerSeat, diceTotal);
  const wall = new Array(144).fill(null);

  // Validate copy counts before placing
  const MAX = { bamboo:4, circle:4, char:4, wind:4, dragon:4, flower:1, season:1 };
  const counts = {};
  for (const tiles of Object.values(desired)) {
    for (const t of tiles) {
      const k = `${t.suit}|${t.value}`;
      counts[k] = (counts[k]||0) + 1;
      if (counts[k] > MAX[t.suit]) throw new Error(`Too many copies of ${k}: ${counts[k]}`);
    }
  }

  // Place desired tiles at their deal positions
  for (const [s, tiles] of Object.entries(desired)) {
    const pos = origPos[+s];
    for (let i = 0; i < tiles.length && i < pos.length; i++)
      wall[pos[i]] = {suit: tiles[i].suit, value: tiles[i].value};
  }

  // Fill remaining slots from the full pool (minus already-placed tiles)
  const pool      = makeFullTilePool();
  const allUsed   = Object.values(desired).flat();
  const remaining = [...pool];
  for (const used of allUsed) {
    const i = remaining.findIndex(t => t.suit===used.suit && String(t.value)===String(used.value));
    if (i >= 0) remaining.splice(i, 1);
  }
  let fi = 0;
  for (let i = 0; i < 144; i++) { if (wall[i]===null) wall[i] = remaining[fi++]; }

  // Rotate so index 0 = first drawn tile (matches saved-game format)
  return [...wall.slice(headIdx), ...wall.slice(0, headIdx)];
}

function writeScenario({ filename, label, dealerSeat=0, roundWind='East', diceTotal=6, desired, moves, winnerSeat }) {
  const d1 = Math.floor(diceTotal/3), d2 = Math.floor(diceTotal/3), d3 = diceTotal-d1-d2;
  const wall = buildWall(desired, dealerSeat, diceTotal);
  const json = {
    format:   'mahjong-replay',
    scenario: true,
    savedAt:  new Date().toISOString(),
    winner:   null,
    faan:     0,
    label,
    dealerSeat,
    roundWind,
    players: [
      {seat:0, name:'You',  isHuman:true},
      {seat:1, name:'CPU1', isHuman:false},
      {seat:2, name:'CPU2', isHuman:false},
      {seat:3, name:'CPU3', isHuman:false},
    ],
    wall,
    dice:     [d1, d2, d3],
    moves,
    expected: { winnerSeat, note: label },
  };
  const fp = path.join(__dirname, filename);
  fs.writeFileSync(fp, JSON.stringify(json, null, 2));
  console.log(`  wrote  ${filename}`);
}

// ── tile shorthands ───────────────────────────────────────────────────────────
const B = v => ({suit:'bamboo', value:v});
const C = v => ({suit:'circle', value:v});
const K = v => ({suit:'char',   value:v});
const W = v => ({suit:'wind',   value:v});
const D = v => ({suit:'dragon', value:v});

// ═════════════════════════════════════════════════════════════════════════════
// BATCH 1 — seat-0 dealer self-draw wins
//
// Seat 0 is dealer (gets 14 deal slots). Providing ≤14 tiles fills those slots;
// any remaining slots get filler from the pool.  Move {a:'W',s:0} triggers
// aiPlay(0) which in REPLAY_MODE calls resolveWin() directly — no _justDrawn
// required, so these are fully deterministic regardless of filler tiles.
// ═════════════════════════════════════════════════════════════════════════════

// A1 — Common Hand (平胡): four chows + pair, no bonus tiles, no pungs
writeScenario({
  filename:   'scenario_win_you_common_hand.json',
  label:      'You win — Common Hand dealer self-draw',
  winnerSeat: 0,
  desired: { 0: [
    B(1),B(2),B(3),   // chow
    B(4),B(5),B(6),   // chow
    B(7),B(8),B(9),   // chow
    C(1),C(2),C(3),   // chow
    K(5),K(5),         // pair — completes Common Hand
  ]},
  moves: [{a:'W', s:0}],
});

// A2 — All Triplets (碰碰胡): four pungs + pair, no sequences
writeScenario({
  filename:   'scenario_win_you_all_triplets.json',
  label:      'You win — All Triplets dealer self-draw',
  winnerSeat: 0,
  desired: { 0: [
    B(1),B(1),B(1),               // pung
    C(5),C(5),C(5),               // pung
    K(9),K(9),K(9),               // pung
    W('East'),W('East'),W('East'), // pung — round wind (1f)
    D('white'),D('white'),         // pair
  ]},
  moves: [{a:'W', s:0}],
});

// A3 — Mixed One Suit (混一色): one suit (char) + honour tiles only
writeScenario({
  filename:   'scenario_win_you_mixed_suit.json',
  label:      'You win — Mixed One Suit (char+winds) dealer self-draw',
  winnerSeat: 0,
  desired: { 0: [
    K(1),K(2),K(3),               // chow
    K(4),K(5),K(6),               // chow
    K(7),K(8),K(9),               // chow
    W('East'),W('East'),W('East'), // pung — round wind (1f)
    W('South'),W('South'),         // pair
  ]},
  moves: [{a:'W', s:0}],
});

// A4 — Pure Suit (清一色): all bamboo, no honour tiles
writeScenario({
  filename:   'scenario_win_you_pure_suit.json',
  label:      'You win — Pure Bamboo Suit dealer self-draw',
  winnerSeat: 0,
  desired: { 0: [
    B(1),B(1),B(1),   // pung
    B(2),B(3),B(4),   // chow
    B(5),B(5),B(5),   // pung
    B(6),B(7),B(8),   // chow
    B(9),B(9),         // pair
  ]},
  moves: [{a:'W', s:0}],
});

// ═════════════════════════════════════════════════════════════════════════════
// BATCH 2 — CPU wins on seat-0's discard
//
// Seat 0 is dealer (14 tiles).  The D move discards one specific tile.
// The winning CPU holds a 13-tile tenpai hand that completes on that tile.
// All four hands are explicit so no CPU accidentally hijacks.
//
// Proximity from seat 0 (discarder): CPU1=diff1, CPU2=diff2, CPU3=diff3.
// Winning CPU is the only one with a valid claim → no hijack possible.
// ═════════════════════════════════════════════════════════════════════════════

// B1 — CPU1 wins All Triplets (碰碰胡) on human's White Dragon discard
//       CPU1 is closest (diff=1) and the only one that can win on 白
writeScenario({
  filename:   'scenario_win_cpu1_all_triplets_discard.json',
  label:      'CPU1 wins All Triplets — human discards White Dragon',
  winnerSeat: 1,
  desired: {
    // Seat 0 (dealer, 13+1 tiles): four chows + White Dragon to discard
    0: [
      C(1),C(2),C(3),
      C(4),C(5),C(6),
      C(7),C(8),C(9),
      K(1),K(2),K(3),
      D('white'),          // 13th tile — will be discarded; 14th slot gets filler
    ],
    // CPU1 (13 tiles): All-Triplets tenpai, waiting for White Dragon pair
    1: [
      B(2),B(2),B(2),               // pung
      B(4),B(4),B(4),               // pung
      B(6),B(6),B(6),               // pung
      W('East'),W('East'),W('East'), // pung — round wind (1f)
      D('white'),                    // lone — needs pair → All Triplets (3f)+East(1f)
    ],
    // CPU2, CPU3 — scattered tiles; cannot win on White Dragon
    2: [B(1),B(3),B(5),B(7),B(9), K(4),K(5),K(6),K(7),K(8),K(9), W('South'),W('West')],
    3: [B(8),C(1),C(3),C(5),C(7),C(9), K(4),K(6),K(8), W('North'),D('green'),D('red'),W('South')],
  },
  moves: [
    {a:'D', s:0, t:['dragon','white']},
    {a:'W', s:1, t:['dragon','white']},
  ],
});

// B2 — CPU3 wins Mixed One Suit (混一色) on human's South Wind discard
//       CPU1 and CPU2 cannot form a winning hand + South Wind; CPU3 is tenpai
writeScenario({
  filename:   'scenario_win_cpu3_mixed_suit_discard.json',
  label:      'CPU3 wins Mixed One Suit — human discards South Wind',
  winnerSeat: 3,
  desired: {
    // Seat 0 (dealer, 14 tiles): bamboo run + even circles + South to discard
    0: [
      B(1),B(2),B(3),
      B(4),B(5),B(6),
      B(7),B(8),B(9),
      C(2),C(4),C(6),C(8),
      W('South'),          // will be discarded
    ],
    // CPU1 (13 tiles): isolated tiles from odd circles + odd chars + honours
    1: [C(1),C(3),C(5),C(7),C(9), K(1),K(3),K(5),K(7),K(9), W('West'),D('green'),D('red')],
    // CPU2 (13 tiles): isolated tiles — even bamboo + even chars + mixed honours
    2: [B(2),B(4),B(6),B(8), K(2),K(4),K(6),K(8), W('North'),W('East'),D('white'),D('red'),D('green')],
    // CPU3 (seat 3, 13 tiles): Mixed Char Suit tenpai, waiting for South Wind pair
    //   K1-K9 three chows + East pung (round wind 1f) + lone South = Mixed One Suit (3f)+East(1f)=4f
    3: [
      K(1),K(2),K(3),               // chow
      K(4),K(5),K(6),               // chow
      K(7),K(8),K(9),               // chow
      W('East'),W('East'),W('East'), // pung — round wind
      W('South'),                    // lone — needs pair (completes on discard)
    ],
  },
  moves: [
    {a:'D', s:0, t:['wind','South']},
    {a:'W', s:3, t:['wind','South']},
  ],
});

console.log('\nAll done.');
