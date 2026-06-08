# Cantonese Mahjong 廣東麻雀

A fully playable **Hong Kong Cantonese Mahjong** game that runs in any modern web browser.  
No install, no server, no build step required.

---

## How to Run

1. Open the project folder.
2. Double-click **`index.html`** — it opens in your default browser.
3. That's it. No `npm install`, no Python, no backend needed.

**Recommended screen:** 1920×1080 or larger. The game auto-scales to fit smaller screens.

---

## How to Play

| Action | How |
|---|---|
| **Discard a tile** | Click any tile in your hand during your turn |
| **Self-Kong** | Click **Kong 槓** during your discard turn when you have 4 of a kind |
| **Claim a discard** | Use **Win 胡 / Chow 上 / Pung 碰 / Kong 槓** buttons when lit |
| **Pass** | Click **Pass 過** — always safe, skips the current action |
| **Hint** | Click **Hint 💡** during your turn for an Expert-level suggestion |
| **Next hand** | Pass becomes **Next Hand ▶** after each round ends |
| **New game** | Click **New Game** — resets scores to Start Pts |
| **Score & log** | Click **Score 📊** — opens in a new tab, auto-refreshes |
| **Rules** | Click **Rules** for full scoring reference |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| **Min Faan** | 2 | Minimum faan needed to declare a win |
| **Max Faan** | 7 | Maximum faan counted for payout (0 = unlimited) |
| **Start Pts** | 2000 | Starting points per player |
| **7 Pairs** | On | Enable Seven Pairs 七對子 as a winning hand |
| **Show Labels** | On | Show English labels on tiles |
| **Show (wind)** | Off | Show wind info in parentheses in seat labels |
| **Last Tile 海底** | Off | Enable Last Tile 海底撈月 special win |
| **Open Hands 明牌** | Off | Show all CPU hands face-up; with Level 3+, color-codes each tile by its role in the AI's plan |
| **CPU Skills** | All Beginner | Set skill level per CPU player (1–4) |

---

## Auto Mode

Three large buttons in the sidebar replace the old dropdown:

| Button | Behaviour |
|---|---|
| **🧑 HUMAN** | You play manually. Click to stop auto-play immediately; use Pass to continue. |
| **🐢 SLOW** | CPU-You plays step by step — click Pass to advance each move. Good for studying. |
| **⚡ FAST** | Fully automatic — CPU-You plays at full speed. Click Pass at hand end to proceed. |

**CPU-You level** selector (always visible) sets which AI strategy the auto player uses for your seat.

---

## CPU Skill Levels

Each of the four CPU players (including CPU-You in auto mode) can be set independently.

### 🟢 Beginner
- Discards whatever gets to tenpai fastest
- Claims Pung, Chow, Kong aggressively
- No awareness of suit purity or special patterns

### 🟡 Intermediate
- Recognises Seven Pairs potential (5+ pairs → pursues it)
- Notices suit direction and avoids breaking it
- More selective claiming — only Pungs if it leads to tenpai

### 🔴 Expert
- Won't claim anything if already in concealed tenpai — waits for self-draw bonus
- Pursues Pure One Suit aggressively
- Uses the discard pile for safety scoring — prefers throwing tiles already played by others
- Only Pungs/Chows when tenpai is the immediate result

### 🔥 Master (Level 4) — Opponent-aware
The only level that watches other players, not just its own hand.

**Suit absence detection:** If an opponent has discarded 6+ tiles with zero bamboo — they're hoarding bamboo. Master avoids discarding bamboo to them.

**Meld reading:** After an opponent claims Chow 3-4-5 bamboo, tiles 2 and 6 bamboo become hot. After a Pung, the 4th copy and adjacent tiles are marked dangerous.

**Near-tenpai detection:** When any opponent has ≤2 tiles left or 3+ melds, Master switches to defensive mode — it scores every candidate discard on both hand efficiency AND danger to opponents, weighted heavily toward safety.

**Pure defensive mode:** If someone has ≤1 tile remaining, Master plays only proven-safe tiles (already in the discard pile).

