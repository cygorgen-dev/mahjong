// ============================================================
// schemes.js — User-defined auto-play strategy schemes
//
// Each scheme drives the YOU seat in auto mode.
// Duplicate an entry, give it a new id/name, and tweak the knobs.
//
// discard.pursue options : 'speed' | 'pure-suit' | 'seven-pairs' | 'pung-heavy'
// discard.suitLock       : null | 'bamboo' | 'circle' | 'char'
// discard.honorPenalty   : 0–5  (higher = dump honors sooner)
// discard.terminalPenalty: 0–5  (higher = dump 1s/9s sooner)
// discard.safetyLevel    : 0.0–1.0  (0=ignore danger, 1=max defensive)
//
// claim.pung / .chow options:
//   'always'         — always claim
//   'if-useful'      — claim if it leads to tenpai, 2+ melds, or good hand score
//   'if-tenpai'      — only if claim puts you immediately in tenpai
//   'if-own-flower'  — chow only: also needs no bonus tiles OR own seat flower/season,
//                      AND hand must have a discard that isn't the same tile just claimed
//   'never'          — never claim
//
// claim.winMinFaan   : 0 = use game Min Faan setting; N = require at least N faan
// claim.protectConcealed  : skip all claims (except win) if already concealed tenpai
// claim.protectSevenPairs : skip all claims (except win/kong) if 4+ pairs, no melds
// ============================================================

const SCHEMES = [

  // ---- 1. Baseline: mirrors the built-in Beginner AI exactly ----
  {
    id: 'beginner-copy',
    name: '🟢 Beginner Copy',
    desc: 'Speed to tenpai, claim freely, no faan goal — mirrors Beginner AI',
    discard: { pursue: 'speed',  suitLock: null, honorPenalty: 1, terminalPenalty: 0.5, safetyLevel: 0.0 },
    claim:   { pung: 'if-useful', chow: 'if-useful', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 2. Own-flower chow: chow only when flower conditions are met ----
  {
    id: 'own-flower-chow',
    name: '🌸 Own Flower Chow',
    desc: 'Like Beginner but chow only when no bonus tiles or own seat flower/season present, and there is a safe tile to discard afterwards',
    discard: { pursue: 'speed',  suitLock: null, honorPenalty: 1, terminalPenalty: 0.5, safetyLevel: 0.0 },
    claim:   { pung: 'if-useful', chow: 'if-own-flower', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 3. Pure Suit: auto-detect dominant suit and stay in it ----
  {
    id: 'pure-suit-auto',
    name: '🎯 Pure Suit (auto)',
    desc: 'Lock onto the most common suit in hand and dump everything else; pung freely, chow in-suit only',
    discard: { pursue: 'pure-suit', suitLock: null, honorPenalty: 2, terminalPenalty: 1, safetyLevel: 0.0 },
    claim:   { pung: 'if-useful', chow: 'if-useful', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 4. Pure Bamboo ----
  {
    id: 'pure-bamboo',
    name: '🎋 Pure Bamboo',
    desc: 'Force bamboo suit; dump any non-bamboo tile immediately',
    discard: { pursue: 'pure-suit', suitLock: 'bamboo', honorPenalty: 3, terminalPenalty: 1, safetyLevel: 0.0 },
    claim:   { pung: 'if-useful', chow: 'if-useful', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 5. Pure Circle (Dots) ----
  {
    id: 'pure-circle',
    name: '🔵 Pure Circle',
    desc: 'Force circle/dots suit; dump any non-circle tile immediately',
    discard: { pursue: 'pure-suit', suitLock: 'circle', honorPenalty: 3, terminalPenalty: 1, safetyLevel: 0.0 },
    claim:   { pung: 'if-useful', chow: 'if-useful', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 6. Pure Characters ----
  {
    id: 'pure-char',
    name: '🀇 Pure Char',
    desc: 'Force character suit; dump any non-character tile immediately',
    discard: { pursue: 'pure-suit', suitLock: 'char', honorPenalty: 3, terminalPenalty: 1, safetyLevel: 0.0 },
    claim:   { pung: 'if-useful', chow: 'if-useful', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 7. Pung Hunter: all triplets, never chow ----
  {
    id: 'pung-hunter',
    name: '💪 Pung Hunter',
    desc: 'Keep pairs and trips, dump isolated tiles; always pung, never chow',
    discard: { pursue: 'pung-heavy', suitLock: null, honorPenalty: 0, terminalPenalty: 0, safetyLevel: 0.0 },
    claim:   { pung: 'always', chow: 'never', kong: true, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: false }
  },

  // ---- 8. Seven Pairs: keep pairs, discard singles, never claim ----
  {
    id: 'seven-pairs',
    name: '🀀 Seven Pairs',
    desc: 'Pursue seven pairs; discard singles, keep all pairs, never pung or chow',
    discard: { pursue: 'seven-pairs', suitLock: null, honorPenalty: 0, terminalPenalty: 0, safetyLevel: 0.0 },
    claim:   { pung: 'never', chow: 'never', kong: false, winMinFaan: 0,
               protectConcealed: false, protectSevenPairs: true }
  },

  // ---- 9. Concealed: protect hidden hand, only claim at tenpai ----
  {
    id: 'concealed',
    name: '🤫 Concealed',
    desc: 'Speed pursuit but never break concealed tenpai; only pung/chow when it immediately creates tenpai; wins at game min faan',
    discard: { pursue: 'speed',  suitLock: null, honorPenalty: 1, terminalPenalty: 0.5, safetyLevel: 0.0 },
    claim:   { pung: 'if-tenpai', chow: 'if-tenpai', kong: true, winMinFaan: 0,
               protectConcealed: true, protectSevenPairs: false }
  },

  // ---- 10. Cautious: balanced safety + tenpai discipline ----
  {
    id: 'cautious',
    name: '🛡️ Cautious',
    desc: 'Speed pursuit with moderate safety awareness; protect concealed tenpai; only pung at tenpai',
    discard: { pursue: 'speed',  suitLock: null, honorPenalty: 2, terminalPenalty: 1, safetyLevel: 0.5 },
    claim:   { pung: 'if-tenpai', chow: 'never', kong: true, winMinFaan: 0,
               protectConcealed: true, protectSevenPairs: false }
  }

];

// Active user scheme for the YOU seat in auto mode. null = use level-based AI.
if (typeof USER_SCHEME === 'undefined') var USER_SCHEME = null;
