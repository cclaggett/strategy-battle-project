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
let ITEMS = {};
let SPECIALIZATIONS = {};
let STATUSES = {};
let TYPE_CHART = {};
let TEAM_SIZE = 6;
let ATTACK_SLOTS = 4;
let STAT_POINTS = 50;
let STAT_MAX_PER = 20;
let MAX_PLAYER_HP = 6;
let PLAYER_ACTION_SLOTS = 3;
let ALLOCATABLE_STATS = ['atk', 'def', 'mAtk', 'mDef', 'spd'];
let STAT_LABELS = { atk: 'ATK', def: 'DEF', mAtk: 'MAG', mDef: 'RES', spd: 'SPD' };
const DAMAGE_SCALER = 0.6;  // Global damage multiplier — lower = slower games

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
  TEAM_SIZE = cfg.teamSize;
  ATTACK_SLOTS = cfg.attackSlots;
  STAT_POINTS = cfg.statPoints;
  STAT_MAX_PER = cfg.statMaxPer;
  MAX_PLAYER_HP = cfg.maxPlayerHp;
  PLAYER_ACTION_SLOTS = cfg.playerActionSlots;
  ALLOCATABLE_STATS = cfg.allocatableStats;
  STAT_LABELS = cfg.statLabels;

  // Load all entities in parallel
  const [attacks, characters, playerActions, abilities, items, specializations, statuses, typeChart] = await Promise.all([
    loadFolder('attacks'),
    loadFolder('characters'),
    loadFolder('player-actions'),
    loadFolder('abilities'),
    loadFolder('items'),
    loadFolder('specializations'),
    loadFolder('statuses'),
    fetchJSON(`${DATA_ROOT}/types.json`),
  ]);

  ATTACKS = attacks;
  ROSTER = characters;
  PLAYER_ACTIONS = playerActions;
  ABILITIES = abilities;
  ITEMS = items;
  SPECIALIZATIONS = specializations;
  STATUSES = statuses;
  TYPE_CHART = typeChart;

  console.log(`Loaded ${Object.keys(ATTACKS).length} attacks, ${Object.keys(ROSTER).length} characters, ${Object.keys(PLAYER_ACTIONS).length} player actions, ${Object.keys(ABILITIES).length} abilities, ${Object.keys(ITEMS).length} items, ${Object.keys(SPECIALIZATIONS).length} specializations, ${Object.keys(TYPE_CHART.types).length} types`);
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

// Returns { multiplier, label, isCrit, isImmune } for an attack's damageType vs a defender's types
// isCrit flag comes from type-chart crit weaknesses OR the attack's forced crit flag.
// Crit bonus (1.25x) is applied separately in calcDamageResult — critWeakness just uses
// the normal weakness multiplier (2x) and sets the flag, so crit effective = 2x * 1.25x = 2.5x.
function typeEffectiveness(atkDamageType, defenderTypes, forceCrit) {
  if (!atkDamageType || !defenderTypes || defenderTypes.length === 0) {
    return { multiplier: 1, label: '', isCrit: !!forceCrit, isImmune: false };
  }
  const weakMult = TYPE_CHART.weakMultiplier || 2;
  const resMult = TYPE_CHART.resistMultiplier || 0.5;

  let multiplier = 1;
  let isCrit = !!forceCrit;
  let isImmune = false;

  for (const defType of defenderTypes) {
    const immunities = (TYPE_CHART.immunities && TYPE_CHART.immunities[defType]) || [];
    if (immunities.includes(atkDamageType)) {
      isImmune = true;
    }
  }

  // Immunity on any type overrides everything
  if (isImmune) {
    return { multiplier: 0, label: 'Immune!', isCrit: false, isImmune: true };
  }

  for (const defType of defenderTypes) {
    const critWeaknesses = (TYPE_CHART.critWeaknesses && TYPE_CHART.critWeaknesses[defType]) || [];
    const weaknesses = TYPE_CHART.weaknesses[defType] || [];
    const resistances = TYPE_CHART.resistances[defType] || [];

    if (critWeaknesses.includes(atkDamageType)) {
      // Crit weakness: apply normal weakness multiplier + flag as crit
      // The 1.25x crit bonus is applied in calcDamageResult
      multiplier *= weakMult;
      isCrit = true;
    } else if (weaknesses.includes(atkDamageType)) {
      multiplier *= weakMult;
    } else if (resistances.includes(atkDamageType)) {
      multiplier *= resMult;
    }
  }

  let label = '';
  if (isCrit && multiplier > 1) label = 'Critically effective!!';
  else if (isCrit) label = 'Critical hit!';
  else if (multiplier > 1) label = 'Super effective!';
  else if (multiplier < 1) label = 'Not very effective...';
  return { multiplier, label, isCrit, isImmune };
}

