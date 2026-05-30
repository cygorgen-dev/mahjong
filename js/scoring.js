// ============================================================
// scoring.js  — Win detection and HK faan scoring
// ============================================================

/**
 * Attempt to decompose `tiles` (array, bonus removed) into 4 sets + 1 pair.
 * `melds` are already-formed sets (kong/pung/chow from claims).
 * Returns array of decompositions, each = { pair, sets[] }
 *   where each set = { type:'pung'|'chow'|'kong', tiles:[] }
 */
function decompose(tiles, melds) {
  const needed = 4 - melds.length; // how many more sets from hand
  const results = [];

  // We'll try every valid decomposition of `tiles` into `needed` sets + 1 pair
  function recurse(remaining, setsFound, pairFound) {
    const rem = [...remaining].sort((a, b) => tileSortKey(a) - tileSortKey(b));
    if (rem.length === 0 && setsFound.length === needed && pairFound) {
      results.push({ pair: pairFound, sets: [...melds, ...setsFound] });
      return;
    }
    if (rem.length === 0) return;
    const first = rem[0];
    const rest = rem.slice(1);

    // Try as pair
    if (!pairFound) {
      const idx = rest.findIndex(t => sameType(t, first));
      if (idx !== -1) {
        const newRest = [...rest];
        newRest.splice(idx, 1);
        recurse(newRest, setsFound, { type: 'pair', tiles: [first, rest[idx]] });
      }
    }
    // Try as pung (3 of same)
    const idx2 = rest.findIndex(t => sameType(t, first));
    if (idx2 !== -1) {
      const rest2 = [...rest];
      rest2.splice(idx2, 1);
      const idx3 = rest2.findIndex(t => sameType(t, first));
      if (idx3 !== -1) {
        const rest3 = [...rest2];
        rest3.splice(idx3, 1);
        recurse(rest3, [...setsFound, { type: 'pung', tiles: [first, rest[idx2], rest2[idx3]] }], pairFound);
      }
    }
    // Try as chow (sequence, numbers only)
    if ([SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(first.suit) && typeof first.value === 'number') {
      const n = first.value;
      if (n <= 7) {
        // need n+1 and n+2 in rest
        const i1 = rest.findIndex(t => t.suit === first.suit && t.value === n + 1);
        if (i1 !== -1) {
          const rest1 = [...rest]; rest1.splice(i1, 1);
          const i2 = rest1.findIndex(t => t.suit === first.suit && t.value === n + 2);
          if (i2 !== -1) {
            const rest2 = [...rest1]; rest2.splice(i2, 1);
            recurse(rest2, [...setsFound, { type: 'chow', tiles: [first, rest[i1], rest1[i2]] }], pairFound);
          }
        }
      }
    }
  }

  recurse(tiles, [], null);
  return results;
}

/** Special hand: Seven Pairs - 七對子 */
function isSevenPairs(hand) {
  if (hand.length !== 14) return false;
  const counts = {};
  for (const t of hand) {
    const k = t.suit + '|' + t.value;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.values(counts).every(c => c === 2);
}

/** Special hand: Thirteen Orphans - 十三么 */
function isThirteenOrphans(hand) {
  if (hand.length !== 14) return false;
  const orphans = [
    [SUIT.BAMBOO,1],[SUIT.BAMBOO,9],[SUIT.CIRCLE,1],[SUIT.CIRCLE,9],
    [SUIT.CHAR,1],[SUIT.CHAR,9],
    [SUIT.WIND,'East'],[SUIT.WIND,'South'],[SUIT.WIND,'West'],[SUIT.WIND,'North'],
    [SUIT.DRAGON,'red'],[SUIT.DRAGON,'green'],[SUIT.DRAGON,'white']
  ];
  const keys = hand.map(t => t.suit + '|' + t.value);
  return orphans.every(([s,v]) => keys.includes(s+'|'+v));
}

/**
 * canWin(hand14, melds, context) → { win:bool, faan:int, label:string, decomp }
 * hand14: all tiles in hand (concealed portion = 14 if no melds, fewer with melds)
 * melds: already-locked melds
 * context: { selfDraw, seatWind, roundWind, bonusTiles[], firstDraw }
 */
function canWin(hand14, melds, ctx) {
  // Strip bonus from hand
  const hand = hand14.filter(t => !isBonus(t));

  // Concealed if all melds are unclaimed or are concealed kongs.
  // Set early so Seven Pairs and other special paths can use it.
  if (ctx) ctx.concealed = melds.every(m => !m.claimed || m.concealed);

  // Check special hands
  const sevenPairsEnabled = (typeof USE_SEVEN_PAIRS !== 'undefined') ? USE_SEVEN_PAIRS : true;
  if (sevenPairsEnabled && melds.length === 0 && isSevenPairs(hand)) {
    const f = calcFaanSevenPairs(hand, ctx);
    return { win: true, faan: f.total, label: f.label, special: '7pairs' };
  }
  if (melds.length === 0 && isThirteenOrphans(hand)) {
    return { win: true, faan: 13, label: 'Thirteen Orphans 十三么', special: '13orphans' };
  }
  if (ctx.firstDraw && melds.length === 0) {
    // Heavenly/Earthly handled by game logic
  }

  // --- 7 or 8 bonus tiles: flat bonus faan + normal hand scoring still applies
  const ctxBonusTiles = ctx.bonusTiles || [];
  if (ctxBonusTiles.length >= 7) {
    const bonusBaseFaan = ctxBonusTiles.length >= 8 ? 13 : 3;
    const bonusLabel = ctxBonusTiles.length >= 8
      ? 'Eight Bonus Tiles 八仙過海 (13f)'
      : 'Seven Bonus Tiles 七花齊放 (3f)';
    // Still score the hand normally (All Triplets, wind pungs, dragons, self-draw, etc.)
    // but skip the per-tile bonus scoring (no own-flower/season on top of the flat rate)
    const decomps7 = decompose(hand, melds);
    let handFaan = 0;
    let handLabel = '';
    if (decomps7.length > 0) {
      let best7 = null;
      for (const d of decomps7) {
        const f = calcFaan(d, hand, { ...ctx, bonusTiles: null, concealed: false }); // null = skip bonus tile scoring; concealed doesn't apply to bonus wins
        if (!best7 || f.total > best7.total) best7 = f;
      }
      if (best7) { handFaan = best7.total; handLabel = best7.label; }
    }
    const totalFaan = bonusBaseFaan + handFaan;
    const fullLabel = handLabel ? `${bonusLabel}, ${handLabel}` : bonusLabel;
    return { win: true, faan: totalFaan, label: fullLabel, special: 'bonus-win' };
  }

  // Concealed kongs don't break concealed hand status
  const effectiveMelds = melds.map(m => m.concealed ? { ...m, claimed: false } : m);
  const decomps = decompose(hand, effectiveMelds);
  if (decomps.length === 0) return { win: false };

  // Pick best decomposition
  let best = null;
  for (const d of decomps) {
    const f = calcFaan(d, hand, ctx);
    if (!best || f.total > best.total) best = { ...f, decomp: d };
  }
  if (!best) return { win: false, faan: 0, label: '' };
  return { win: true, faan: best.total, label: best.label, decomp: best.decomp };
}

function calcFaanSevenPairs(hand, ctx) {
  let total = 4; // base for seven pairs
  const labels = ['Seven Pairs 七對子 (4f)'];
  if (ctx.selfDraw) { total += 1; labels.push('Self Draw +1'); }
  if (ctx.concealed) { total += 1; labels.push('Concealed +1'); }
  return { total, label: labels.join(', ') };
}

function calcFaan(decomp, hand, ctx) {
  let faan = 0;
  const labels = [];
  const { pair, sets } = decomp;

  const pungs = sets.filter(s => s.type === 'pung' || s.type === 'kong');
  const chows = sets.filter(s => s.type === 'chow');

  // --- Common Hand (平胡): all four sets are chows (no pair restriction in Cantonese rules)
  if (chows.length === 4) {
    faan += 1; labels.push('Common Hand 平胡 (1f)');
  }

  // --- All Triplets (對對胡): all pungs/kongs
  if (pungs.length === 4) { faan += 3; labels.push('All Triplets 對對胡 (3f)'); }

  // --- Dragon pungs
  for (const p of pungs) {
    if (p.tiles[0].suit === SUIT.DRAGON) {
      faan += 1;
      labels.push(`Dragon Pung ${DRAGON_ZH[p.tiles[0].value]} (1f)`);
    }
  }

  // --- Seat / Round wind pungs
  for (const p of pungs) {
    if (p.tiles[0].suit === SUIT.WIND) {
      const w = p.tiles[0].value;
      if (w === ctx.seatWind) { faan += 1; labels.push(`Seat Wind Pung ${w} (1f)`); }
      if (w === ctx.roundWind) { faan += 1; labels.push(`Round Wind Pung ${w} (1f)`); }
    }
  }

  // --- All one suit / Mixed one suit / All Honors
  // Must check ALL tiles including those already in claimed melds
  const meldTiles = (decomp.sets || []).flatMap(s => s.tiles || []);
  const pairTiles = decomp.pair ? decomp.pair.tiles : [];
  const allTiles = [...hand.filter(t => !isBonus(t)), ...meldTiles, ...pairTiles]
    .filter(t => !isBonus(t));
  // Deduplicate by id so meld tiles already in hand aren't double-counted
  const seenIds = new Set();
  const uniqueTiles = allTiles.filter(t => {
    if (seenIds.has(t.id)) return false;
    seenIds.add(t.id);
    return true;
  });
  const handSuits = new Set(uniqueTiles.map(t => t.suit));
  const hasHonors = handSuits.has(SUIT.WIND) || handSuits.has(SUIT.DRAGON);
  const numSuits = [...handSuits].filter(s => [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(s));
  if (numSuits.length === 1 && !hasHonors) {
    faan += 7; labels.push('Pure One Suit 清一色 (7f)');
  } else if (numSuits.length === 1 && hasHonors) {
    faan += 3; labels.push('Mixed One Suit 混一色 (3f)');
  }

  // --- All Honors (字一色)
  if (numSuits.length === 0 && hasHonors) {
    faan += 10; labels.push('All Honors 字一色 (10f)');
  }

  // --- Small / Big Dragons
  const dragonPungSet = new Set(pungs.filter(p => p.tiles[0].suit === SUIT.DRAGON).map(p => p.tiles[0].value));
  const pairIsDragon = pair && pair.tiles[0].suit === SUIT.DRAGON;
  if (dragonPungSet.size === 2 && pairIsDragon) { faan += 5; labels.push('Small Dragons 小三元 (5f)'); }
  else if (dragonPungSet.size === 3) { faan += 8; labels.push('Big Dragons 大三元 (8f)'); }

  // --- Small / Big Winds
  const windPungSet = new Set(pungs.filter(p => p.tiles[0].suit === SUIT.WIND).map(p => p.tiles[0].value));
  const pairIsWind = pair && pair.tiles[0].suit === SUIT.WIND;
  if (windPungSet.size === 3 && pairIsWind) { faan += 6; labels.push('Small Winds 小四喜 (6f)'); }
  else if (windPungSet.size === 4) { faan += 13; labels.push('Big Winds 大四喜 (13f)'); }

  // --- No flowers / No seasons bonus (無花 1f)
  // Winning with zero bonus tiles scores 1 faan in HK rules.
  // bonusTiles===null means we're inside a 7/8-bonus win path; skip this entire section.
  const bonusTiles = ctx.bonusTiles ?? null;
  if (bonusTiles !== null) {
    if (bonusTiles.length === 0) {
      faan += 1; labels.push('No Flowers 無花 (1f)');
    }

    // --- Bonus flowers/seasons
    const seatIdx  = WINDS.indexOf(ctx.seatWind);
    for (const b of bonusTiles) {
      const idx = b.value;
      if (idx === seatIdx) {
        faan += 1;
        if (b.suit === SUIT.FLOWER) labels.push(`Own Flower ${FLOWER_ZH[idx]} 正花 (1f)`);
        if (b.suit === SUIT.SEASON) labels.push(`Own Season ${SEASON_ZH[idx]} 正季 (1f)`);
      }
    }

    // --- Complete set of 4 Flowers or 4 Seasons (+1f per complete set)
    const flowerCount  = bonusTiles.filter(b => b.suit === SUIT.FLOWER).length;
    const seasonCount  = bonusTiles.filter(b => b.suit === SUIT.SEASON).length;
    if (flowerCount === 4) { faan += 1; labels.push('All 4 Flowers 百花齊放 (+1f)'); }
    if (seasonCount === 4) { faan += 1; labels.push('All 4 Seasons 四季如春 (+1f)'); }
  }
  
  // --- Self draw (自摸)
  if (ctx.selfDraw) { faan += 1; labels.push('Self Draw 自摸 (1f)'); }

  // --- Fully concealed (門清)
  if (ctx.concealed) { faan += 1; labels.push('Concealed 門清 (1f)'); }

  // --- Robbed the Kong (搶槓胡)
  if (ctx.robbedKong) { faan += 1; labels.push('Robbed the Kong 搶槓胡 (+1f)'); }

  // --- Heavenly Hand 天胡 (dealer self-draw on first tile)
  if (ctx.heavenlyHand) {
    const max = (typeof MAX_FAAN !== 'undefined' && MAX_FAAN > 0) ? MAX_FAAN : 13;
    return { total: max, label: `Heavenly Hand 天胡 (${max}f)` };
  }

  // --- Earthly Hand 地胡 (non-dealer wins on dealer's first discard)
  if (ctx.earthlyHand) {
    const max = (typeof MAX_FAAN !== 'undefined' && MAX_FAAN > 0) ? MAX_FAAN : 13;
    return { total: max, label: `Earthly Hand 地胡 (${max}f)` };
  }

  // --- Last Tile 海底撈月 (self-draw on last wall tile)
  if (ctx.lastTile) {
    const max = (typeof MAX_FAAN !== 'undefined' && MAX_FAAN > 0) ? MAX_FAAN : 13;
    return { total: max, label: `Last Tile 海底撈月 (${max}f)` };
  }

  return { total: faan, label: labels.join(', ') || 'Chicken Hand' };
}

/** Cap faan at MAX_FAAN (0 = no cap / infinite) */
function capFaan(faan) {
  const max = (typeof MAX_FAAN !== 'undefined') ? MAX_FAAN : 0;
  if (max > 0 && faan > max) return max;
  return faan;
}

/** Translate faan to base points per the rules.html payout table */
function faanToPoints(faan) {
  // From rules.html payout table (base points per faan level)
  // Faan 0: 1, Faan 1: 2, Faan 2: 4, Faan 3: 8, Faan 4: 16,
  // Faan 5: 24, Faan 6: 32, Faan 7: 48, Faan 8: 64, Faan 9: 96, Faan 10+: 128
  const table = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128];
  if (faan < 0) return 0;
  if (faan >= table.length) return 128;
  return table[faan];
}

/**
 * Calculate actual payment amounts from faan.
 * selfDraw: each of 3 losers pays winner base × 2, capped at base(maxFaan) × 2
 * discard:  the loser pays winner base × 4, capped at base(maxFaan) × 4
 * maxFaan=0 means no cap.
 */
function calcPayout(faan, selfDraw) {
  const maxF = (typeof MAX_FAAN !== 'undefined') ? MAX_FAAN : 7;
  const base = faanToPoints(faan);
  const mult = selfDraw ? 2 : 4;
  const raw = base * mult;
  if (maxF > 0) {
    const cap = faanToPoints(maxF) * mult;
    return Math.min(raw, cap);
  }
  return raw;
}

/** Return list of tiles that, if drawn, would complete hand (tenpai check) */
function getTenpaiTiles(hand, melds) {
  const candidates = new Set();
  // iterate all 34 types
  const types = [];
  for (const s of [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR]) {
    for (let n = 1; n <= 9; n++) types.push({ suit: s, value: n, id: -1 });
  }
  for (const w of WINDS) types.push({ suit: SUIT.WIND, value: w, id: -1 });
  for (const d of DRAGONS) types.push({ suit: SUIT.DRAGON, value: d, id: -1 });

  for (const t of types) {
    const test = [...hand, t];
    const d = decompose(test.filter(x => !isBonus(x)), melds);
    if (d.length > 0) candidates.add(t.suit + '|' + t.value);
    // seven pairs
    if (melds.length === 0 && isSevenPairs(test)) candidates.add(t.suit + '|' + t.value);
    if (melds.length === 0 && isThirteenOrphans(test)) candidates.add(t.suit + '|' + t.value);
  }
  return [...candidates];
}
