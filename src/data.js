// ── Data Layer — loads from src/data/ file tree ─────────────────────
// Each entity is its own JSON file, discovered via index.json manifests.
// To add a new attack/character/player-action:
//   1. Create a .json file in the right folder
//   2. Add its id to that folder's index.json
//   That's it — the game picks it up automatically.

let ATTACKS = {};
let ROSTER = {};
let PLAYER_ACTIONS = {};
let ABILITIES = {};
let STAT_POINTS = 50;
let STAT_MAX_PER = 20;
let MAX_PLAYER_HP = 6;
let PLAYER_ACTION_SLOTS = 3;
let ALLOCATABLE_STATS = ['atk', 'def', 'mAtk', 'mDef', 'spd'];
let STAT_LABELS = { atk: 'ATK', def: 'DEF', mAtk: 'MAG', mDef: 'RES', spd: 'SPD' };

const DATA_ROOT = 'src/data';
const cacheBust = '?v=' + Date.now();

async function fetchJSON(path) {
  const resp = await fetch(path + cacheBust);
  if (!resp.ok) throw new Error(`Failed to load ${path}: ${resp.status}`);
  return resp.json();
}

async function loadFolder(folder) {
  const index = await fetchJSON(`${DATA_ROOT}/${folder}/index.json`);
  const entries = await Promise.all(
    index.map(id => fetchJSON(`${DATA_ROOT}/${folder}/${id}.json`))
  );
  const result = {};
  for (const entry of entries) {
    result[entry.id] = entry;
  }
  return result;
}

async function loadGameData() {
  // Load config
  const cfg = await fetchJSON(`${DATA_ROOT}/config.json`);
  STAT_POINTS = cfg.statPoints;
  STAT_MAX_PER = cfg.statMaxPer;
  MAX_PLAYER_HP = cfg.maxPlayerHp;
  PLAYER_ACTION_SLOTS = cfg.playerActionSlots;
  ALLOCATABLE_STATS = cfg.allocatableStats;
  STAT_LABELS = cfg.statLabels;

  // Load all entities in parallel
  const [attacks, characters, playerActions, abilities] = await Promise.all([
    loadFolder('attacks'),
    loadFolder('characters'),
    loadFolder('player-actions'),
    loadFolder('abilities'),
  ]);

  ATTACKS = attacks;
  ROSTER = characters;
  PLAYER_ACTIONS = playerActions;
  ABILITIES = abilities;

  console.log(`Loaded ${Object.keys(ATTACKS).length} attacks, ${Object.keys(ROSTER).length} characters, ${Object.keys(PLAYER_ACTIONS).length} player actions, ${Object.keys(ABILITIES).length} abilities`);
}

// ── Formulas (kept in JS — they need logic) ─────────────────────────

function stageMultiplier(stage) {
  if (stage >= 0) return 1 + 0.5 * stage;
  return 1 / (1 + 0.5 * Math.abs(stage));
}

function effectiveStat(char, stat) {
  const base = char[stat];
  const stage = (char.stages && char.stages[stat]) || 0;
  return Math.round(base * stageMultiplier(stage));
}

function calcDamage(attack, attacker, defender) {
  const atk = ATTACKS[attack];
  if (atk.type === 'heal') {
    return -Math.round(atk.power * (effectiveStat(attacker, 'mAtk') / 30));
  }
  if (atk.type === 'status' || atk.type === 'protect') {
    return 0;
  }
  const offense = atk.type === 'physical' ? effectiveStat(attacker, 'atk') : effectiveStat(attacker, 'mAtk');
  const defense = atk.type === 'physical' ? effectiveStat(defender, 'def') : effectiveStat(defender, 'mDef');
  return Math.max(1, Math.round(atk.power * (offense / defense)));
}

// Player action attack damage — uses fixed stats from the action definition
function calcPlayerActionDamage(actionDef, defender) {
  const offense = actionDef.offenseBase;
  const defStat = actionDef.offenseStat === 'atk' ? 'def' : 'mDef';
  const defense = effectiveStat(defender, defStat);
  return Math.max(1, Math.round(actionDef.power * (offense / defense)));
}
