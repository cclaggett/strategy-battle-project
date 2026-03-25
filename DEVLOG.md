# Strategy Battle — Dev Log

## 2026-03-16 — Session with Caleb Claggett

### Project Overview
- Phaser 3 browser game, turn-based strategy battle (hotseat 2-player)
- Located at `projects/strategy-game/`
- Served via Cloudflare tunnel for remote access

### Architecture
- `index.html` — entry point, loads Phaser + game scripts
- `src/data.js` — attack definitions, roster, damage formulas
- `src/TeamBuilderScene.js` — character/attack draft screen
- `src/BattleScene.js` — main battle logic
- `src/main.js` — Phaser config, scene list

### Features Built Today

**Team Builder (new)**
- Players draft from a roster of 8 characters: Knight, Mage, Cleric, Rogue, Warlock, Paladin, Ranger, Sorcerer
- Each player picks 3 characters (no duplicates between players)
- For each character, pick 3 attacks from their available pool (5-6 options each)
- Player 1 drafts first, then Player 2

**Switching (new)**
- Players can switch their active character instead of attacking
- Switches resolve before any attacks in the round
- Forced swap when active character is KO'd
- Green "⇄ Switch" button appears alongside attack options

**Existing Battle System**
- Turn-based hotseat (P1 picks, then P2, then round resolves)
- Speed stat determines attack order
- Physical attacks scale with ATK/DEF, magic with MAG/RES
- Healing scales with caster's MAG
- Team dots show alive/KO'd status
- Game over → click to restart back at team builder

### Attack Types
- Physical: Slash, Heavy Strike, Quick Slash, Shield Bash, Backstab, Cleave, Hamstring
- Magic: Fireball, Ice Spear, Thunder, Dark Pulse, Holy Smite, Arcane Blast
- Heal: Heal, Prayer

### Hosting Notes
- Python HTTP server on port 8081
- Cloudflare tunnel (`cloudflared`) for external access
- Browser caching can be an issue — hard refresh (Ctrl+Shift+R) after updates

**Stat Allocation (new)**
- After picking attacks, players allocate 50 bonus points across ATK, DEF, MAG, RES, SPD
- Max 20 points per stat
- Visual +/− buttons with bar display

**Stat Buff/Debuff Moves (new)**
- Status-only moves: War Cry, Iron Wall, Meditate, Focus, Quicken (self buffs); Intimidate, Expose, Hex (enemy debuffs)
- Some combat moves have secondary stat effects: Shield Bash (SPD↓), Hamstring (SPD↓), Dark Pulse (RES↓)
- Stacking: +1→×1.5, +2→×2.0, +3→×2.5; -1→×0.67, -2→×0.5, -3→×0.4
- Battle UI shows arrows (↑↓) on modified stats
- Switch menu shows active buffs/debuffs on benched characters

## 2026-03-18 — Session with Caleb Claggett

### Player HP System
- Each player has a health pool of 6 HP (pips displayed at top of screen)
- Player HP is reduced by:
  1. **KO penalty** — lose 1 player HP when a character is KO'd
  2. **Long-range attacks** — Ice Spear, Holy Smite, Arcane Blast can target the player directly (1 HP) instead of the opposing character
  3. **Spread attacks** — Fireball, Thunder hit the opposing character AND deal 1 HP to the opposing player
- **Win conditions**: KO all 3 enemy characters OR reduce opponent's player HP to 0

### Player Actions (new action each turn alongside character move)
- **Block** — absorbs 1 point of incoming player damage (used up after absorbing)
- **Heal** — restore 1 player HP (max 6)
- **Strike** — deal 1 player HP damage directly to opponent
- **Pass** — do nothing

### Protect Move (character move)
- Knight, Cleric, Paladin can pick `Protect` from their pool
- Absorbs 1 incoming player damage this turn (similar to block, from the character side)
- Uses the character's action for the turn (no attack/switch)

### Turn Flow (updated)
1. Player picks their personal action (Block/Heal/Strike/Pass)
2. Player picks their character's action (Attack/Switch)
3. Repeat for Player 2
4. Round resolves: player actions → switches → attacks (by speed)

### Data Externalized to JSON
- All character data, attacks, and player actions now live in `src/data.json`
- `data.js` loads from JSON at startup, formulas remain in JS
- Easy to tweak numbers without touching code

### Player Action Drafting
- Before picking characters, each player selects 3 player actions from a pool
- Pass is always free (no cooldown, always available)
- Available actions:
  - 🛡 Block (CD: 2) — absorb 1 player HP damage
  - 💚 Heal (CD: 2) — restore 1 player HP
  - ⚔ Strike (CD: 1) — deal 1 player HP to opponent
  - 🗡 Slash (CD: 2) — 20 power / 30 ATK physical hit on enemy character
  - ✨ Blast (CD: 2) — 20 power / 30 MAG magic hit on enemy character
  - 🏹 Shot (CD: 2) — 10 power / 30 ATK, can target character or player (1 HP)

