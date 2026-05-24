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

### Concealed Kong 暗槓
Draw your 4th matching tile with no claimed melds → click **Kong 槓**.  
Appears as **[■][■][■][face]** — concealed hand bonus preserved.  
A replacement tile is drawn. Claiming any tile later reveals the kong and loses the bonus.

### Heavenly Hand 天胡
Dealer wins by self-draw on the very first tile. Maximum faan.

### Earthly Hand 地胡
Non-dealer wins on the dealer's very first discard. Maximum faan.

### Last Tile 海底撈月
Enable with **Last Tile 海底** checkbox. Self-draw the very last wall tile to complete your hand → maximum faan.

### Robbing the Kong 搶槓
When a player upgrades a Pung to Kong with a self-drawn tile, any player who can win with that tile may rob it. The header announces the opportunity. +1 faan bonus.

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

## Demo Buttons

| Button | What it sets up |
|---|---|
| **Demo Left 💡** | Cycles through winning hands for each seat and dealer position |
| **Demo Rob 搶槓** | Cycles through four Robbing the Kong scenarios |
| **Demo 天胡** | Dealer has a winning hand ready on first draw |
| **Demo 地胡** | CPU1 is dealer and discards the tile you need to win |
| **Demo 暗槓** | You hold four of a kind with no claimed melds — click Kong 槓 |
| **Demo 海底** | Wall drains to one tile; Last Tile toggled on automatically |

---

## Cantonese Rules Summary

- **144 tiles**: Bamboo / Characters / Dots 1–9 (×4 each), Winds East/South/West/North (×4 each), Dragons Red/Green/White (×4 each), Flowers 梅蘭菊竹 and Seasons 春夏秋冬 (×1 each)
- **Winning hand** = four sets (chow / pung / kong) + one pair
- **Discard win 出銃**: the discarder pays the full amount; others pay nothing
- **Self-draw 自摸**: all three opponents each pay equally
- Dealer keeps the deal on a win; rotates counter-clockwise otherwise
- Round wind advances after all four players have held East

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
| `score.html` | Live score and game log |
| `rules.html` | Full rules reference |
| `scenario.html` | Scenario Builder — developer test tool |
| `styles.css` | All styling |
| `js/tiles.js` | Tile definitions and display helpers |
| `js/scoring.js` | Win detection and faan scoring engine |
| `js/ai.js` | CPU opponent logic — four skill levels including opponent-aware Master |
| `js/game.js` | Game state machine |
| `js/ui.js` | Rendering and input handling |
| `js/main.js` | Startup, UI wiring, demo buttons, scenario injection |