**Patient claiming:** In defensive situations, Master passes rather than reveals its hand direction. It only claims if already near tenpai itself.

> **Known AI balance issue (open):** Master underperforms against three Beginners (~13% wins vs ~22% each for Beginners). The defensive strategy is calibrated for opponent-aware play but misfires when opponents discard randomly with no pattern. A future fix would add a "threat level fallback" — when opponents show no discernible danger signals, play more aggressively. See `combo.js` calibration runs for data.

---

## Open Hands 明牌

Enable in Settings. All CPU hand tiles flip face-up.

For Level 3+ players each tile is also **colour-coded** by its role in the AI's current plan:

| Colour | Meaning |
|---|---|
| 🟩 Green outline | Part of a complete set (chow or pung already formed in hand) |
| 🟨 Gold outline | A pair — potential pung or the winning eye |
| 🟦 Blue outline | Part of a partial sequence — waiting for one more tile |
| Dimmed (70%) | Isolated — likely to be discarded soon |

Use Open Hands with Slow auto mode to watch the AI think in real time.

---

## Win Priority & Hijacking

When multiple players can win from the same discard, **the player closest counter-clockwise to the discarder wins** — they "hijack" the others.

Seat order from any discard: next seat → next → next (counter-clockwise).  
The Right player (seat 1) is always closer to most discards than You — but You can never be hijacked by the Right player from a Left or Top discard.

When your win is hijacked, the header shows:  
**"⚠️ Win hijacked by Left 左 — Pass to continue"**  
The Pung/Kong/Chow buttons are disabled (the hand is ending).

Position names are fixed geometry regardless of which CPU rotates where:
- Seat 1 = **Right 右**
- Seat 2 = **Top 上**
- Seat 3 = **Left 左**

---

## Hint System 💡

Click **Hint 💡** at any time during your turn. The hint engine tells you:

- **What to discard** and the reason (tenpai speed, suit direction, safety)
- **Whether to Kong** if you have four of a kind
- **What hand you are building** — Seven Pairs, Pure One Suit, All Triplets, etc.
- **Your tenpai waits** — which tiles complete your hand right now

The hint never plays for you. It only advises.

---

## Special Rules

### Deal Order (Cantonese rules)
The dealer receives **14 tiles**; all other players receive **13**. Bonus tile replacement then proceeds **round-robin**: dealer replaces first, then each player counter-clockwise in turn. Replacement tiles drawn during a round are not replaced until the next round. This continues until nobody draws a bonus tile. The dealer then discards immediately — no extra draw. Multiple rounds of replacement (3+) are supported.

### Concealed Kong 暗槓
Draw your 4th matching tile with no claimed melds → click **Kong 槓**.  
Appears as **[■][■][■][face]** — concealed hand bonus preserved.  
A replacement tile is drawn. Claiming any tile later reveals the kong and loses the bonus.

### Heavenly Hand 天胡
Dealer wins with their initial 14 dealt tiles before making any discard. Maximum faan. The entire 14-tile hand is checked — there is no single "drawn" tile.

### Earthly Hand 地胡
Non-dealer wins on the dealer's very first discard (before anyone else has drawn). Maximum faan.

### Last Tile 海底撈月
Enable with **Last Tile 海底** checkbox. Self-draw the very last wall tile to complete your hand → maximum faan.

### Robbing the Kong 搶槓
When a player upgrades a Pung to Kong with a self-drawn tile, any player who can win with that tile may rob it. The header announces the opportunity. +1 faan bonus.

### Seat Rotation
After every complete 4-wind-round game, the three CPU players are **randomly reshuffled** among seats 1–3 (You always remain at seat 0). The last hand's winner becomes the starting dealer. A new shuffle is retried if positions are unchanged.

---

## Scenario Builder (Developer Tool)

Open from Dev Tools → **🧪 Scenario Tester** — loads `scenario.html` in a new tab.