### Cooldown System
- Player actions have cooldowns (turns before reuse)
- Cooldowns tick down at end of each round
- Greyed-out actions show remaining cooldown turns
- Pass always available with no cooldown

### Attack Tags
- 🌊 Spread: Fireball, Thunder
- 🎯 Long-range: Ice Spear, Holy Smite, Arcane Blast

## 2026-03-19 — Session with Caleb Claggett

### Modular Data File System
- Broke the single `data.json` into individual files under `src/data/`
- Structure: `src/data/{attacks,characters,player-actions}/` with one JSON file per entity
- Each folder has an `index.json` manifest listing all entity ids
- `data.js` loader fetches manifests then loads all entities in parallel
- To add new content: create a `.json` file in the right folder, add its id to `index.json`
- Old `data.json` still exists but is no longer used

### Team Save / Load System
- Players can save and recall teams using browser localStorage
- New **Team Choice Screen** at the start of each player's turn: "Build New Team" or load a saved one
- **Save Prompt** appears after completing team building with a full summary (characters, attacks, stat bonuses, player actions)
- Options: "💾 Save Team" (prompts for a name) or "Skip →"
- Saved teams store: characters (with selected attacks + stat allocation) + player actions
- Delete button (✕) on saved teams in the load screen
- Validation on load: checks characters/attacks still exist in data files, prevents duplicate character picks

### GitHub Repo
- Project pushed to https://github.com/jclaggett/strategy-battle (public)
- Can clone and run locally with any HTTP server

## 2026-03-20 — Session with Caleb Claggett

### Priority Bracket System
- Every attack now has a `priority` field (integer, -5 to +5)
- Higher priority brackets resolve first; speed breaks ties within bracket
- Current assignments: Protect +2, Quick Slash +1, most moves 0, Heavy Strike -1
- UI shows ⚡+N for positive priority, 🐢-N for negative on attack buttons

### Passive Ability System
- Event hook architecture: abilities declare a `trigger` and `effects`
- Triggers: `onEntry`, `onExit`, `onHit`, `onKO`, `onDealDamage`, `turnStart`, `turnEnd`
- Effects reuse existing patterns: `statFx`, `heal`, `playerHeal`
- Each character has 2 abilities to choose from during draft (new step after attack pick)
- `fireAbilityHooks(trigger, context)` called at all trigger points in battle flow
- Active ability shown in battle UI with ✦ symbol
- Abilities stored in `src/data/abilities/` (same modular pattern as attacks)

**Ability Roster:**
- Knight: Bulwark (DEF↑ when hit) / Battle Cry (ATK↑ on entry)
- Mage: Arcane Shield (RES↑ on entry) / Spellweaver (MAG↑ on deal dmg)
- Cleric: Divine Aura (heal 10 HP turn end) / Martyr (1 player HP on KO)
- Rogue: Ambush (SPD↑ on entry) / Poison Blade (enemy DEF↓ on deal dmg)
- Warlock: Soul Drain (heal 10 HP on deal dmg) / Curse Aura (enemy MAG↓ on entry)
- Paladin: Holy Shield (RES↑ when hit) / Avenger (ATK↑ when hit)
- Ranger: Swift Feet (SPD↑ turn end) / Hunter's Mark (enemy DEF↓ on entry)
- Sorcerer: Overcharge (SPD↑ on deal dmg) / Glass Canon (+2 MAG -1 DEF on entry)

### Damage Type System
- 5 elemental types: Fire 🔥, Ice ❄️, Lightning ⚡, Holy ✨, Dark 🌑
- Type chart in `src/data/types.json` — fully data-driven, easy to add new types
- Characters have 1-2 types, attacks have optional `damageType`
- Weakness = 2x damage, resistance = 0.5x (multipliers configurable in JSON)
- Dual-type: multipliers stack (e.g. weak+weak = 4x)
- Physical attacks without damageType are type-neutral (always 1x)
- Battle log shows "Super effective!" / "Not very effective..."
- Type emojis displayed on character names, attack buttons, and draft screen

**Type Chart:**
| Type | Weak to | Resists |
|------|---------|---------|
| Fire 🔥 | Ice | Fire, Holy |
| Ice ❄️ | Fire, Lightning | Ice |
| Lightning ⚡ | Dark | Lightning |
| Holy ✨ | Dark | Holy, Fire |
| Dark 🌑 | Holy, Lightning | Dark, Ice |

