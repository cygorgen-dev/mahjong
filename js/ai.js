// ============================================================
// ai.js  — Simple AI for three CPU opponents
// ============================================================

/**
 * AI decision: which tile to discard from hand after drawing.
 * Strategy:
 *  1. If in tenpai, keep tenpai – discard the non-contributing tile.
 *  2. Prefer to keep tiles that form pairs/pungs/chows.
 *  3. Discard isolated honors / terminals first.
 */
function aiChooseDiscard(hand, melds) {
  const safe = hand.filter(t => !isBonus(t));

  // Try each possible discard and see if remainder is closer to winning
  let bestDiscard = null;
  let bestScore = -Infinity;

  for (let i = 0; i < safe.length; i++) {
    const without = [...safe.slice(0, i), ...safe.slice(i + 1)];
    const score = evalHand(without, melds);
    if (score > bestScore) {
      bestScore = score;
      bestDiscard = safe[i];
    }
  }
  return bestDiscard || safe[safe.length - 1];
}

/**
 * Simple hand evaluation – how many tiles are "useful" (in sets/pairs).
 * Higher = better.
 */
function evalHand(hand, melds) {
  // Count number of tiles that are in a set or pair in the best decomposition
  let score = 0;

  // Check tenpai
  const waits = getTenpaiTiles(hand, melds);
  if (waits.length > 0) score += 100 + waits.length * 2;

  // Contribution of each tile
  const counts = countMap(hand);
  for (const [key, cnt] of Object.entries(counts)) {
    if (cnt >= 3) score += 10;      // pung
    else if (cnt === 2) score += 5; // pair
  }

  // Sequential potential
  for (const t of hand) {
    if (![SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(t.suit)) continue;
    const n = t.value;
    for (const step of [1, 2]) {
      if (hand.some(x => x.suit === t.suit && x.value === n + step)) score += 2;
    }
  }

  // Honors / terminals are less flexible
  for (const t of hand) {
    if (t.suit === SUIT.WIND || t.suit === SUIT.DRAGON) score -= 1;
    if ((t.suit === SUIT.BAMBOO || t.suit === SUIT.CIRCLE || t.suit === SUIT.CHAR) && (t.value === 1 || t.value === 9)) score -= 0.5;
  }

  return score;
}

/**
 * AI decision: should the AI claim a discarded tile?
 * Returns 'win' | 'kong' | 'pung' | 'chow' | null
 * seatDiff: 1=next player (chow eligible), 2,3=others
 */
function aiClaimDecision(hand, melds, discard, seatDiff, ctx) {
  // Win check — use proper context (seatWind, bonusTiles etc) if provided
  const winCtx = ctx || { selfDraw: false, seatWind: 'East', roundWind: 'East', bonusTiles: [], concealed: false };
  winCtx.selfDraw = false;
  const handWith = [...hand, discard];
  const result = canWin(handWith, melds, winCtx);
  const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 3;
  if (result.win && result.faan >= minF) return 'win';

  // Kong check
  if (hand.filter(t => sameType(t, discard)).length === 3) return 'kong';

  // Pung check — claim if we have a pair matching the discard
  if (hand.filter(t => sameType(t, discard)).length >= 2) {
    const newMeld = { type: 'pung', tiles: [discard, discard, discard] };
    const withoutTwo = removeFromHandN(hand, discard, 2);
    const totalMelds = melds.length + 1;
    // Claim pung if: already tenpai after, or have 3+ melds (close to winning), or good hand score
    const waits = getTenpaiTiles(withoutTwo, [...melds, newMeld]);
    const handScore = evalHand(withoutTwo, [...melds, newMeld]);
    if (waits.length > 0 || totalMelds >= 3 || handScore > 10) return 'pung';
  }

  // Chow check (only next player in sequence can chow)
  if (seatDiff === 1 && [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(discard.suit)) {
    const chowMeld = findChowWith(hand, discard);
    if (chowMeld) {
      const fromHand = chowMeld.filter(t => t !== discard);
      const remaining = removeFromHandList(hand, fromHand);
      const newMelds = [...melds, { type: 'chow', tiles: chowMeld }];
      const waits = getTenpaiTiles(remaining, newMelds);
      const handScore = evalHand(remaining, newMelds);
      // Claim chow if it leads to tenpai, or if we have 2+ melds already, or decent score
      if (waits.length > 0 || melds.length >= 2 || handScore > 15) return 'chow';
    }
  }

  return null;
}

/** Find tiles in hand that form a chow with `discard` */
function findChowWith(hand, discard) {
  const all = findAllChowsWith(hand, discard);
  return all.length > 0 ? all[0] : null;
}

/** Returns ALL valid chow combinations with the discard */
function findAllChowsWith(hand, discard) {
  if (![SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(discard.suit)) return [];
  const s = discard.suit, n = discard.value;
  const combos = [[n-2, n-1], [n-1, n+1], [n+1, n+2]];
  const results = [];
  for (const [a, b] of combos) {
    if (a < 1 || b > 9) continue;
    const ta = hand.find(t => t.suit === s && t.value === a);
    const tb = hand.find(t => t.suit === s && t.value === b && t !== ta);
    if (ta && tb) results.push([discard, ta, tb]);
  }
  return results;
}

function removeFromHandN(hand, tile, n) {
  const result = [...hand];
  let removed = 0;
  for (let i = result.length - 1; i >= 0 && removed < n; i--) {
    if (sameType(result[i], tile)) { result.splice(i, 1); removed++; }
  }
  return result;
}

function removeFromHandList(hand, tiles) {
  const result = [...hand];
  for (const t of tiles) {
    const idx = result.findIndex(x => sameType(x, t));
    if (idx !== -1) result.splice(idx, 1);
  }
  return result;
}

function removeFromHand(hand, tiles) { return removeFromHandList(hand, tiles); }

// ============================================================
// AI SKILL LEVELS
// CPU_LEVELS[seat] = 1 (Beginner) | 2 (Intermediate) | 3 (Expert)
// ============================================================

// Global skill levels — set by UI dropdowns
if (typeof CPU_LEVELS === 'undefined') var CPU_LEVELS = { 1: 1, 2: 1, 3: 1 };

function getLevel(seat) {
  return (typeof CPU_LEVELS !== 'undefined') ? (CPU_LEVELS[seat] || 1) : 1;
}

// ---- DISCARD STRATEGY ----

function aiChooseDiscardBeginner(hand, melds) {
  // Original: pure tenpai-speed, no faan awareness
  return aiChooseDiscard(hand, melds);
}

function aiChooseDiscardIntermediate(hand, melds) {
  const safe = hand.filter(t => !isBonus(t));

  // Check if close to Seven Pairs (5+ pairs) — if so, pursue it
  const counts = countMap(safe);
  const pairCount = Object.values(counts).filter(c => c >= 2).length;
  if (pairCount >= 5 && melds.length === 0) {
    // Discard the tile least likely to form a pair
    let bestDiscard = null, bestScore = -Infinity;
    for (let i = 0; i < safe.length; i++) {
      const t = safe[i];
      const k = t.suit + '|' + t.value;
      const cnt = counts[k] || 0;
      // Prefer discarding singles (cnt=1), keep pairs
      const score = cnt === 1 ? 10 : (cnt === 2 ? -5 : -10);
      if (score > bestScore) { bestScore = score; bestDiscard = t; }
    }
    if (bestDiscard) return bestDiscard;
  }

  // Check if close to Pure/Mixed One Suit — if hand is mostly one suit, stay in it
  const numSuits = new Set(safe.filter(t =>
    [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(t.suit)).map(t => t.suit));
  const meldSuits = new Set(melds.flatMap(m => m.tiles)
    .filter(t => [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(t.suit)).map(t => t.suit));
  const allSuits = new Set([...numSuits, ...meldSuits]);

  if (allSuits.size === 1) {
    // Committed to one suit — discard honors/off-suit first
    const offSuit = safe.filter(t =>
      t.suit !== [...allSuits][0] && t.suit !== SUIT.WIND && t.suit !== SUIT.DRAGON);
    if (offSuit.length > 0) {
      // Among off-suit tiles, pick the one hurting us least
      return offSuit.sort((a, b) => tileSortKey(a) - tileSortKey(b))[0];
    }
  }

  // Otherwise use base strategy with honor penalty boost
  let bestDiscard = null, bestScore = -Infinity;
  for (let i = 0; i < safe.length; i++) {
    const without = [...safe.slice(0, i), ...safe.slice(i + 1)];
    let score = evalHand(without, melds);
    // Extra penalty for honors and terminals when we have a suit direction
    const t = safe[i];
    if (allSuits.size === 1) {
      if (t.suit === SUIT.WIND || t.suit === SUIT.DRAGON) score += 3; // encourage honor discard
    }
    if (score > bestScore) { bestScore = score; bestDiscard = t; }
  }
  return bestDiscard || safe[safe.length - 1];
}

function aiChooseDiscardExpert(hand, melds, discardPile) {
  const safe = hand.filter(t => !isBonus(t));

  // 1. Calculate expected faan for each possible discard path
  let bestDiscard = null, bestScore = -Infinity;

  // Detect suit commitment
  const allTiles = [...safe, ...melds.flatMap(m => m.tiles)];
  const suitCounts = {};
  for (const t of allTiles) {
    if ([SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(t.suit)) {
      suitCounts[t.suit] = (suitCounts[t.suit] || 0) + 1;
    }
  }
  const dominantSuit = Object.entries(suitCounts).sort((a,b) => b[1]-a[1])[0]?.[0];
  const totalNumTiles = Object.values(suitCounts).reduce((a,b)=>a+b,0);
  const dominantPct = dominantSuit ? (suitCounts[dominantSuit] / totalNumTiles) : 0;
  const pursuePure = dominantPct >= 0.8 && melds.length <= 1;

  // 2. Safety: track what's been discarded (safe to discard = already discarded by others)
  const discarded = new Set((discardPile||[]).map(t => t.suit+'|'+t.value));

  for (let i = 0; i < safe.length; i++) {
    const t = safe[i];
    const without = [...safe.slice(0, i), ...safe.slice(i + 1)];
    let score = evalHand(without, melds) * 2;

    // Bonus for discarding safe tiles (already in discard pile)
    const k = t.suit+'|'+t.value;
    if (discarded.has(k)) score += 5;

    // Pursuing pure suit: heavily penalize off-suit discards, reward keeping suit
    if (pursuePure && dominantSuit) {
      if ([SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(t.suit) && t.suit !== dominantSuit) {
        score += 15; // encourage discarding off-suit number tiles
      }
      if (t.suit === SUIT.WIND || t.suit === SUIT.DRAGON) score += 8;
    }

    // Value concealed hand: penalize if discarding would require claiming
    // (Expert prefers self-draw when hand is high-value)
    const waits = getTenpaiTiles(without, melds);
    if (waits.length > 0 && melds.length === 0) score += 20; // concealed tenpai is gold

    // Prefer keeping own flower/season (handled by replaceBonus, just in case)

    if (score > bestScore) { bestScore = score; bestDiscard = t; }
  }
  return bestDiscard || safe[safe.length - 1];
}

// ---- CLAIM STRATEGY ----

function aiClaimDecisionIntermediate(hand, melds, discard, seatDiff, ctx) {
  // Always win if possible
  const winCtx = { ...ctx, selfDraw: false };
  const handWith = [...hand, discard];
  const result = canWin(handWith, melds, winCtx);
  const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 2;
  if (result.win && result.faan >= minF) return 'win';

  // Kong always good
  if (hand.filter(t => sameType(t, discard)).length === 3) return 'kong';

  // Check if hand has high concealed potential — if so, don't claim
  const pairCount = Object.values(countMap(hand)).filter(c => c >= 2).length;
  const isSevenPairsPotential = pairCount >= 4 && melds.length === 0;
  if (isSevenPairsPotential) return null; // preserve seven pairs chance

  // Check suit purity potential
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const suitCounts = {};
  for (const t of allTiles) {
    if ([SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(t.suit))
      suitCounts[t.suit] = (suitCounts[t.suit]||0)+1;
  }
  const dominant = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0];
  const pursuePure = dominant && (dominant[1]/allTiles.length) >= 0.75;
  if (pursuePure && ![SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(discard.suit)) return null;
  if (pursuePure && discard.suit !== dominant[0]) return null;

  // Pung: only if it leads to tenpai or we're far along
  if (hand.filter(t => sameType(t, discard)).length >= 2) {
    const newMeld = { type:'pung', tiles:[discard,discard,discard] };
    const without = removeFromHandN(hand, discard, 2);
    const waits = getTenpaiTiles(without, [...melds, newMeld]);
    if (waits.length > 0 || melds.length >= 2) return 'pung';
  }

  // Chow: only if leads to tenpai
  if (seatDiff === 1 && [SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(discard.suit)) {
    const chowMeld = findChowWith(hand, discard);
    if (chowMeld) {
      const fromHand = chowMeld.filter(t => t !== discard);
      const remaining = removeFromHandList(hand, fromHand);
      const newMelds = [...melds, { type:'chow', tiles:chowMeld }];
      const waits = getTenpaiTiles(remaining, newMelds);
      if (waits.length > 0 && melds.length >= 1) return 'chow';
    }
  }
  return null;
}

function aiClaimDecisionExpert(hand, melds, discard, seatDiff, ctx, discardPile) {
  // Always win
  const winCtx = { ...ctx, selfDraw: false };
  const handWith = [...hand, discard];
  const result = canWin(handWith, melds, winCtx);
  const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 2;
  if (result.win && result.faan >= minF) return 'win';

  // Kong
  if (hand.filter(t => sameType(t, discard)).length === 3) return 'kong';

  // Expert: evaluate expected faan of current hand path vs claiming
  // Don't claim if concealed tenpai is reachable with higher faan
  const concealedWaits = getTenpaiTiles(hand, melds);
  if (concealedWaits.length > 0 && melds.length === 0) {
    // Already concealed tenpai — only claim to win, nothing else
    return null;
  }

  // Seven pairs potential
  const pairCount = Object.values(countMap(hand)).filter(c => c >= 2).length;
  if (pairCount >= 5 && melds.length === 0) return null;

  // Pure suit potential
  const allTiles = [...hand, ...melds.flatMap(m=>m.tiles)];
  const suitCounts = {};
  for (const t of allTiles) {
    if ([SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(t.suit))
      suitCounts[t.suit]=(suitCounts[t.suit]||0)+1;
  }
  const dominant = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0];
  const pursuePure = dominant && (dominant[1]/Math.max(allTiles.length,1)) >= 0.8;
  if (pursuePure) {
    if (![SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(discard.suit)) return null;
    if (discard.suit !== dominant[0]) return null;
  }

  // Pung: claim only if it leads immediately to tenpai
  if (hand.filter(t => sameType(t, discard)).length >= 2) {
    const newMeld = { type:'pung', tiles:[discard,discard,discard] };
    const without = removeFromHandN(hand, discard, 2);
    const waits = getTenpaiTiles(without, [...melds, newMeld]);
    if (waits.length > 0) return 'pung';
  }

  // Chow: only if immediately tenpai AND we have 2+ melds already
  if (seatDiff === 1 && [SUIT.BAMBOO,SUIT.CIRCLE,SUIT.CHAR].includes(discard.suit)) {
    const chowMeld = findChowWith(hand, discard);
    if (chowMeld) {
      const fromHand = chowMeld.filter(t => t !== discard);
      const remaining = removeFromHandList(hand, fromHand);
      const newMelds = [...melds, { type:'chow', tiles:chowMeld }];
      const waits = getTenpaiTiles(remaining, newMelds);
      if (waits.length > 0 && melds.length >= 2) return 'chow';
    }
  }
  return null;
}

// ============================================================
// SCHEME HELPERS
// ============================================================

// Returns true if the clone of `discard` found in `remaining` is part of
// a complete set (chow or pung) within that remaining hand.
// Used by 'if-own-flower' to allow claiming when it creates a net new group.
function _cloneFormsGroup(remaining, discard) {
  const safe = remaining.filter(t => !isBonus(t));
  const clone = safe.find(t => sameType(t, discard));
  if (!clone) return false;
  const others = safe.filter(t => t !== clone);
  const s = clone.suit, n = clone.value;
  // Pung: two more of the same type
  if (others.filter(t => sameType(t, clone)).length >= 2) return true;
  // Chow: clone appears in at least one complete sequence within remaining
  if ([SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(s)) {
    const has = v => others.some(t => t.suit === s && t.value === v);
    if (n >= 3 && has(n-2) && has(n-1)) return true;   // clone is high end
    if (n >= 2 && n <= 8 && has(n-1) && has(n+1)) return true;  // clone in middle
    if (n <= 7 && has(n+1) && has(n+2)) return true;   // clone is low end
  }
  return false;
}

// ============================================================
// SCHEME EXECUTOR — drives YOU seat using a SCHEMES entry
// ============================================================

function aiChooseDiscardScheme(seat, hand, melds, discardPile, allPlayers, scheme) {
  const safe = hand.filter(t => !isBonus(t));
  const s = scheme.discard;

  // --- Seven Pairs mode ---
  if (s.pursue === 'seven-pairs') {
    const counts = countMap(safe);
    let best = null, bestScore = -Infinity;
    for (const t of safe) {
      const cnt = counts[t.suit + '|' + t.value] || 0;
      const score = cnt === 1 ? 10 : cnt === 2 ? -5 : -10;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best || safe[safe.length - 1];
  }

  // --- Pure Suit mode ---
  const allT = [...safe, ...melds.flatMap(m => m.tiles)];
  let targetSuit = s.suitLock;
  if (!targetSuit && (s.pursue === 'pure-suit')) {
    const sc = {};
    for (const t of allT) {
      if ([SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(t.suit))
        sc[t.suit] = (sc[t.suit] || 0) + 1;
    }
    const dom = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
    if (dom) targetSuit = dom[0];
  }
  if (targetSuit) {
    const offSuit = safe.filter(t => t.suit !== targetSuit);
    if (offSuit.length > 0)
      return offSuit.sort((a, b) => tileSortKey(a) - tileSortKey(b))[0];
  }

  // --- Pung-Heavy mode: extra bonus for keeping pairs/trips, penalise isolated tiles ---
  const pungBonus = s.pursue === 'pung-heavy' ? 6 : 0;

  // --- Speed / Pung-Heavy: scored discard ---
  const opModels = s.safetyLevel > 0
    ? buildOpponentModels(seat, allPlayers, discardPile) : null;

  let bestDiscard = null, bestScore = -Infinity;
  const counts = countMap(safe);
  for (let i = 0; i < safe.length; i++) {
    const t = safe[i];
    const without = [...safe.slice(0, i), ...safe.slice(i + 1)];
    let score = evalHand(without, melds);

    // Honour & terminal penalties (configurable)
    if (t.suit === SUIT.WIND || t.suit === SUIT.DRAGON)
      score += (s.honorPenalty ?? 1);
    if ([SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(t.suit) &&
        (t.value === 1 || t.value === 9))
      score += (s.terminalPenalty ?? 0.5);

    // Pung-heavy: reward keeping pairs/trips (penalise discarding them)
    if (pungBonus) {
      const cnt = counts[t.suit + '|' + t.value] || 0;
      if (cnt === 1) score += pungBonus;   // isolated → discard sooner
      if (cnt >= 2)  score -= pungBonus;   // pair/trip → keep
    }

    // Safety weight
    if (opModels && s.safetyLevel > 0) {
      const risk = tileRiskScore(t, seat, opModels);
      score -= risk * s.safetyLevel * 2;
    }

    if (score > bestScore) { bestScore = score; bestDiscard = t; }
  }
  return bestDiscard || safe[safe.length - 1];
}

function aiClaimDecisionScheme(seat, hand, melds, discard, seatDiff, ctx, scheme) {
  const s = scheme.claim;
  const winCtx = { ...ctx, selfDraw: false };
  const handWith = [...hand, discard];
  const result = canWin(handWith, melds, winCtx);
  const minF = Math.max(
    (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 0,
    s.winMinFaan || 0
  );

  // Always try to win
  if (result.win && result.faan >= minF) return 'win';

  // Kong
  if (s.kong && hand.filter(t => sameType(t, discard)).length === 3) return 'kong';

  // Guard: don't break concealed tenpai
  if (s.protectConcealed) {
    if (getTenpaiTiles(hand, melds).length > 0 && melds.length === 0) return null;
  }

  // Guard: don't break Seven Pairs path
  if (s.protectSevenPairs) {
    const pairCount = Object.values(countMap(hand)).filter(c => c >= 2).length;
    if (pairCount >= 4 && melds.length === 0) return null;
  }

  // Pung
  if (s.pung !== 'never' && hand.filter(t => sameType(t, discard)).length >= 2) {
    if (s.pung === 'always') return 'pung';
    const newMeld = { type: 'pung', tiles: [discard, discard, discard] };
    const without = removeFromHandN(hand, discard, 2);
    const waits = getTenpaiTiles(without, [...melds, newMeld]);
    if (s.pung === 'if-tenpai' && waits.length > 0) return 'pung';
    if (s.pung === 'if-useful') {
      const handScore = evalHand(without, [...melds, newMeld]);
      if (waits.length > 0 || melds.length >= 2 || handScore > 10) return 'pung';
    }
  }

  // Chow
  if (s.chow !== 'never' && seatDiff === 1 &&
      [SUIT.BAMBOO, SUIT.CIRCLE, SUIT.CHAR].includes(discard.suit)) {
    const chowMeld = findChowWith(hand, discard);
    if (chowMeld) {
      if (s.chow === 'always') return 'chow';
      const fromHand = chowMeld.filter(t => t !== discard);
      const remaining = removeFromHandList(hand, fromHand);
      const newMelds = [...melds, { type: 'chow', tiles: chowMeld }];
      const waits = getTenpaiTiles(remaining, newMelds);
      if (s.chow === 'if-tenpai' && waits.length > 0) return 'chow';
      if (s.chow === 'if-useful') {
        const handScore = evalHand(remaining, newMelds);
        if (waits.length > 0 || melds.length >= 2 || handScore > 15) {
          if (s.noSameChowDiscard) {
            const cloneInRemaining = remaining.some(t => !isBonus(t) && sameType(t, discard));
            if (cloneInRemaining && !_cloneFormsGroup(remaining, discard)) return null;
          }
          return 'chow';
        }
      }
      if (s.chow === 'if-own-flower') {
        // Condition 1: no bonus tiles at all, OR player holds their seat's own flower/season
        const seatIdx = WINDS.indexOf(ctx.seatWind);
        const bonus = ctx.bonusTiles || [];
        const hasOwnBonus = bonus.length === 0 ||
          bonus.some(b => b.value === seatIdx);
        if (!hasOwnBonus) return null;
        // Condition 2: if the remaining hand contains a clone of the claimed tile,
        // the internal sequence already existed — claiming is pointless UNLESS
        // the clone itself forms a new complete group in the remaining hand.
        // e.g. 234455 + claim 2 → remaining 2455: clone 2 has no group → SKIP
        // e.g. 12345  + claim 3 → remaining 345:  clone 3 forms [3,4,5] → OK
        const cloneInRemaining = remaining.some(
          t => !isBonus(t) && sameType(t, discard)
        );
        if (cloneInRemaining && !_cloneFormsGroup(remaining, discard)) return null;
        return 'chow';
      }
    }
  }

  return null;
}

// ---- DISPATCHER: routes to correct level ----

function aiChooseDiscardByLevel(seat, hand, melds, discardPile, allPlayers) {
  const scheme = seat === 0
    ? ((typeof USER_SCHEME !== 'undefined') ? USER_SCHEME : null)
    : (window.CPU_SCHEMES?.[seat] ?? null);
  if (scheme) return aiChooseDiscardScheme(seat, hand, melds, discardPile, allPlayers, scheme);
  const level = getLevel(seat);
  if (level === 4) return aiChooseDiscardLevel4(seat, hand, melds, discardPile, allPlayers);
  if (level === 3) return aiChooseDiscardExpert(hand, melds, discardPile);
  if (level === 2) return aiChooseDiscardIntermediate(hand, melds);
  return aiChooseDiscardBeginner(hand, melds);
}

function aiClaimDecisionByLevel(seat, hand, melds, discard, seatDiff, ctx, discardPile, allPlayers) {
  const scheme = seat === 0
    ? ((typeof USER_SCHEME !== 'undefined') ? USER_SCHEME : null)
    : (window.CPU_SCHEMES?.[seat] ?? null);
  if (scheme) return aiClaimDecisionScheme(seat, hand, melds, discard, seatDiff, ctx, scheme);
  const level = getLevel(seat);
  if (level === 4) return aiClaimDecisionLevel4(seat, hand, melds, discard, seatDiff, ctx, discardPile, allPlayers);
  if (level === 3) return aiClaimDecisionExpert(hand, melds, discard, seatDiff, ctx, discardPile);
  if (level === 2) return aiClaimDecisionIntermediate(hand, melds, discard, seatDiff, ctx);
  return aiClaimDecision(hand, melds, discard, seatDiff, ctx);
}

// ============================================================
// HINT ENGINE — Expert-level advice for the human player
// ============================================================

function generateHint(hand, melds, discardPile, ctx) {
  const safe = hand.filter(t => !isBonus(t));
  const hints = [];

  // 1. Check tenpai status
  const waits = getTenpaiTiles(safe, melds);
  if (waits.length > 0) {
    const waitNames = waits.slice(0, 5).map(w => {
      const [suit, val] = w.split('|');
      const suitName = { bamboo:'Bamboo', circle:'Dots', char:'Characters',
        wind:'Wind', dragon:'Dragon' }[suit] || suit;
      return `${val} ${suitName}`;
    }).join(', ');
    hints.push(`✅ You are in tenpai! Waiting for: ${waitNames}${waits.length > 5 ? ' …' : ''}.`);
    if (melds.length === 0) {
      hints.push(`🌟 Concealed tenpai — if you self-draw, you earn +1 Concealed 門清 and +1 Self Draw 自摸. Consider waiting rather than claiming.`);
    }
  }

  // 2. Detect what hand is being built
  const allTiles = [...safe, ...melds.flatMap(m => m.tiles)];
  const suitCounts = {};
  for (const t of allTiles) {
    if (['bamboo','circle','char'].includes(t.suit))
      suitCounts[t.suit] = (suitCounts[t.suit] || 0) + 1;
  }
  const total = Object.values(suitCounts).reduce((a,b)=>a+b,0);
  const dominant = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0];
  const dominantPct = dominant ? dominant[1]/Math.max(total,1) : 0;
  const suitLabel = { bamboo:'Bamboo 竹', circle:'Dots 餅', char:'Characters 萬' };

  if (dominantPct >= 0.8 && total >= 8) {
    const hasHonors = allTiles.some(t => t.suit === 'wind' || t.suit === 'dragon');
    if (hasHonors) {
      hints.push(`🎯 Building Mixed One Suit 混一色 (3 faan) in ${suitLabel[dominant[0]]}. Discard off-suit number tiles first.`);
    } else {
      hints.push(`🎯 Building Pure One Suit 清一色 (7 faan) in ${suitLabel[dominant[0]]}! Discard anything not ${suitLabel[dominant[0]]}.`);
    }
  }

  // 3. Seven pairs potential
  const counts = {};
  for (const t of safe) {
    const k = t.suit+'|'+t.value;
    counts[k] = (counts[k]||0)+1;
  }
  const pairCount = Object.values(counts).filter(c => c >= 2).length;
  if (pairCount >= 4 && melds.length === 0) {
    hints.push(`🎯 Building Seven Pairs 七對子 (4 faan) — you have ${pairCount} pairs. Discard singles, keep pairs.`);
  }

  // 4. All Triplets potential
  const pungCount = Object.values(counts).filter(c => c >= 3).length + melds.filter(m=>m.type==='pung'||m.type==='kong').length;
  if (pungCount >= 3) {
    hints.push(`🎯 Close to All Triplets 對對胡 (3 faan) — ${pungCount} pungs/kongs. Prefer punging over chowing.`);
  }

  // 5. Kong available
  const kongKey = Object.entries(counts).find(([k,c]) => c >= 4);
  if (kongKey && melds.every(m => !m.claimed)) {
    const [suit, val] = kongKey[0].split('|');
    hints.push(`💎 You can declare a Concealed Kong 暗槓 on ${val} ${suitLabel[suit]||suit}. Click Kong 槓 — it preserves your concealed status and gets you a free draw!`);
  }

  // 6. Best discard suggestion
  const suggested = aiChooseDiscardExpert(safe, melds, discardPile);
  if (suggested && waits.length === 0) {
    const sName = suitLabel[suggested.suit] || suggested.suit;
    const discarded = (discardPile||[]).filter(t => t.suit===suggested.suit && t.value===suggested.value).length;
    let reason = '';
    if (suggested.suit === 'wind' || suggested.suit === 'dragon') reason = 'honor tiles are inflexible';
    else if (discarded > 0) reason = `already discarded by others — safer to play`;
    else if (dominantPct >= 0.8 && suggested.suit !== dominant[0]) reason = `off-suit — keeping hand pure`;
    else reason = 'least useful for your hand';
    hints.push(`👉 Suggested discard: ${suggested.value} ${sName} — ${reason}.`);
  }

  // 7. If no hints generated
  if (hints.length === 0) {
    hints.push(`👉 No clear direction yet. Discard isolated honor tiles (Winds, Dragons) or terminals (1s and 9s) first.`);
  }

  return hints;
}

// ============================================================
// LEVEL 4 — REAL EXPERT: Opponent-aware defensive play
// ============================================================
//
// Core ideas:
//  1. Build a model of each opponent from their discards + melds
//  2. Score each tile we might discard by how dangerous it is to each opponent
//  3. When an opponent is near tenpai → switch to defensive mode
//  4. Suit absence = hoarding signal → avoid feeding that suit
//  5. Meld reading → infer what the opponent still needs
//

/**
 * Build opponent models from the full game state.
 * Returns an array of 4 opponent models (index = seat).
 * Each model: { suitAbsence, dangerTiles, tilesLeft, nearTenpai, meldedSuits }
 */
function buildOpponentModels(mySeat, allPlayers, discardPile) {
  const models = [];
  for (let seat = 0; seat < 4; seat++) {
    if (seat === mySeat) { models.push(null); continue; }

    const p = allPlayers[seat];
    if (!p) { models.push(null); continue; }

    // Tiles this opponent has discarded
    const theirDiscards = (discardPile || []).filter(t => t._discardSeat === seat);
    const totalDiscards = theirDiscards.length;

    // Which suits they have NOT discarded (hoarding signal)
    const discardedSuits = new Set(theirDiscards
      .filter(t => ['bamboo','circle','char'].includes(t.suit))
      .map(t => t.suit));
    const allNumSuits = ['bamboo','circle','char'];
    const absentSuits = allNumSuits.filter(s => !discardedSuits.has(s));
    // Only meaningful after they've had enough turns to discard something
    const suitAbsence = totalDiscards >= 4 ? absentSuits : [];

    // Which specific tiles are dangerous (they might need them)
    const dangerTiles = new Set();

    // From their melds: infer adjacent tiles they might want
    for (const meld of (p.melds || [])) {
      if (meld.type === 'chow') {
        const vals = meld.tiles.map(t => t.value).sort((a,b)=>a-b);
        const suit = meld.tiles[0].suit;
        // Tiles adjacent to a claimed chow are dangerous
        if (vals[0] > 1) dangerTiles.add(`${suit}|${vals[0]-1}`);
        if (vals[2] < 9) dangerTiles.add(`${suit}|${vals[2]+1}`);
      }
      if (meld.type === 'pung') {
        const suit = meld.tiles[0].suit;
        const val  = meld.tiles[0].value;
        // 4th copy of a punged tile is dangerous (kong upgrade)
        dangerTiles.add(`${suit}|${val}`);
        // Adjacent tiles to a pung are likely part of their hand
        if (['bamboo','circle','char'].includes(suit)) {
          if (val > 1) dangerTiles.add(`${suit}|${val-1}`);
          if (val < 9) dangerTiles.add(`${suit}|${val+1}`);
        }
      }
    }

    // Tiles remaining in hand (concealed)
    const tilesLeft = (p.hand || []).filter(t => !t._placeholder).length;

    // Near tenpai: ≤2 concealed tiles left, or many melds
    const meldCount = (p.melds || []).length;
    const nearTenpai = tilesLeft <= 2 || meldCount >= 3;

    // What suits appear in their melds
    const meldedSuits = new Set(
      (p.melds || []).flatMap(m => m.tiles).map(t => t.suit)
    );

    models.push({ suitAbsence, dangerTiles, tilesLeft, nearTenpai, meldedSuits, totalDiscards });
  }
  return models;
}

/**
 * Score a candidate discard tile for DANGER — higher = more dangerous to play.
 * Aggregates risk across all opponents.
 */
function tileRiskScore(tile, mySeat, opponentModels) {
  let risk = 0;
  const key = `${tile.suit}|${tile.value}`;

  for (let seat = 0; seat < 4; seat++) {
    const m = opponentModels[seat];
    if (!m) continue;

    // Near-tenpai opponent: any tile is riskier
    const nearTenpaiMult = m.nearTenpai ? 3 : 1;

    // Opponent is hoarding this suit → risky
    if (m.suitAbsence.includes(tile.suit)) risk += 4 * nearTenpaiMult;

    // Tile is adjacent to their meld → dangerous
    if (m.dangerTiles.has(key)) risk += 5 * nearTenpaiMult;

    // Their melds are all in this suit → pure suit danger
    if (m.meldedSuits.size === 1 && m.meldedSuits.has(tile.suit)) risk += 3 * nearTenpaiMult;
  }
  return risk;
}

/**
 * Find the safest tile to discard when in pure defensive mode.
 * Uses discard pile: tiles already discarded = guaranteed safe.
 */
function safeDiscard(hand, melds, discardPile, mySeat, opponentModels) {
  const safe = hand.filter(t => !isBonus(t));
  if (safe.length === 0) return null;

  // Count how many copies of each tile are already in the discard pile
  const discardCounts = {};
  for (const t of (discardPile || [])) {
    const k = `${t.suit}|${t.value}`;
    discardCounts[k] = (discardCounts[k] || 0) + 1;
  }

  let bestDiscard = null;
  let bestScore = -Infinity;

  for (const t of safe) {
    const k = `${t.suit}|${t.value}`;
    let safetyScore = 0;

    // Already discarded copies → safer (max 4 copies in game)
    const alreadyOut = discardCounts[k] || 0;
    safetyScore += alreadyOut * 8; // 3 out = very safe

    // Honour tiles not yet punged by anyone → relatively safe
    if ((t.suit === 'wind' || t.suit === 'dragon') && alreadyOut === 0) safetyScore += 2;

    // Subtract risk from opponent models
    safetyScore -= tileRiskScore(t, mySeat, opponentModels);

    if (safetyScore > bestScore) {
      bestScore = safetyScore;
      bestDiscard = t;
    }
  }
  return bestDiscard;
}

/**
 * Level 4 discard: balance hand efficiency vs opponent danger.
 */
function aiChooseDiscardLevel4(seat, hand, melds, discardPile, allPlayers) {
  const safe = hand.filter(t => !isBonus(t));
  if (safe.length === 0) return hand[hand.length - 1];

  const opponentModels = buildOpponentModels(seat, allPlayers, discardPile);

  // Check if ANY opponent is near tenpai
  const anyNearTenpai = opponentModels.some(m => m && m.nearTenpai);

  // If already in tenpai ourselves: only discard tiles we're not waiting for
  const myWaits = getTenpaiTiles(safe, melds);
  if (myWaits.length > 0) {
    // In tenpai — pick the discard that maintains tenpai AND is safest
    // (This shouldn't happen normally but handle gracefully)
    return safeDiscard(safe, melds, discardPile, seat, opponentModels)
        || safe[safe.length - 1];
  }

  // Pure defensive mode: someone is very close, play safe
  const anyVeryClose = opponentModels.some(m => m && m.tilesLeft <= 1);
  if (anyVeryClose) {
    return safeDiscard(safe, melds, discardPile, seat, opponentModels)
        || aiChooseDiscardExpert(hand, melds, discardPile);
  }

  // Mixed mode: score each candidate discard on BOTH dimensions
  let bestDiscard = null;
  let bestScore   = -Infinity;

  // Detect our own hand direction (same as Expert)
  const allTiles = [...safe, ...melds.flatMap(m => m.tiles)];
  const suitCounts = {};
  for (const t of allTiles) {
    if (['bamboo','circle','char'].includes(t.suit))
      suitCounts[t.suit] = (suitCounts[t.suit] || 0) + 1;
  }
  const dominantEntry = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0];
  const dominantSuit  = dominantEntry?.[0];
  const dominantPct   = dominantEntry
    ? dominantEntry[1] / Math.max(Object.values(suitCounts).reduce((a,b)=>a+b,0), 1)
    : 0;
  const pursuePure = dominantPct >= 0.75 && melds.length <= 2;

  // Seven pairs potential
  const counts = countMap(safe);
  const pairCount = Object.values(counts).filter(c => c >= 2).length;
  const sevenPairs = pairCount >= 4 && melds.length === 0;

  for (let i = 0; i < safe.length; i++) {
    const t = safe[i];
    const without = [...safe.slice(0, i), ...safe.slice(i + 1)];

    // Hand efficiency score (same as Expert)
    let score = evalHand(without, melds) * 2;

    // Concealed tenpai bonus
    const waitsAfter = getTenpaiTiles(without, melds);
    if (waitsAfter.length > 0 && melds.length === 0) score += 25;
    else if (waitsAfter.length > 0) score += 15;

    // Pure suit bonus
    if (pursuePure && dominantSuit) {
      if (['bamboo','circle','char'].includes(t.suit) && t.suit !== dominantSuit) score += 18;
      if (t.suit === 'wind' || t.suit === 'dragon') score += 10;
    }

    // Seven pairs: discard singles, keep pairs
    if (sevenPairs) {
      const k = `${t.suit}|${t.value}`;
      const cnt = counts[k] || 0;
      if (cnt === 1) score += 12;
      else if (cnt >= 2) score -= 20;
    }

    // === LEVEL 4 ADDITION: subtract danger score ===
    // Weight danger vs efficiency:
    //  - Early game (many tiles left): weight efficiency more
    //  - Late game (opponents near tenpai): weight safety more
    const dangerWeight = anyNearTenpai ? 2.0 : 0.8;
    const risk = tileRiskScore(t, seat, opponentModels);
    score -= risk * dangerWeight;

    // Bonus for discarding tiles already in the pile (safe plays)
    const discardCounts = {};
    for (const d of (discardPile || [])) {
      const k2 = `${d.suit}|${d.value}`;
      discardCounts[k2] = (discardCounts[k2] || 0) + 1;
    }
    const alreadyOut = discardCounts[`${t.suit}|${t.value}`] || 0;
    score += alreadyOut * (anyNearTenpai ? 6 : 2);

    if (score > bestScore) { bestScore = score; bestDiscard = t; }
  }

  return bestDiscard || safe[safe.length - 1];
}

/**
 * Level 4 claim decision: considers whether claiming exposes hand direction,
 * whether we need faan from concealment, and opponent danger.
 */
function aiClaimDecisionLevel4(seat, hand, melds, discard, seatDiff, ctx, discardPile, allPlayers) {
  const winCtx = { ...ctx, selfDraw: false };
  const handWith = [...hand, discard];
  const result = canWin(handWith, melds, winCtx);
  const minF = (typeof MIN_FAAN !== 'undefined') ? MIN_FAAN : 2;

  // Always win
  if (result.win && result.faan >= minF) return 'win';

  // Kong
  if (hand.filter(t => sameType(t, discard)).length === 3) return 'kong';

  // Build opponent models to assess danger
  const opponentModels = buildOpponentModels(seat, allPlayers, discardPile);
  const anyNearTenpai  = opponentModels.some(m => m && m.nearTenpai);

  // In defensive mode, don't claim — just pass
  if (anyNearTenpai) {
    // Exception: if we're also very close, claim to race them
    const myWaits = getTenpaiTiles(hand, melds);
    if (myWaits.length === 0 && melds.length < 2) return null;
  }

  // Concealed tenpai — don't break it
  const concealedWaits = getTenpaiTiles(hand, melds);
  if (concealedWaits.length > 0 && melds.length === 0) return null;

  // Seven pairs potential
  const pairCount = Object.values(countMap(hand)).filter(c => c >= 2).length;
  if (pairCount >= 5 && melds.length === 0) return null;

  // Pure suit: only claim in-suit tiles
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const suitCounts = {};
  for (const t of allTiles) {
    if (['bamboo','circle','char'].includes(t.suit))
      suitCounts[t.suit] = (suitCounts[t.suit] || 0) + 1;
  }
  const dominant = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0];
  const pursuePure = dominant && (dominant[1]/Math.max(allTiles.length,1)) >= 0.75;
  if (pursuePure) {
    if (!['bamboo','circle','char'].includes(discard.suit)) return null;
    if (discard.suit !== dominant[0]) return null;
  }

  // Pung: only if leads to tenpai (strict — Level 4 is patient)
  if (hand.filter(t => sameType(t, discard)).length >= 2) {
    const newMeld = { type:'pung', tiles:[discard,discard,discard] };
    const without = removeFromHandN(hand, discard, 2);
    const waits   = getTenpaiTiles(without, [...melds, newMeld]);
    if (waits.length > 0) return 'pung';
    // Also pung if we have 3 melds already — one more and we win
    if (melds.length >= 3) return 'pung';
  }

  // Chow: only if immediately tenpai AND safe to reveal hand direction
  if (seatDiff === 1 && ['bamboo','circle','char'].includes(discard.suit)) {
    const chowMeld = findChowWith(hand, discard);
    if (chowMeld) {
      const fromHand = chowMeld.filter(t => t !== discard);
      const remaining = removeFromHandList(hand, fromHand);
      const newMelds  = [...melds, { type:'chow', tiles:chowMeld }];
      const waits     = getTenpaiTiles(remaining, newMelds);
      if (waits.length > 0 && melds.length >= 2) return 'chow';
    }
  }

  return null;
}


// ============================================================
// OPEN HANDS: group tiles by their role in the AI's best plan
// Returns a map of tileId → 'complete'|'pair'|'partial'|'isolated'
// ============================================================
function getHandGroupings(hand, melds) {
  const result = {};
  const safe = hand.filter(t => !isBonus(t));

  // Check tenpai first
  const waits = getTenpaiTiles(safe, melds);
  const inTenpai = waits.length > 0;

  // Count tile occurrences
  const counts = {};
  for (const t of safe) {
    const k = `${t.suit}|${t.value}`;
    counts[k] = (counts[k] || 0) + 1;
  }

  // Mark pungs/quads as 'complete'
  const marked = new Set();
  for (const t of safe) {
    const k = `${t.suit}|${t.value}`;
    if (counts[k] >= 3) {
      result[t.id] = 'complete';
      marked.add(t.id);
    }
  }

  // Mark pairs as 'pair'
  for (const t of safe) {
    if (marked.has(t.id)) continue;
    const k = `${t.suit}|${t.value}`;
    if (counts[k] === 2) {
      result[t.id] = 'pair';
      marked.add(t.id);
    }
  }

  // Find chow sequences
  const remaining = safe.filter(t => !marked.has(t.id));
  const usedInSeq = new Set();
  for (const t of remaining) {
    if (usedInSeq.has(t.id)) continue;
    if (!['bamboo','circle','char'].includes(t.suit)) continue;
    const n = t.value;
    const t2 = remaining.find(x => !usedInSeq.has(x.id) && x.suit === t.suit && x.value === n+1 && x.id !== t.id);
    const t3 = t2 && remaining.find(x => !usedInSeq.has(x.id) && x.suit === t.suit && x.value === n+2 && x.id !== t.id && x.id !== t2.id);
    if (t2 && t3) {
      result[t.id] = result[t2.id] = result[t3.id] = 'complete';
      usedInSeq.add(t.id); usedInSeq.add(t2.id); usedInSeq.add(t3.id);
    }
  }

  // Partial sequences (2 in a row or 2 apart)
  const stillFree = safe.filter(t => !marked.has(t.id) && !usedInSeq.has(t.id));
  const usedInPartial = new Set();
  for (const t of stillFree) {
    if (usedInPartial.has(t.id)) continue;
    if (!['bamboo','circle','char'].includes(t.suit)) continue;
    const n = t.value;
    for (const step of [1, 2]) {
      const t2 = stillFree.find(x => !usedInPartial.has(x.id) && x.suit === t.suit && x.value === n+step && x.id !== t.id);
      if (t2) {
        result[t.id] = result[t2.id] = 'partial';
        usedInPartial.add(t.id); usedInPartial.add(t2.id);
        break;
      }
    }
  }

  // Everything else = isolated
  for (const t of safe) {
    if (!result[t.id]) result[t.id] = 'isolated';
  }

  return result;
}
