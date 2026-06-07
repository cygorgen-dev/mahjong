// gen_scenario_hijack.js
// Builds a wall where:
//   S0 (human dealer) holds 一-九萬 + 一-四竹 + 中  → discards 中 first
//   S1 holds 一萬×3 四萬×3 七萬×3 一餅×3 + 中  → wins on 中 (diff=1, closest)
//   S2 holds 二萬×3 五萬×3 八萬×3 二餅×3 + 中  → wants to win (diff=2)
//   S3 holds 三萬×3 六萬×3 九萬×3 三餅×3 + 中  → wants to win (diff=3)
// Expected result: S1 wins (closest counter-clockwise); S2 and S3 are hijacked.
//
// Hand type for S1/S2/S3: All-Pungs 碰碰胡 (3 faan) — satisfies MIN_FAAN=3.

const fs = require('fs');

// ── Tile helpers ─────────────────────────────────────────────────────────────
const mk = (suit, value) => ({ suit, value });

// Full 144-tile set with enough copies
function makePool() {
  const pool = [];
  for (const suit of ['bamboo','circle','char'])
    for (let v = 1; v <= 9; v++)
      for (let c = 0; c < 4; c++) pool.push(mk(suit, v));
  for (const w of ['East','South','West','North'])
    for (let c = 0; c < 4; c++) pool.push(mk('wind', w));
  for (const d of ['red','green','white'])
    for (let c = 0; c < 4; c++) pool.push(mk('dragon', d));
  for (let i = 0; i < 4; i++) pool.push(mk('flower', i));
  for (let i = 0; i < 4; i++) pool.push(mk('season', i));
  return pool;
}

// ── Deal position math ────────────────────────────────────────────────────────
// From game.js deal():
//   ccwOrder = [0,3,2,1]  (wall segment index → seat)
//   breakSeat = (dealerSeat + (diceTotal-1)%4) % 4
//   segIdx    = ccwOrder.indexOf(breakSeat)
//   headIdx   = (segIdx*36 + 2*diceTotal) % 144
//   rotated wall[0] = original wall[headIdx]
//
// Deal order: ccwSeats = [d, d+1, d+2, d+3]
//   3 rounds × 4 tiles, then 1 tile each, then dealer extra

function computeDealPositions(dealerSeat, diceTotal) {
  const ccwOrder = [0, 3, 2, 1];
  const breakSeat = (dealerSeat + (diceTotal - 1) % 4) % 4;
  const segIdx    = ccwOrder.indexOf(breakSeat);
  const headIdx   = (segIdx * 36 + 2 * diceTotal) % 144;

  const ccwSeats = [0,1,2,3].map(i => (dealerSeat + i) % 4);
  const rotPos = { 0:[], 1:[], 2:[], 3:[] };
  let idx = 0;
  for (let r = 0; r < 3; r++)
    for (const s of ccwSeats)
      for (let t = 0; t < 4; t++) rotPos[s].push(idx++);
  for (const s of ccwSeats) rotPos[s].push(idx++);   // 1 tile each
  rotPos[dealerSeat].push(idx++);                      // dealer extra

  // Convert rotated → original wall positions
  const origPos = {};
  for (const s of [0,1,2,3])
    origPos[s] = rotPos[s].map(p => (p + headIdx) % 144);

  return { headIdx, origPos };
}

// ── Desired hands ─────────────────────────────────────────────────────────────
// 中 = dragon red
const zhong = mk('dragon','red');

const dealerSeat = 0;
const dice = [2, 2, 2];   // total = 6
const diceTotal = dice.reduce((a,b)=>a+b, 0);

// S0 (human dealer, 14 tiles): nine-gate + 一-四竹 + 中 (extra tile to discard)
const hand0 = [
  mk('char',1), mk('char',2), mk('char',3), mk('char',4),
  mk('char',5), mk('char',6), mk('char',7), mk('char',8),
  mk('char',9), mk('bamboo',1), mk('bamboo',2), mk('bamboo',3),
  mk('bamboo',4), zhong,
];
// S1 (13 tiles, wins on 中): char 1×3, 4×3, 7×3, circle 1×3 + 中
const hand1 = [
  mk('char',1), mk('char',1), mk('char',1),
  mk('char',4), mk('char',4), mk('char',4),
  mk('char',7), mk('char',7), mk('char',7),
  mk('circle',1), mk('circle',1), mk('circle',1),
  zhong,
];
// S2 (13 tiles, wins on 中): char 2×3, 5×3, 8×3, circle 2×3 + 中
const hand2 = [
  mk('char',2), mk('char',2), mk('char',2),
  mk('char',5), mk('char',5), mk('char',5),
  mk('char',8), mk('char',8), mk('char',8),
  mk('circle',2), mk('circle',2), mk('circle',2),
  zhong,
];
// S3 (13 tiles, wins on 中): char 3×3, 6×3, 9×3, circle 3×3 + 中
const hand3 = [
  mk('char',3), mk('char',3), mk('char',3),
  mk('char',6), mk('char',6), mk('char',6),
  mk('char',9), mk('char',9), mk('char',9),
  mk('circle',3), mk('circle',3), mk('circle',3),
  zhong,
];

const desired = { 0: hand0, 1: hand1, 2: hand2, 3: hand3 };

