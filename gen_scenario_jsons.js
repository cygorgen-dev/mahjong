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

function buildWall(desired, dealerSeat, diceTotal, wallSlots = {}) {
  const { headIdx, origPos } = computeDealPositions(dealerSeat, diceTotal);
  const wall = new Array(144).fill(null);

  // Validate copy counts before placing (deal + draw-position slots)
  const MAX = { bamboo:4, circle:4, char:4, wind:4, dragon:4, flower:1, season:1 };
  const counts = {};
  const allDesired = [...Object.values(desired).flat(), ...Object.values(wallSlots)];
  for (const t of allDesired) {
    const k = `${t.suit}|${t.value}`;
    counts[k] = (counts[k]||0) + 1;
    if (counts[k] > MAX[t.suit]) throw new Error(`Too many copies of ${k}: ${counts[k]}`);
  }

  // Place desired tiles at their deal positions
  for (const [s, tiles] of Object.entries(desired)) {
    const pos = origPos[+s];
    for (let i = 0; i < tiles.length && i < pos.length; i++)
      wall[pos[i]] = {suit: tiles[i].suit, value: tiles[i].value};
  }

  // Place wallSlots tiles at specific rotated draw positions
  // wallSlots keys are rotated-wall indices (0=first deal tile, 53+=draw pile).
  for (const [rotPos, tile] of Object.entries(wallSlots)) {
    const origIdx = (parseInt(rotPos) + headIdx) % 144;
    if (wall[origIdx] !== null) throw new Error(`wallSlots conflict at rotated pos ${rotPos} (orig ${origIdx})`);
    wall[origIdx] = {suit: tile.suit, value: tile.value};
  }

  // Fill remaining slots from the full pool (minus already-placed tiles)
  const pool      = makeFullTilePool();
  const allUsed   = allDesired;
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

function writeScenario({ filename, label, dealerSeat=0, roundWind='East', diceTotal=6, desired, wallSlots={}, moves, winnerSeat }) {
  const d1 = Math.floor(diceTotal/3), d2 = Math.floor(diceTotal/3), d3 = diceTotal-d1-d2;
  const wall = buildWall(desired, dealerSeat, diceTotal, wallSlots);
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

// B3 — CPU2 wins All Triplets (碰碰胡) on human's Green Dragon discard
//       CPU1 (diff=1) cannot win on 發; CPU2 (diff=2) is tenpai; CPU3 cannot win
writeScenario({
  filename:   'scenario_win_cpu2_all_triplets_discard.json',
  label:      'CPU2 wins All Triplets — human discards Green Dragon',
  winnerSeat: 2,
  desired: {
    // Seat 0 (dealer, 14 tiles): three bamboo chows + K(1-3) + Green Dragon to discard
    0: [
      B(1),B(2),B(3),
      B(4),B(5),B(6),
      B(7),B(8),B(9),
      K(1),K(2),K(3),
      D('green'),          // 13th tile — will be discarded; 14th slot gets filler
    ],
    // CPU1 (13 tiles): scattered circles + chars + honours; cannot win on Green Dragon
    1: [C(4),C(5),C(6),C(7),C(8),C(9), K(5),K(7),K(9), W('East'),W('South'),D('red'),D('white')],
    // CPU2 (13 tiles): All-Triplets tenpai, waiting for Green Dragon pair
    //   West Wind pung = seat wind for seat 2 → All Triplets(3f) + West(1f) = 4f
    2: [
      B(3),B(3),B(3),               // pung
      C(7),C(7),C(7),               // pung
      K(2),K(2),K(2),               // pung
      W('West'),W('West'),W('West'), // pung — seat wind for seat 2
      D('green'),                    // lone — needs pair (completes on discard)
    ],
    // CPU3 (13 tiles): scattered; cannot win on Green Dragon
    3: [B(1),B(2), C(1),C(2),C(3), K(4),K(6),K(8), W('West'),W('East'),W('South'), D('red'),D('white')],
  },
  moves: [
    {a:'D', s:0, t:['dragon','green']},
    {a:'W', s:2, t:['dragon','green']},
  ],
});

// ═════════════════════════════════════════════════════════════════════════════
// BATCH 3 — Rob Kong (搶槓胡)
//
// CPU1 claims a pung of bamboo-4 on seat-0's first discard.
// CPU1 later draws the 4th bamboo-4 (placed at wall position 56, which is CPU1's
// first draw after a 3-player gap: CPU2→CPU3→seat-0→CPU1).
// CPU1 declares self-kong (pung upgrade) → CPU3 robs → wins All Triplets.
//
// Wall position 56 (rotated) = original position 32 for dice=6, dealer=0.
// Deal positions use originals 120–143 and 0–28; position 32 is in draw pile. ✓
//
// Requires game.js fix: replayStep CLAIM phase detects robbingKongSeat and
// routes through humanPass() rather than resolveAIClaims(…, null, …).
// ═════════════════════════════════════════════════════════════════════════════

// C1 — CPU3 robs CPU1's bamboo-3 kong → wins Mixed One Suit (搶槓胡)
//
// Kong tile is bamboo-3 (B3). Tile count: seat0(1) + CPU1(2) + wallSlots(1) = 4. ✓
// CPU3 holds 0 copies of B3 and is tenpai for it via chow completion (B1,B2 → needs B3).
// CPU1 discards Green Dragon after pung (D.green chosen so nobody can claim it).
// W('East') stays in CPU1's hand — avoids CPU3 konging East Wind from a discard.
writeScenario({
  filename:   'scenario_win_cpu3_rob_kong.json',
  label:      'CPU3 robs CPU1\'s kong — wins Mixed One Suit (搶槓胡)',
  winnerSeat: 3,
  desired: {
    // Seat 0 (dealer, 14 tiles): runs + B3 as first discard
    0: [
      B(3),B(5),B(6),B(7),
      C(4),C(5),C(6),
      K(1),K(2),K(3),
      W('South'),W('West'),D('white'),D('red'),
    ],
    // CPU1 (13 tiles): B3×2 for pung, D('green') to discard after pung, rest scattered
    //   W('East') kept in hand so CPU3 cannot kong it from any discard
    1: [
      B(3),B(3),                                           // will form pung with seat-0's discard
      D('green'),                                           // discarded after pung (controlled)
      W('East'),C(1),C(3),C(9),K(4),K(6),K(8),K(9),B(8),W('South'),
    ],
    // CPU2 (13 tiles): scattered; cannot win on bamboo-3; no W('East') to avoid CPU3 konging it
    2: [K(2),K(3),K(5),K(7), W('South'),W('West'),W('North'), D('white'),D('red'),D('green'),C(5),C(7),C(8)],
    // CPU3 (13 tiles): Mixed Bamboo Suit tenpai, waiting for bamboo-3 to complete chow
    //   B4-6 chow + B7-9 chow + W.East×3 pung (round wind 1f) + W.North pair + B1,B2 partial
    //   Robs B3 → B1-2-3 chow + B4-6 + B7-9 + W.East pung + W.North pair
    //   = Mixed Bamboo Suit (3f) + East round wind (1f) = 4f
    3: [
      B(1),B(2),                                           // partial chow, needs B3 (0 copies = safe)
      B(4),B(5),B(6),                                      // chow
      B(7),B(8),B(9),                                      // chow
      W('East'),W('East'),W('East'),                        // pung — round wind
      W('North'),W('North'),                                // pair
    ],
  },
  // wallSlots:
  //   56 = B3 (4th copy) — CPU1's draw after pung sequence
  //   54 = D.white — CPU3's draw: an isolated tile CPU3 always discards,
  //        preventing the AI from accidentally breaking B3 tenpai by discarding B2
  //        after drawing a 2nd B1 (which the pool would otherwise place at pos 54)
  //   136-143 = C2×4, K5×3, K6 — dead-wall area: prevents bonus-tile cascade
  //        (pool fill places flower/season tiles at these positions by default;
  //        if _completeKong ever fires before the rob, CPU1 would draw 8 bonus tiles)
  wallSlots: {
    56: B(3),
    54: D('white'),
    136: C(2), 137: C(2), 138: C(2), 139: C(2),
    140: K(5), 141: K(5), 142: K(5), 143: K(6),
  },
  moves: [
    {a:'D', s:0, t:['bamboo',3]},      // seat 0 discards bamboo-3
    {a:'P', s:1, t:['bamboo',3]},      // CPU1 claims pung → B3×3 in meld
    {a:'D', s:1, t:['dragon','green']}, // CPU1 discards Green Dragon (nobody can pung it)
    // CPU2 draws pos53 → AI discards (scattered, no claim possible)
    // CPU3 draws pos54 → AI discards drawn tile (can't win without B3, no B3 in pool)
    // seat0 draws pos55 → AI discards honor tile (keeps B5-7, C4-6, K1-3 chows)
    // CPU1 draws pos56 = B3 → findSelfKong detects pung-upgrade → doSelfKong(1)
    //   → replayStep CLAIM: robbingKongSeat≠null → humanPass() → CPU3 robs → wins
  ],
});

console.log('\nAll done.');