### Building a scenario
1. Select a player (You / CPU1 / CPU2 / CPU3) — all 4 hands visible at once
2. Click tiles in the palette to add them directly — no popups
3. Use **Quick Actions** for fast meld setup:
   - **Pung ×3 → Meld**: click button then ONE tile → 3 copies as a pung meld
   - **Kong ×4 → Meld**: click button then ONE tile → 4 copies as a kong meld
   - **Chow (pick 3)**: click button then 3 tiles in sequence → chow meld
   - **Self Draw 🀄**: next tile added is marked as the drawn tile (orange)
   - **Bonus 花**: next tile goes to bonus area
   - **Next pick → Discard tile**: sets the face-up discard on the table
4. Set Game Context (discard from, phase, dealer)
5. Click **⚡ Inject** — the game tab picks it up within ~2 seconds

### 📸 Capture State
In the main game, click **📸 Capture State** in Dev Tools at any interesting moment.  
The full live state (all 4 hands, melds, discard, phase) is captured and pre-loaded into the Scenario Builder automatically. Name it and save — your regression suite grows from real gameplay.

### Save / Load / Regression
- **Save**: name a scenario and click Save → stored in browser localStorage
- **Load**: one click to restore any saved scenario into the builder
- **Export JSON**: download all saved scenarios as a backup file
- **Import JSON**: restore from a backup file
- **▶ Run All**: injects every saved scenario in sequence, polls for results, reports pass/fail — fully automated regression testing

Saved scenarios persist across browser sessions as long as localStorage is not cleared.  
The exported JSON file is the permanent backup — import it any time to restore your full test suite.

### Expected results (for regression)
Set the checkboxes (Win / Pung / Kong / Chow) before saving to record what buttons *should* light up. The regression runner compares actual vs expected and marks each test PASS or FAIL.

---

## Replay Mode vs Scenario Mode

Two distinct modes govern how a saved `.json` file is loaded and played back.

### Replay Mode (`REPLAY_MODE = true`)

Set when a file is loaded without `"scenario": true`.

- **Paced playback.** Every move requires a user action — click anywhere / Pass, or use **⏩ Auto Step** (180 ms per move).
- **Queue-driven.** Recorded human moves are stored in `window._moveQueue`. Each `replayStep()` call pops one move and executes it. CPU players replay via their own AI from the same wall — only the human's decisions are recorded and replayed.
- **Continues into normal play.** When the queue empties the game exits replay mode automatically and normal human + CPU play resumes from that point. There is no hard stop.
- **Save at any time.** The **💾 Save Hand** button snapshots `_captureWall / _captureDice / _captureMoves / log` instantly — you do not need to wait for WIN or EXHAUST.
- **Undo Last Move.** The **↩ Undo Last Move** button re-deals from the same wall and instant-replays all captured moves minus the last one, then exits replay mode so you can replay the decision.

**Typical uses:** reviewing a past hand; loading a mid-game save to continue from a known position; studying a specific sequence of moves.

### Scenario Mode (`REPLAY_MODE = false`, `"scenario": true`)

Set when a file has `"scenario": true` in the JSON.

- **Immediate normal play.** No step-by-step playback. The game re-deals from the forced wall and all four players act normally at full speed.
- **Queue is still set** from the scenario's move list, but those moves execute as part of the normal AI / human input flow — not via `replayStep()`.
- **No controlled stepping.** The Auto Step button is disabled; clicking Pass has normal game meaning.

**Typical uses:** setting up a repeatable test state (forced wall, specific tile distributions) that the regression runner can inject and verify.

### File format distinction

| Field | Replay file | Scenario file |
|---|---|---|
| `"scenario"` | absent / `false` | `true` |
| `"wall"` + `"dice"` | required | required |
| `"moves"` / `"log"` | required (can be empty for a fresh re-deal) | required |
| `"expected"` | — | optional — for regression (winnerSeat, etc.) |

Any file with `wall` + `dice` can be loaded. The `moves` / `log` guard was removed in v0608-483 — a file with an empty moves array simply re-deals from the saved wall with no pre-played moves.

---

## Demo Buttons

Access via **More tools…** dropdown in the sidebar.