// Verify tile counts
function tileKey(t) { return `${t.suit}|${t.value}`; }
const usedCounts = {};
for (const h of Object.values(desired))
  for (const t of h) usedCounts[tileKey(t)] = (usedCounts[tileKey(t)]||0)+1;

const maxCopies = { bamboo:4,circle:4,char:4,wind:4,dragon:4,flower:1,season:1 };
let ok = true;
for (const [k, cnt] of Object.entries(usedCounts)) {
  const suit = k.split('|')[0];
  if (cnt > maxCopies[suit]) { console.error(`OVER: ${k} used ${cnt} > ${maxCopies[suit]}`); ok=false; }
}
if (ok) console.log('✓ Tile counts valid');

// ── Build wall ────────────────────────────────────────────────────────────────
const { headIdx, origPos } = computeDealPositions(dealerSeat, diceTotal);
console.log(`headIdx=${headIdx}, breakSeat=${(dealerSeat+(diceTotal-1)%4)%4}`);
for (const s of [0,1,2,3])
  console.log(`  S${s} gets ${desired[s].length} tiles at orig positions [${origPos[s]}]`);

// Build wall as 144-slot array, fill with null first
const wall = new Array(144).fill(null);

// Place desired tiles at computed positions
for (const s of [0,1,2,3]) {
  const positions = origPos[s];
  const tiles     = desired[s];
  for (let i = 0; i < tiles.length; i++) wall[positions[i]] = tiles[i];
}

// Fill remaining slots with unused tiles from pool
const pool = makePool();
const usedTiles = Object.values(desired).flat();
// Remove used tiles from pool (order-independent matching)
const remaining = [...pool];
for (const used of usedTiles) {
  const idx2 = remaining.findIndex(t => t.suit===used.suit && t.value===used.value);
  if (idx2 >= 0) remaining.splice(idx2, 1);
  else { console.error('Pool underflow:', used); ok=false; }
}
console.log(`Remaining filler tiles: ${remaining.length} (expect 91)`);

let fillIdx = 0;
for (let i = 0; i < 144; i++) {
  if (wall[i] === null) {
    wall[i] = remaining[fillIdx++];
  }
}
if (fillIdx !== remaining.length) console.error('Fill mismatch');
else console.log('✓ Wall filled');

// ── Verify deal ───────────────────────────────────────────────────────────────
// Simulate the deal to confirm each player gets the right tiles
const rotWall = [...wall.slice(headIdx), ...wall.slice(0, headIdx)];
const dealt = { 0:[], 1:[], 2:[], 3:[] };
const ccwSeats = [0,1,2,3].map(i=>(dealerSeat+i)%4);
let wi = 0;
for (let r=0;r<3;r++) for (const s of ccwSeats) for (let t=0;t<4;t++) dealt[s].push(rotWall[wi++]);
for (const s of ccwSeats) dealt[s].push(rotWall[wi++]);
dealt[dealerSeat].push(rotWall[wi++]);

// Compare
let match = true;
for (const s of [0,1,2,3]) {
  for (let i=0;i<desired[s].length;i++) {
    const d=dealt[s][i], want=desired[s][i];
    if (d.suit!==want.suit || d.value!==want.value) {
      console.error(`S${s} tile[${i}]: got ${d.suit}/${d.value}, want ${want.suit}/${want.value}`);
      match=false;
    }
  }
}
if (match) console.log('✓ Deal simulation matches desired hands');

// ── Rotate wall to match saved-game format ────────────────────────────────────
// Saved games store the wall ALREADY ROTATED (index 0 = first tile drawn).
// The replay deal() path loads the wall as-is and starts drawing from index 0.
const rotatedWall = [...wall.slice(headIdx), ...wall.slice(0, headIdx)];

console.log('✓ Rotated wall ready (deal simulation already verified above)');

// ── Output JSON ───────────────────────────────────────────────────────────────
const scenario = {
  format:      'mahjong-replay',
  scenario:    true,           // flag: load for live play, not replay
  savedAt:     new Date().toISOString(),
  winner:      null,
  faan:        0,
  label:       'Hijack scenario: all 3 CPUs want 中',
  dealerSeat:  dealerSeat,
  roundWind:   'East',
  logLabel:    'Hijack — who wins on 中?',
  players: [
    { seat:0, name:'You',  isHuman:true  },
    { seat:1, name:'CPU1', isHuman:false },
    { seat:2, name:'CPU2', isHuman:false },
    { seat:3, name:'CPU3', isHuman:false },
  ],
  wall: rotatedWall.map(t => ({ suit: t.suit, value: t.value })),
  dice,
  moves: [
    { a: 'D', s: 0, t: ['dragon', 'red'] },   // human discards 中
    { a: 'W', s: 1, t: ['dragon', 'red'] },   // CPU1 (closest) claims win
  ],
  expected: {
    winnerSeat: 1,
    note: 'CPU1 (seat diff=1, closest counter-clockwise) wins; CPU2 and CPU3 hijacked',
  },
};

const outFile = 'scenario_hijack.json';
fs.writeFileSync(outFile, JSON.stringify(scenario, null, 2));
console.log(`\nWrote ${outFile}`);
console.log('Expected: S0 discards 中, CPU1 (closest) wins — CPU2 and CPU3 hijacked');
console.log('\nLoad in browser: use Load Hand button and select scenario_hijack.json');
console.log('Then set Auto mode and watch, or play manually as human and discard 中 first.');