**Character Types:**
Knight ✨, Mage 🔥❄️, Cleric ✨, Rogue 🌑, Warlock 🌑🔥, Paladin ✨⚡, Ranger ❄️, Sorcerer ⚡🌑

## 2026-03-25 — Session with Caleb Claggett

### Multi-Turn Effects System
- New pending effects engine in BattleScene
- Two modes: **delay** (fires after N turns) and **duration** (fires each turn for N turns)
- Can combine both: delay then duration (e.g. delay 1 + duration 3 = starts after 1 turn, lasts 3)

**Design Decisions:**
1. **Position-based targeting** — effects target a *slot* (active position), not a specific character. If opponent switches, the new character gets hit. Future-proofs for double battles.
2. **Persists through caster KO** — effects always resolve even if the caster dies. "Already in the air."
3. **Caster stats snapshotted** — damage/healing calculated using caster's stats at cast time, not current.
4. **Countdown indicators** — ☄️/💚/🔮 with turn count shown below character sprites on the affected side.
5. **Stat effects supported** — delayed stat debuffs via `statFx` on the attack definition.

**New JSON Fields on Attacks:**
- `delay: N` — effect fires after N turns
- `duration: N` — effect fires each turn for N turns
- Both can be combined

**UI Updates:**
- Attack buttons show ⏳N for delay, 🔄N for duration
- Active pending effects shown as countdown indicators below character sprites
- Battle log shows cast announcement and resolution with appropriate emoji

**New Attacks:**
- **Regenerate** — Holy heal, 20 power, duration 3. Heals caster at end of each turn for 3 turns. (Cleric, Paladin)
- **Meteor Strike** — Fire magic, 100 power, delay 2, spread. Massive hit that lands after 2 turns. (Mage, Sorcerer)
- **Doom Curse** — Dark status, delay 1. Enemy DEF and RES drop after 1 turn. (Sorcerer, Warlock)

**Character Pool Updates:**
- Cleric: +Regenerate
- Paladin: +Regenerate
- Mage: +Meteor Strike
- Sorcerer: +Meteor Strike, +Doom Curse
- Warlock: +Doom Curse

### Heal Rework
- All heals (attacks + abilities) now percentage-based off caster's max HP
- `power` on heal attacks = percentage (e.g. `power: 40` = 40% of caster's max HP)
- Abilities use `"percent": 10` field (Divine Aura, Soul Drain = 10% max HP)
- Delayed heals snapshot caster's maxHP at cast time — stays constant regardless of who it lands on
- Paladin (110 HP) using Heal (40%) = 44 HP. Same Paladin's Wish hitting a Mage = still 55 HP (50% of Paladin's 110)

### Stackable Flag
- `"stackable": false` (default) — can't overlap with itself while pending (Meteor Strike, Regenerate)
- `"stackable": true` — can fire multiple overlapping instances (Arrow Barrage)

### New Attacks (additional)
- **Wish** 💚⏳1 — 50% max HP heal delayed 1 turn (Cleric, Paladin)
- **Arrow Barrage** ☄️⏳1 — 35 power physical ice hit, stackable (Ranger)

### Held Item System
- Each character holds 1 item, selected during team builder (after ability, before stats)
- Multiple characters can hold the same item
- Items shown in battle UI under stats; consumed items show "(item used)"
- Data-driven: `src/data/items/` with same modular JSON pattern

**Items:**

| Item | Emoji | Trigger | Consumable | Effect |
|------|-------|---------|------------|--------|
| Healing Herb | 🌿 | Below 50% HP | Yes | Heal 25% max HP |
| Fire Ward | 🔥 | Hit by Fire | Yes | Halve incoming damage |
| Ice Ward | ❄️ | Hit by Ice | Yes | Halve incoming damage |
| Lightning Ward | ⚡ | Hit by Lightning | Yes | Halve incoming damage |
| Holy Ward | ✨ | Hit by Holy | Yes | Halve incoming damage |
| Dark Ward | 🌑 | Hit by Dark | Yes | Halve incoming damage |
| Life Seed | 🌱 | Turn end | No | Heal 5% max HP per turn |
| War Belt | ⚔️ | Passive | No | +30% physical damage, physical/status/heal moves only |
| Spell Tome | 📖 | Passive | No | +30% magic damage, magic/status/heal moves only |

**Item Hook Integration:**
- Ward: damage reduction applied before damage in `executeAttack`
- Boost: multiplier applied to matching move types before damage
- Healing Herb: triggers after taking damage, before KO check (can save from KO)
- Life Seed: fires alongside `turnEnd` ability hooks
- Restrictions: incompatible attack buttons greyed out in battle menu

### Ideas / Future Work
- Visual upgrades (sprites, animations, effects)
- More characters and attacks
- More types (Earth, Wind, etc.)
- Balance tuning
- AI opponent option
- Sound effects / music