| Button | What it sets up |
|---|---|
| **Demo Left 💡** (main sidebar) | Cycles winning hands for each seat and dealer position |
| **Demo Rob 搶槓** | Cycles four Robbing the Kong scenarios (Human robs / AI robs / Both / Nobody) |
| **Demo 天胡** | Dealer's 14 dealt tiles form a winning hand — Heavenly Hand |
| **Demo 地胡** | CPU1 is dealer and discards the tile you need to win — Earthly Hand |
| **Demo 暗槓** | You hold four of a kind with no claimed melds — click Kong 槓 |
| **Demo 海底** | Wall drains to one tile; Last Tile toggled on automatically |
| **Test: Rob Win 搶槓胡** | CPU1 upgrades pung→kong; CPU3 is in position to rob |
| **Test: Kong Completes 槓完** | CPU1 upgrades pung→kong; nobody can rob; game continues |
| **📋 Hand Log ↗** | Opens `hand.html` — the persistent hand-by-hand log |
| **🗑 Clear Hand Log** | Resets the hand log to a single current-strategy entry |
| **🧪 Run All Tests** | Runs the 14 in-browser demo/dev-tool tests; results in floating panel and `window._testResults` |

---

## Testing & Calibration

### Running tests

```bash
npm test               # Full suite: 8 regression scenarios + 14 demo tests (23 total)
node run_check.js      # Same as npm test — the canonical test runner
node run_regression.js # Regression scenarios only (8 tests)
```

The **in-browser test button** (`#run-all-tests-btn`, Dev Tools → More tools → 🧪 Run All Tests) runs the 14 demo tests only and is useful for quick in-game checks. For the full 23-test suite use `node run_check.js`.

### Calibration runs — `combo.js`

Runs a sprint of N hands with configurable skill levels per seat:

```bash
node combo.js <seat0> <seat1> <seat2> <seat3> <hands>
# e.g. node combo.js 4 1 1 1 400  → Master vs 3 Beginners, 400 hands
# e.g. node combo.js 3 3 3 3 200  → all Expert, 200 hands

# Named flags also work:
node combo.js --you 4 --cpus 1 --hands 400
```

Levels: 1=Beginner, 2=Inter, 3=Expert, 4=Master.  
Logs to `combo_<levels><hands>.log`. Reports win %, avg faan, and point deltas every 25 hands.

### Batch runs — `run_all.js`

Runs a predefined set of 12 configurations sequentially and prints a combined summary:

```bash
node run_all.js
```

---

## Cantonese Rules Summary

- **144 tiles**: Bamboo / Characters / Dots 1–9 (×4 each), Winds East/South/West/North (×4 each), Dragons Red/Green/White (×4 each), Flowers 梅蘭菊竹 and Seasons 春夏秋冬 (×1 each)
- **Winning hand** = four sets (chow / pung / kong) + one pair
- **Deal**: dealer receives 14 tiles, others receive 13; bonus replacement is round-robin
- **Discard win 出銃**: the discarder pays the full amount; others pay nothing
- **Self-draw 自摸**: all three opponents each pay equally
- **Dealer retention**: a winning dealer keeps the deal — dealership only passes on a loss or draw
- **Wind round**: completes when all four players have been dealer at least once (minimum 4 hands, but extended by dealer wins — a hot dealer can hold the deal for many consecutive hands)
- **Round wind** advances after each complete wind round; four wind rounds (East→South→West→North) constitute one full game
- **Seat reshuffle** after each complete game; the last hand's winner becomes the new East dealer

---

## Faan Scoring

### Hand bonuses

