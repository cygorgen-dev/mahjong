// ============================================================
// tiles.js  — Tile definitions and wall management
// ============================================================

// Suit ids
const SUIT = { BAMBOO: 'bamboo', CIRCLE: 'circle', CHAR: 'char', WIND: 'wind', DRAGON: 'dragon', FLOWER: 'flower', SEASON: 'season' };
const WINDS = ['East','South','West','North'];
const WIND_ZH = ['東','南','西','北'];
const DRAGONS = ['red','green','white'];
const DRAGON_ZH = { red:'中', green:'發', white:'白' };
const DRAGON_EN = { red:'Red', green:'Green', white:'White' };

// Number suits display
const SUIT_ZH = { bamboo:'竹', circle:'餅', char:'萬' };
const SUIT_EN = { bamboo:'Bam', circle:'Dot', char:'Char' };
const NUM_ZH = ['','一','二','三','四','五','六','七','八','九'];
const FLOWER_ZH = ['梅','蘭','菊','竹'];
const FLOWER_EN = ['Plum','Orchid','Chrys','Bam'];
const SEASON_ZH = ['春','夏','秋','冬'];
const SEASON_EN = ['Spring','Summer','Autumn','Winter'];

let _nextId = 0;
function makeTile(suit, value, extra = {}) {
  return { id: _nextId++, suit, value, ...extra };
}

/** Build a complete 144-tile set */
function buildWall() {
  _nextId = 0;
  const tiles = [];
  // 3 suits × 9 numbers × 4 copies
  for (const suit of [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR]) {
    for (let n = 1; n <= 9; n++) {
      for (let c = 0; c < 4; c++) {
        tiles.push(makeTile(suit, n));
      }
    }
  }
  // 4 winds × 4 copies
  for (const w of WINDS) {
    for (let c = 0; c < 4; c++) tiles.push(makeTile(SUIT.WIND, w));
  }
  // 3 dragons × 4 copies
  for (const d of DRAGONS) {
    for (let c = 0; c < 4; c++) tiles.push(makeTile(SUIT.DRAGON, d));
  }
  // 4 flowers (1 copy each)
  for (let i = 0; i < 4; i++) tiles.push(makeTile(SUIT.FLOWER, i));
  // 4 seasons (1 copy each)
  for (let i = 0; i < 4; i++) tiles.push(makeTile(SUIT.SEASON, i));

  shuffle(tiles);
  return tiles;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Tile display helpers */
function tileMain(t) {
  if (t.suit === SUIT.BAMBOO || t.suit === SUIT.CIRCLE || t.suit === SUIT.CHAR) {
    return NUM_ZH[t.value] + SUIT_ZH[t.suit];
  }
  if (t.suit === SUIT.WIND)   return WIND_ZH[WINDS.indexOf(t.value)];
  if (t.suit === SUIT.DRAGON) return DRAGON_ZH[t.value];
  if (t.suit === SUIT.FLOWER) return FLOWER_ZH[t.value];
  if (t.suit === SUIT.SEASON) return SEASON_ZH[t.value];
  return '?';
}

function tileEnglish(t) {
  if (t.suit === SUIT.BAMBOO || t.suit === SUIT.CIRCLE || t.suit === SUIT.CHAR) {
    return '' + t.value; // Arabic number — suit is obvious from image
  }
  if (t.suit === SUIT.WIND)   return t.value;        // e.g. "East"
  if (t.suit === SUIT.DRAGON) return DRAGON_EN[t.value]; // e.g. "Red"
  if (t.suit === SUIT.FLOWER) return FLOWER_EN[t.value]; // e.g. "Plum"
  if (t.suit === SUIT.SEASON) return SEASON_EN[t.value]; // e.g. "Spring"
  return '';
}

function tileNum(t) {
  if (t.suit === SUIT.BAMBOO || t.suit === SUIT.CIRCLE || t.suit === SUIT.CHAR) return '' + t.value;
  if (t.suit === SUIT.FLOWER || t.suit === SUIT.SEASON) return '' + (t.value + 1);
  return '';
}

function tileSortKey(t) {
  const ORDER = { bamboo: 0, circle: 1, char: 2, wind: 3, dragon: 4, flower: 5, season: 6 };
  return ORDER[t.suit] * 100 + (typeof t.value === 'number' ? t.value : WINDS.indexOf(t.value) + DRAGONS.indexOf(t.value) + 1);
}

function sortHand(hand) {
  return [...hand].sort((a, b) => tileSortKey(a) - tileSortKey(b));
}

/** Check if a tile is a bonus tile (flower/season) – auto-drawn */
function isBonus(t) { return t.suit === SUIT.FLOWER || t.suit === SUIT.SEASON; }

/** Tile equality by suit+value (not id) */
function sameType(a, b) { return a.suit === b.suit && a.value === b.value; }

/** Group tiles by type into counts map */
function countMap(tiles) {
  const m = {};
  for (const t of tiles) {
    const k = t.suit + '|' + t.value;
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}