// Returns { damage, isCrit, isImmune, typeLabel }
function calcDamageResult(attack, attacker, defender) {
  const atk = ATTACKS[attack];
  if (atk.type === 'heal') {
    // Heal power = percentage of caster's max HP
    const maxHp = attacker.maxHp || attacker.hp || 100;
    return { damage: -Math.round(maxHp * atk.power / 100), isCrit: false, isImmune: false, typeLabel: '' };
  }
  if (atk.type === 'status' || atk.type === 'protect') {
    return { damage: 0, isCrit: false, isImmune: false, typeLabel: '' };
  }

  // Check type effectiveness first (pass atk.crit for forced-crit moves)
  const defTypes = defender.types || [];
  const { multiplier, label: typeLabel, isCrit, isImmune } = typeEffectiveness(atk.damageType, defTypes, atk.crit);

  if (isImmune) {
    return { damage: 0, isCrit: false, isImmune: true, typeLabel };
  }

  const offStat = atk.type === 'physical' ? 'atk' : 'mAtk';
  const defStat = atk.type === 'physical' ? 'def' : 'mDef';

  let offense, defense;
  if (isCrit) {
    // Crit ignores attacker's offensive debuffs and defender's defensive buffs
    const critBonusMult = TYPE_CHART.critBonusMultiplier || 1.25;
    const atkStage = (attacker.stages && attacker.stages[offStat]) || 0;
    const defStage = (defender.stages && defender.stages[defStat]) || 0;
    // Use effective stat but floor offensive stage at 0 (ignore drops) and cap defensive stage at 0 (ignore buffs)
    const offStageUsed = Math.max(0, atkStage);
    const defStageUsed = Math.min(0, defStage);
    offense = Math.round(attacker[offStat] * stageMultiplier(offStageUsed));
    defense = Math.round(defender[defStat] * stageMultiplier(defStageUsed));
    const baseDmg = atk.power * (offense / defense) * multiplier * critBonusMult * DAMAGE_SCALER;
    return { damage: Math.max(1, Math.round(baseDmg)), isCrit: true, isImmune: false, typeLabel };
  } else {
    offense = effectiveStat(attacker, offStat);
    defense = effectiveStat(defender, defStat);
    const baseDmg = atk.power * (offense / defense) * multiplier * DAMAGE_SCALER;
    return { damage: Math.max(1, Math.round(baseDmg)), isCrit: false, isImmune: false, typeLabel };
  }
}

// Backward-compatible wrapper (returns just the number)
function calcDamage(attack, attacker, defender) {
  return calcDamageResult(attack, attacker, defender).damage;
}

// Player action attack damage — uses fixed stats from the action definition
function calcPlayerActionDamage(actionDef, defender) {
  const offense = actionDef.offenseBase;
  const defStat = actionDef.offenseStat === 'atk' ? 'def' : 'mDef';
  const defense = effectiveStat(defender, defStat);
  return Math.max(1, Math.round(actionDef.power * (offense / defense) * DAMAGE_SCALER));
}