| Hand | Faan |
|---|---|
| Common Hand 平胡 (all chows, discard win only) | 1 |
| Self Draw 自摸 | 1 |
| Concealed 門清 (no claimed melds) | 1 |
| No Flowers 無花 (zero bonus tiles) | 1 |
| Own Flower 正花 (flower matches your seat) | 1 |
| Own Season 正季 (season matches your seat) | 1 |
| Dragon Pung 箭刻 (each) | 1 |
| Seat Wind Pung 門風刻 | 1 |
| Round Wind Pung 圈風刻 | 1 |
| Robbed Kong 搶槓 | +1 |
| Mixed One Suit 混一色 | 3 |
| All Triplets 對對胡 | 3 |
| Seven Pairs 七對子 | 4 |
| Small Dragons 小三元 | 5 |
| Small Winds 小四喜 | 6 |
| Pure One Suit 清一色 | 7 |
| Big Dragons 大三元 | 8 |
| All Honors 字一色 | 10 |
| Big Winds 大四喜 | 13 |
| Thirteen Orphans 十三么 | 13 |
| Heavenly Hand 天胡 | Max faan |
| Earthly Hand 地胡 | Max faan |
| Last Tile 海底撈月 | Max faan |

### Bonus tile scoring

| Situation | Faan |
|---|---|
| Own Flower or Season (matches your seat) | 1 each |
| All four Flowers 百花齊放 | +1 extra |
| All four Seasons 四季如春 | +1 extra |
| Seven bonus tiles 七花齊放 | Flat 3 faan |
| Eight bonus tiles 八仙過海 | Flat 13 faan (capped by Max Faan) |

---

## Faan → Points

| Faan | Self-draw (each opponent pays) | Discard win (discarder pays total) |
|---|---|---|
| 2 | 8 | 16 |
| 3 | 16 | 32 |
| 4 | 32 | 64 |
| 5 | 48 | 96 |
| 6 | 64 | 128 |
| 7 | 96 | 192 |
| 8+ | 96 cap | 192 cap |

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Main game page |
| `hand.html` | Persistent hand-by-hand log — opens from Dev Tools → More tools |
| `score.html` | Live score and game log |
| `rules.html` | Full rules reference |
| `scenario.html` | Scenario Builder — developer test tool |
| `styles.css` | All styling |
| `js/tiles.js` | Tile definitions and display helpers |
| `js/scoring.js` | Win detection and faan scoring engine |
| `js/ai.js` | CPU opponent logic — four skill levels including opponent-aware Master |
| `js/game.js` | Game state machine |
| `js/ui.js` | Rendering and input handling |
| `js/main.js` | Startup, UI wiring, demo buttons, scenario injection, in-browser test runner |
| `js/handlog.js` | Hand log recording — writes every hand result and strategy change to localStorage |
| `js/schemes.js` | User-defined auto-play strategy schemes |
| `combo.js` | Sprint calibration runner — configurable levels per seat, per-run log files |
| `run_check.js` | **Full 23-test suite** — 8 regression scenarios + 14 demo tests; `npm test` |
| `run_regression.js` | Regression scenario runner — 8 scenario tests only |
| `test_all.js` | Legacy alias — same as `run_check.js` |

---

## Notes for AI Agents & Future Developers

### Architecture overview

- **No build step, no bundler.** All JS is loaded as plain `<script>` tags in `index.html`. Changes to any `.js` file take effect immediately on reload.
- **Game state lives in `game` (a `let` in `main.js` module scope).** It is NOT on `window.game`. Access it from Playwright via `page.evaluate(() => eval('game'))`.
- **Sprint mode runs synchronously.** In `window.AUTO_MODE === 'sprint'`, `_scheduleOrStep(fn)` calls `fn()` immediately — the entire hand resolves in one call stack. This is why sprints are fast but can't be interrupted mid-hand.
- **CPU levels follow players by name, not seat.** `window.CPU_LEVELS_BY_NAME = { CPU1: n, CPU2: n, CPU3: n }` persists through seat rotations. `CPU_LEVELS[seat]` is refreshed from this map at the start of each `aiPlay` call.
- **YOU (seat 0) is always `isHuman=true`**, even in sprint auto mode. In auto mode, `startTurn` now routes seat 0 through the same CPU code path (`!window.AUTO_MODE` guard) to avoid any `isHuman` code-path bias in sprint statistics.

### Testing workflow for AI agents

- **Full suite (23 tests):** `node run_check.js` — the canonical single command.
- **In-browser only (14 tests):** click `#run-all-tests-btn`, poll `window._testResults.done === true`, read `window._testResults.details`.
- `window.game` is exposed directly — no need for `eval('game')`.

### Known open issues

- **Master AI vs Beginners balance**: In a 1v3 scenario (Master alone vs 3 Beginners), Master consistently wins only ~13% of hands while Beginners win ~20-25% each. The inverse also holds — a lone Beginner against 3 Masters wins ~22-24%. Root cause: Master's defensive strategy is calibrated for opponent-aware play. Against randomly-discarding Beginners it over-withholds tiles and misses winning opportunities. Fix: add a "low threat" fallback in `aiClaimDecisionLevel4` and `aiChooseDiscardLevel4` — when opponent danger signals are absent, revert to Expert-style aggressive play.
- **Seat rotation in calibration data**: `combo.js` reports wins by physical seat number. After `rotatePlayers()` fires (every ~16 hands), CPUs shuffle among seats 1–3 so a given seat's win rate reflects a mix of player levels over time. For clean per-level analysis, track wins by player name rather than seat.

### Key decisions made (session 2026-06-01) — v0601-362

- **Hand log improvements (`hand.html` + `js/handlog.js`):**
  - Column headers brightened so they are readable on the dark green background.
  - Score-delta sub-header changed from player names to `Seat0 / Seat1 / Seat2 / Seat3`; each hand entry records `seatOrder[]` so deltas render in the current seat assignment order. Seat rotation is directly observable — a new strategy block is automatically written whenever seat assignments change.
  - Strategy entries now record `mode` (`null`=HUMAN / `sprint` / `slow` / `fast`) and `seats[]`; rendered as `[HUMAN    ]  S0:You - Human   S1:CPU1 - Expert …` in seat order. All mode tags are padded to the same width so lines align.
  - You's AI level is shown accurately as the active AI level in AUTO/SPRINT mode (was always shown as `Human` regardless of mode).
  - Backward-compatible: old log entries without `seatOrder`, `mode`, or `seats` continue to render correctly.

### Key decisions made (session 2026-06-01) — v0601-361

- **Hand log (`hand.html` + `js/handlog.js`):** Every hand result (win or draw) and every strategy change (level or scheme) is recorded to localStorage under `mahjong-hand-log`. `hand.html` reads the log live and renders it as a monospace table with coloured winner/delta columns. Hand numbers restart at H001 after each strategy change. "📋 Hand Log ↗" and "🗑 Clear Hand Log" added to Dev Tools → More tools.
- **Test consolidation:** `run_check.js` is now the single 23-test entry point (replaces `test_all.js`). `npm test` updated accordingly. `window.game` is used directly in tests instead of `eval('game')`.
- **.gitignore tightened:** `node_modules/`, `package-lock.json`, `.claude/`, `verify_*.js`, `screenshot_*.js`, and other dev-only scripts suppressed so `git status` stays clean.

### Key decisions made (session 2026-05-31)

- **Deal order corrected**: Dealer now receives 14 tiles at deal time (was 13 + 1 drawn via `startTurn`). Round-robin bonus replacement replaces the old per-player exhaustive replacement. `deal()` in `game.js` was the change point.
- **Heavenly Hand fix**: `aiPlay` no longer requires `_justDrawn` when `isHeavenly` is true — with 14 tiles dealt at once, there is no single "drawn" tile. The `_justDrawn` guard remains for regular self-draw wins.
- **Auto seat rotation**: `nextDeal()` now calls `rotatePlayers()` automatically when the North wind round completes. Wind-round tracking uses `_roundStartDealer` (not hardcoded seat 0) so games starting at non-zero seats (after rotation) still run full 4-player wind rounds. Previously rotation was only available via the manual "Rotate Seats" UI button.
- **Sprint bias fix**: `startTurn` now uses `if (p.isHuman && !window.AUTO_MODE)` so in sprint/fast/slow auto modes the human seat takes exactly the same code path as CPU seats.
