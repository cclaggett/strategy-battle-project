// ── Battle Scene ────────────────────────────────────────────────────
class BattleScene extends Phaser.Scene {
  constructor() {
    super('BattleScene');
  }

  init(data) {
    this.p1Team = data.p1Picks.map(p => this.makeChar(p.key, p.attacks, p.ability, p.bonuses, p.item, p.specialization));
    this.p2Team = data.p2Picks.map(p => this.makeChar(p.key, p.attacks, p.ability, p.bonuses, p.item, p.specialization));
    this.p1Index = 0;
    this.p2Index = 0;
    this.p1Choice = null;
    this.p2Choice = null;
    this.p1PlayerAction = null;
    this.p2PlayerAction = null;
    this.p1PlayerHp = MAX_PLAYER_HP;
    this.p2PlayerHp = MAX_PLAYER_HP;

    // Player actions with cooldown tracking
    // Each entry: { key, cooldownLeft } — cooldownLeft 0 = ready
    this.p1Actions = data.p1PlayerActions.map(k => ({ key: k, cooldownLeft: 0 }));
    this.p2Actions = data.p2PlayerActions.map(k => ({ key: k, cooldownLeft: 0 }));

    this.phase = 'select';
    this.log = [];
    this.selectingPlayer = 1;
    this.roundNumber = 0;

    // Track whether each player used a protect-type move last turn (for consecutive fail)
    this.p1UsedProtectLastTurn = false;
    this.p2UsedProtectLastTurn = false;

    // Pending multi-turn effects queue
    // Each entry: { id, atkKey, casterSnap, sourcePlayer, targetPosition ('self'|'enemy'),
    //               turnsLeft, duration?, totalDuration?, type: 'delay'|'duration' }
    this.pendingEffects = [];
    this.nextPendingId = 1;
  }

  makeChar(key, attacks, ability, bonuses, item, specialization) {
    const t = ROSTER[key];
    const char = { key, ...t, attacks, ability: ability || null, item: item || null, itemConsumed: false, itemSealed: false, specialization: specialization || null, maxHp: t.hp, currentHp: t.hp, alive: true };
    if (bonuses) {
      ALLOCATABLE_STATS.forEach(s => { char[s] += (bonuses[s] || 0); });
      // Sync HP fields after bonus allocation
      char.maxHp = char.hp;
      char.currentHp = char.hp;
    }
    // Apply specialization multipliers after skill investment
    if (specialization && SPECIALIZATIONS[specialization]) {
      const spec = SPECIALIZATIONS[specialization];
      const boostStat = spec.boost.stat;
      const penaltyStat = spec.penalty.stat;
      if (boostStat === 'hp') {
        char.hp = Math.round(char.hp * spec.boost.multiplier);
        char.maxHp = char.hp;
        char.currentHp = char.hp;
      } else {
        char[boostStat] = Math.round(char[boostStat] * spec.boost.multiplier);
      }
      if (penaltyStat === 'hp') {
        char.hp = Math.round(char.hp * spec.penalty.multiplier);
        char.maxHp = char.hp;
        char.currentHp = char.hp;
      } else {
        char[penaltyStat] = Math.round(char[penaltyStat] * spec.penalty.multiplier);
      }
    }
    char.stages = { atk: 0, def: 0, mAtk: 0, mDef: 0, spd: 0 };
    return char;
  }

  // ── Ability Hook System ─────────────────────────────────────────
  // Fires ability effects for a character if their ability matches the trigger.
  // context: { char, enemy, player } — the character with the ability, their opponent, and which player (1 or 2)
  fireAbilityHooks(trigger, context) {
    const { char, enemy, player } = context;
    if (!char || !char.ability) return;
    // onKO fires even when dead; all other triggers require alive
    if (trigger !== 'onKO' && !char.alive) return;
    const ability = ABILITIES[char.ability];
    if (!ability || ability.trigger !== trigger) return;

    this.log.push(`${char.name}'s ${ability.name} activates!`);

    for (const fx of ability.effects) {
      if (fx.type === 'statFx') {
        const target = fx.target === 'self' ? char : enemy;
        if (!target || !target.alive) continue;
        target.stages[fx.stat] = Math.max(-4, Math.min(4, (target.stages[fx.stat] || 0) + fx.stages));
        const statLabel = STAT_LABELS[fx.stat] || fx.stat;
        const dir = fx.stages > 0 ? 'rose' : 'fell';
        const mult = stageMultiplier(target.stages[fx.stat]);
        this.log.push(`${target.name}'s ${statLabel} ${dir}! (×${mult.toFixed(2)})`);
      } else if (fx.type === 'heal') {
        const target = fx.target === 'self' ? char : enemy;
        if (!target || !target.alive) continue;
        const healAmt = fx.percent ? Math.round(target.maxHp * fx.percent / 100) : (fx.amount || 0);
        const healed = Math.min(healAmt, target.maxHp - target.currentHp);
        if (healed > 0) {
          target.currentHp += healed;
          this.log.push(`${target.name} heals ${healed} HP!`);
        }
      } else if (fx.type === 'sealItems') {
        const target = fx.target === 'self' ? char : enemy;
        if (!target || !target.alive) continue;
        if (!target.itemSealed) {
          target.itemSealed = true;
          this.log.push(`${target.name}'s consumable items are sealed!`);
        }
      } else if (fx.type === 'playerHeal') {
        const prop = player === 1 ? 'p1PlayerHp' : 'p2PlayerHp';
        if (this[prop] < MAX_PLAYER_HP) {
          this[prop] = Math.min(MAX_PLAYER_HP, this[prop] + fx.amount);
          this.log.push(`Player ${player} recovers ${fx.amount} player HP!`);
        }
      }
    }
  }

  // ── Item Hook System ─────────────────────────────────────────
  // Returns true if item was consumed/activated
  getCharItem(char, ignoreSealed) {
    if (!char || !char.item || char.itemConsumed) return null;
    const item = ITEMS[char.item] || null;
    if (!item) return null;
    // Sealed characters can't use consumable items (but passive items still work)
    if (!ignoreSealed && char.itemSealed && item.consumable) return null;
    return item;
  }

  fireItemTurnEnd(char, player) {
    const item = this.getCharItem(char);
    if (!item || item.trigger !== 'turnEnd' || !char.alive) return;
    for (const fx of item.effects) {
      if (fx.type === 'heal') {
        const healAmt = Math.round(char.maxHp * fx.percent / 100);
        const healed = Math.min(healAmt, char.maxHp - char.currentHp);
        if (healed > 0) {
          char.currentHp += healed;
          this.log.push(`${item.emoji} ${char.name}'s ${item.name} heals ${healed} HP!`);
        }
      }
    }
  }

  fireItemOnHpBelow50(char, player) {
    const item = this.getCharItem(char);
    if (!item || item.trigger !== 'onHpBelow50' || !char.alive) return;
    if (char.currentHp > char.maxHp * 0.5) return;  // not below 50%
    for (const fx of item.effects) {
      if (fx.type === 'heal') {
        const healAmt = Math.round(char.maxHp * fx.percent / 100);
        const healed = Math.min(healAmt, char.maxHp - char.currentHp);
        if (healed > 0) {
          char.currentHp += healed;
          this.log.push(`${item.emoji} ${char.name}'s ${item.name} activates — heals ${healed} HP!`);
        }
      }
    }
    if (item.consumable) {
      char.itemConsumed = true;
      this.log.push(`${item.emoji} ${item.name} was consumed!`);
    }
  }

  // Returns a damage multiplier (for ward items). 1.0 = no reduction.
  fireItemOnHitByType(char, damageType) {
    const item = this.getCharItem(char);
    if (!item || item.trigger !== 'onHitByType' || !char.alive) return 1.0;
    if (item.triggerType !== damageType) return 1.0;
    let mult = 1.0;
    for (const fx of item.effects) {
      if (fx.type === 'reduceDamage') {
        mult *= fx.multiplier;
      }
    }
    this.log.push(`${item.emoji} ${char.name}'s ${item.name} activates — damage reduced!`);
    if (item.consumable) {
      char.itemConsumed = true;
      this.log.push(`${item.emoji} ${item.name} was consumed!`);
    }
    return mult;
  }

  // Returns damage multiplier for passive boost items
  getItemDamageBoost(char, moveType) {
    const item = this.getCharItem(char);
    if (!item || item.trigger !== 'passive') return 1.0;
    let mult = 1.0;
    for (const fx of (item.effects || [])) {
      if (fx.type === 'boostDamage' && fx.moveType === moveType) {
        mult *= fx.multiplier;
      }
    }
    return mult;
  }

  // Returns list of allowed attack types for a character (null = no restriction)
  getItemAttackRestriction(char) {
    const item = this.getCharItem(char);
    if (!item || !item.restriction || !item.restriction.allowedTypes) return null;
    return item.restriction.allowedTypes;
  }

  get p1Active() { return this.p1Team[this.p1Index]; }
  get p2Active() { return this.p2Team[this.p2Index]; }

  getActions(player) { return player === 1 ? this.p1Actions : this.p2Actions; }

  // ── Create ──────────────────────────────────────────────────────
  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    // Battle area is the left 800px, log panel is the right 250px
    this.battleW = 800;
    this.logPanelX = 800;
    this.logPanelW = W - 800;

    this.add.rectangle(this.battleW / 2, H / 2, this.battleW, H, 0x1a1a2e);
    this.add.line(this.battleW / 2, H / 2, 0, -H / 2, 0, H / 2, 0x16213e).setLineWidth(2);
    this.add.text(this.battleW / 2, 16, 'STRATEGY BATTLE', { fontSize: '20px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5, 0);

    // ── Log Panel ──
    this.add.rectangle(this.logPanelX + this.logPanelW / 2, H / 2, this.logPanelW, H, 0x111122);
    this.add.line(this.logPanelX, H / 2, 0, -H / 2, 0, H / 2, 0x333355).setLineWidth(1);
    this.add.text(this.logPanelX + this.logPanelW / 2, 10, '📜 Battle Log', { fontSize: '13px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5, 0);

    // Scrollable log text area
    const logMask = this.add.graphics();
    logMask.fillRect(this.logPanelX + 4, 30, this.logPanelW - 8, H - 40);
    this.logDisplayText = this.add.text(this.logPanelX + 8, 32, '', {
      fontSize: '10px', fill: '#ccc', fontFamily: 'monospace',
      wordWrap: { width: this.logPanelW - 16 }, lineSpacing: 3
    });
    this.logDisplayText.setMask(logMask.createGeometryMask());

    const BW = this.battleW;

    // Player labels
    this.add.text(BW * 0.25, H * 0.06, 'Player 1', { fontSize: '12px', fill: '#53a8b6', fontFamily: 'monospace' }).setOrigin(0.5);
    this.add.text(BW * 0.75, H * 0.06, 'Player 2', { fontSize: '12px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);

    // Player HP pips
    this.p1PlayerPips = [];
    this.p2PlayerPips = [];
    for (let i = 0; i < MAX_PLAYER_HP; i++) {
      this.p1PlayerPips.push(this.add.circle(BW * 0.13 + i * 18, H * 0.10, 6, 0x53a8b6).setStrokeStyle(1, 0x88ccdd));
      this.p2PlayerPips.push(this.add.circle(BW * 0.63 + i * 18, H * 0.10, 6, 0xe94560).setStrokeStyle(1, 0xff8888));
    }
    this.p1PlayerHpLabel = this.add.text(BW * 0.25, H * 0.14, '', { fontSize: '10px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    this.p2PlayerHpLabel = this.add.text(BW * 0.75, H * 0.14, '', { fontSize: '10px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);

    // Character sprites
    this.p1Sprite = this.add.rectangle(BW * 0.25, H * 0.30, 64, 80, 0x0f3460).setStrokeStyle(2, 0x53a8b6);
    this.p2Sprite = this.add.rectangle(BW * 0.75, H * 0.30, 64, 80, 0x5c2a2a).setStrokeStyle(2, 0xe94560);

    // Name labels
    this.p1NameText = this.add.text(BW * 0.25, H * 0.17, '', { fontSize: '16px', fill: '#53a8b6', fontFamily: 'monospace' }).setOrigin(0.5);
    this.p2NameText = this.add.text(BW * 0.75, H * 0.17, '', { fontSize: '16px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);

    // Character HP bars
    this.p1HpBg  = this.add.rectangle(BW * 0.25, H * 0.43, 120, 14, 0x333333).setStrokeStyle(1, 0x53a8b6);
    this.p1HpBar = this.add.rectangle(BW * 0.25, H * 0.43, 116, 10, 0x53a8b6);
    this.p1HpText = this.add.text(BW * 0.25, H * 0.47, '', { fontSize: '12px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5, 0);

    this.p2HpBg  = this.add.rectangle(BW * 0.75, H * 0.43, 120, 14, 0x333333).setStrokeStyle(1, 0xe94560);
    this.p2HpBar = this.add.rectangle(BW * 0.75, H * 0.43, 116, 10, 0xe94560);
    this.p2HpText = this.add.text(BW * 0.75, H * 0.47, '', { fontSize: '12px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5, 0);

    // Stats
    this.p1StatsText = this.add.text(BW * 0.05, H * 0.52, '', { fontSize: '11px', fill: '#888', fontFamily: 'monospace', lineSpacing: 4 });
    this.p2StatsText = this.add.text(BW * 0.55, H * 0.52, '', { fontSize: '11px', fill: '#888', fontFamily: 'monospace', lineSpacing: 4 });

    // Team dots
    this.p1Dots = [];
    this.p2Dots = [];
    for (let i = 0; i < this.p1Team.length; i++) {
      this.p1Dots.push(this.add.circle(BW * 0.18 + i * 16, H * 0.22, 4, 0x53a8b6));
    }
    for (let i = 0; i < this.p2Team.length; i++) {
      this.p2Dots.push(this.add.circle(BW * 0.68 + i * 16, H * 0.22, 4, 0xe94560));
    }

    // Action buttons area
    this.buttons = [];
    this.promptText = this.add.text(BW / 2, H * 0.63, '', { fontSize: '14px', fill: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);

    this.pendingIndicators = [];

    // Fire onEntry for starting characters
    this.fireAbilityHooks('onEntry', { char: this.p1Active, enemy: this.p2Active, player: 1 });
    this.fireAbilityHooks('onEntry', { char: this.p2Active, enemy: this.p1Active, player: 2 });

    this.refreshUI();
    this.showPlayerActionMenu();
  }

  formatStat(char, stat, label) {
    const eff = effectiveStat(char, stat);
    const stage = char.stages[stat];
    let arrow = '';
    if (stage > 0) arrow = '↑'.repeat(Math.min(stage, 4));
    if (stage < 0) arrow = '↓'.repeat(Math.min(Math.abs(stage), 4));
    return `${label} ${eff}${arrow}`;
  }

  // ── UI Refresh ──────────────────────────────────────────────────
  refreshUI() {
    const p1 = this.p1Active;
    const p2 = this.p2Active;

    const p1Types = (p1.types || []).map(t => TYPE_CHART.types[t] ? TYPE_CHART.types[t].emoji : '').join('');
    const p2Types = (p2.types || []).map(t => TYPE_CHART.types[t] ? TYPE_CHART.types[t].emoji : '').join('');
    this.p1NameText.setText(`${p1Types} ${p1.name}`);
    this.p2NameText.setText(`${p2.name} ${p2Types}`);

    const p1Pct = Math.max(0, p1.currentHp / p1.maxHp);
    const p2Pct = Math.max(0, p2.currentHp / p2.maxHp);
    this.p1HpBar.setSize(116 * p1Pct, 10);
    this.p2HpBar.setSize(116 * p2Pct, 10);
    this.p1HpBar.setFillStyle(p1Pct > 0.5 ? 0x53a8b6 : p1Pct > 0.25 ? 0xf0a500 : 0xe94560);
    this.p2HpBar.setFillStyle(p2Pct > 0.5 ? 0xe94560 : p2Pct > 0.25 ? 0xf0a500 : 0x53a8b6);

    this.p1HpText.setText(`${Math.max(0, p1.currentHp)} / ${p1.maxHp}`);
    this.p2HpText.setText(`${Math.max(0, p2.currentHp)} / ${p2.maxHp}`);

    // Player HP pips
    for (let i = 0; i < MAX_PLAYER_HP; i++) {
      this.p1PlayerPips[i].setFillStyle(i < this.p1PlayerHp ? 0x53a8b6 : 0x333333);
      this.p2PlayerPips[i].setFillStyle(i < this.p2PlayerHp ? 0xe94560 : 0x333333);
    }
    this.p1PlayerHpLabel.setText(`Player HP: ${this.p1PlayerHp}/${MAX_PLAYER_HP}`);
    this.p2PlayerHpLabel.setText(`Player HP: ${this.p2PlayerHp}/${MAX_PLAYER_HP}`);

    const p1AbilityStr = p1.ability && ABILITIES[p1.ability] ? `\n✦ ${ABILITIES[p1.ability].name}` : '';
    const p2AbilityStr = p2.ability && ABILITIES[p2.ability] ? `\n✦ ${ABILITIES[p2.ability].name}` : '';
    const p1SpecStr = p1.specialization && SPECIALIZATIONS[p1.specialization] ? `\n${SPECIALIZATIONS[p1.specialization].emoji} ${SPECIALIZATIONS[p1.specialization].name}` : '';
    const p2SpecStr = p2.specialization && SPECIALIZATIONS[p2.specialization] ? `\n${SPECIALIZATIONS[p2.specialization].emoji} ${SPECIALIZATIONS[p2.specialization].name}` : '';
    const p1ItemObj = this.getCharItem(p1, true); // ignoreSealed for display
    const p2ItemObj = this.getCharItem(p2, true);
    let p1ItemStr = '';
    if (p1ItemObj) {
      p1ItemStr = `\n${p1ItemObj.emoji} ${p1ItemObj.name}`;
      if (p1.itemSealed && p1ItemObj.consumable) p1ItemStr += ' 🔒';
    } else if (p1.item && p1.itemConsumed) {
      p1ItemStr = '\n(item used)';
    }
    let p2ItemStr = '';
    if (p2ItemObj) {
      p2ItemStr = `\n${p2ItemObj.emoji} ${p2ItemObj.name}`;
      if (p2.itemSealed && p2ItemObj.consumable) p2ItemStr += ' 🔒';
    } else if (p2.item && p2.itemConsumed) {
      p2ItemStr = '\n(item used)';
    }
    this.p1StatsText.setText(
      `${this.formatStat(p1, 'atk', 'ATK')}  ${this.formatStat(p1, 'def', 'DEF')}\n` +
      `${this.formatStat(p1, 'mAtk', 'MAG')}  ${this.formatStat(p1, 'mDef', 'RES')}\n` +
      `${this.formatStat(p1, 'spd', 'SPD')}` + p1AbilityStr + p1ItemStr + p1SpecStr
    );
    this.p2StatsText.setText(
      `${this.formatStat(p2, 'atk', 'ATK')}  ${this.formatStat(p2, 'def', 'DEF')}\n` +
      `${this.formatStat(p2, 'mAtk', 'MAG')}  ${this.formatStat(p2, 'mDef', 'RES')}\n` +
      `${this.formatStat(p2, 'spd', 'SPD')}` + p2AbilityStr + p2ItemStr + p2SpecStr
    );

    this.p1Team.forEach((c, i) => this.p1Dots[i].setFillStyle(c.alive ? 0x53a8b6 : 0x333333));
    this.p2Team.forEach((c, i) => this.p2Dots[i].setFillStyle(c.alive ? 0xe94560 : 0x333333));

    // ── Pending effect countdown indicators ──
    if (this.pendingIndicators) {
      this.pendingIndicators.forEach(t => t.destroy());
    }
    this.pendingIndicators = [];
    const BW = this.battleW;
    const H = this.scale.height;

    // Group pending effects by target position
    const p1Incoming = []; // effects targeting P1's active slot
    const p2Incoming = []; // effects targeting P2's active slot

    for (const effect of this.pendingEffects) {
      const atk = ATTACKS[effect.atkKey];
      let emoji;
      if (atk.type === 'heal') emoji = '💚';
      else if (atk.type === 'status') emoji = '🔮';
      else emoji = '☄️';

      const label = `${emoji}${effect.turnsLeft}`;

      if (effect.targetPosition === 'self') {
        // Self-targeting goes on the caster's side
        if (effect.sourcePlayer === 1) p1Incoming.push(label);
        else p2Incoming.push(label);
      } else {
        // Enemy-targeting goes on the enemy side
        if (effect.sourcePlayer === 1) p2Incoming.push(label);
        else p1Incoming.push(label);
      }
    }

    // Render indicators below the character sprites
    const indicatorY = H * 0.38;
    p1Incoming.forEach((label, i) => {
      const t = this.add.text(BW * 0.25 - 30 + i * 30, indicatorY, label, {
        fontSize: '13px', fill: '#ff6', fontFamily: 'monospace'
      }).setOrigin(0.5);
      this.pendingIndicators.push(t);
    });
    p2Incoming.forEach((label, i) => {
      const t = this.add.text(BW * 0.75 - 30 + i * 30, indicatorY, label, {
        fontSize: '13px', fill: '#ff6', fontFamily: 'monospace'
      }).setOrigin(0.5);
      this.pendingIndicators.push(t);
    });

    // Update log panel — show all entries, auto-scroll to bottom
    const logStr = this.log.map((entry, i) => entry).join('\n');
    this.logDisplayText.setText(logStr);
    // Scroll to bottom: move text up so latest entries are visible
    const visibleH = this.scale.height - 40;
    const textH = this.logDisplayText.height;
    if (textH > visibleH) {
      this.logDisplayText.setY(32 - (textH - visibleH));
    } else {
      this.logDisplayText.setY(32);
    }
  }

  // ── Player Action Menu ─────────────────────────────────────────
  showPlayerActionMenu() {
    this.clearButtons();
    const W = this.battleW;
    const H = this.scale.height;
    const active = this.selectingPlayer === 1 ? this.p1Active : this.p2Active;
    const actions = this.getActions(this.selectingPlayer);
    const myHp = this.selectingPlayer === 1 ? this.p1PlayerHp : this.p2PlayerHp;

    this.promptText.setText(`Player ${this.selectingPlayer} — Your action (${active.name} active)`);

    // Show drafted actions + pass (always available)
    const allActions = [...actions, { key: 'none', cooldownLeft: 0 }];
    const totalButtons = allActions.length;
    const spacing = Math.min(140, (W - 40) / totalButtons);
    const startX = W / 2 - (totalButtons - 1) * spacing / 2;

    allActions.forEach((entry, i) => {
      const pa = PLAYER_ACTIONS[entry.key];
      const bx = startX + i * spacing;
      const by = H * 0.76;

      const onCooldown = entry.cooldownLeft > 0;
      const dimHeal = (entry.key === 'heal' && myHp >= MAX_PLAYER_HP);
      const disabled = onCooldown || dimHeal;

      let bgColor = 0x2a2a2a;
      if (!disabled) {
        if (pa.type === 'defensive') bgColor = 0x1a3a1a;
        else if (pa.type === 'heal') bgColor = 0x1a2a3a;
        else if (pa.type === 'strike' || pa.type === 'charAttack') bgColor = 0x3a1a1a;
      } else {
        bgColor = 0x222222;
      }

      const bg = this.add.rectangle(bx, by, spacing - 8, 48, bgColor).setStrokeStyle(1, disabled ? 0x444444 : 0xffffff);
      if (!disabled) bg.setInteractive({ useHandCursor: true });

      const nameStr = pa.name;
      const txt = this.add.text(bx, by - 10, nameStr, { fontSize: '11px', fill: disabled ? '#555' : '#fff', fontFamily: 'monospace' }).setOrigin(0.5);

      let subStr = '';
      if (onCooldown) {
        subStr = `CD: ${entry.cooldownLeft} turn${entry.cooldownLeft > 1 ? 's' : ''}`;
      } else if (pa.power) {
        const statName = STAT_LABELS[pa.offenseStat] || '';
        subStr = `${pa.power} pow ${statName}`;
      } else {
        subStr = pa.description.length > 25 ? pa.description.substring(0, 22) + '...' : pa.description;
      }
      const sub = this.add.text(bx, by + 10, subStr, { fontSize: '8px', fill: '#888', fontFamily: 'monospace', wordWrap: { width: spacing - 14 }, align: 'center' }).setOrigin(0.5);

      if (!disabled) {
        bg.on('pointerover', () => bg.setFillStyle(0xe94560));
        bg.on('pointerout', () => bg.setFillStyle(bgColor));
        bg.on('pointerdown', () => {
          // If this is a long-range player attack, need target selection
          if (pa.type === 'charAttack' && pa.range === 'long') {
            this.showPlayerActionTargetMenu(entry.key);
          } else {
            this.onPlayerActionChosen(entry.key, false);
          }
        });
      }

      this.buttons.push(bg, txt, sub);
    });
  }

  // ── Player Action Target Menu (for long-range player attacks) ──
  showPlayerActionTargetMenu(actionKey) {
    this.clearButtons();
    const W = this.battleW;
    const H = this.scale.height;
    const pa = PLAYER_ACTIONS[actionKey];
    const opponentChar = this.selectingPlayer === 1 ? this.p2Active : this.p1Active;

    this.promptText.setText(`${pa.name} — Target who?`);

    // Target character
    const bg1 = this.add.rectangle(W * 0.35, H * 0.80, 160, 44, 0x0f3460).setStrokeStyle(1, 0xffffff).setInteractive({ useHandCursor: true });
    const txt1 = this.add.text(W * 0.35, H * 0.80 - 6, `🗡 ${opponentChar.name}`, { fontSize: '12px', fill: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
    const sub1 = this.add.text(W * 0.35, H * 0.80 + 12, 'Damage to character', { fontSize: '9px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    bg1.on('pointerover', () => bg1.setFillStyle(0xe94560));
    bg1.on('pointerout', () => bg1.setFillStyle(0x0f3460));
    bg1.on('pointerdown', () => this.onPlayerActionChosen(actionKey, false));

    // Target player
    const bg2 = this.add.rectangle(W * 0.65, H * 0.80, 160, 44, 0x3a1a1a).setStrokeStyle(1, 0xff6666).setInteractive({ useHandCursor: true });
    const txt2 = this.add.text(W * 0.65, H * 0.80 - 6, `🎯 Player ${this.selectingPlayer === 1 ? 2 : 1}`, { fontSize: '12px', fill: '#ff6666', fontFamily: 'monospace' }).setOrigin(0.5);
    const sub2 = this.add.text(W * 0.65, H * 0.80 + 12, '1 HP to player directly', { fontSize: '9px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    bg2.on('pointerover', () => bg2.setFillStyle(0xe94560));
    bg2.on('pointerout', () => bg2.setFillStyle(0x3a1a1a));
    bg2.on('pointerdown', () => this.onPlayerActionChosen(actionKey, true));

    const backBg = this.add.rectangle(W / 2, H * 0.92, 120, 30, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(W / 2, H * 0.92, '← Back', { fontSize: '12px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showPlayerActionMenu());

    this.buttons.push(bg1, txt1, sub1, bg2, txt2, sub2, backBg, backTxt);
  }

  onPlayerActionChosen(actionKey, targetPlayer) {
    if (this.selectingPlayer === 1) {
      this.p1PlayerAction = { key: actionKey, targetPlayer };
    } else {
      this.p2PlayerAction = { key: actionKey, targetPlayer };
    }
    this.showCharActionMenu();
  }

  // ── Character Action Menu ──────────────────────────────────────
  showCharActionMenu() {
    this.clearButtons();
    const W = this.battleW;
    const H = this.scale.height;
    const active = this.selectingPlayer === 1 ? this.p1Active : this.p2Active;
    const team = this.selectingPlayer === 1 ? this.p1Team : this.p2Team;
    const activeIdx = this.selectingPlayer === 1 ? this.p1Index : this.p2Index;
    const color = this.selectingPlayer === 1 ? 0x0f3460 : 0x5c2a2a;

    this.promptText.setText(`Player ${this.selectingPlayer} — ${active.name}'s move`);

    // Check item attack restrictions (e.g. War Belt = physical only)
    const allowedTypes = this.getItemAttackRestriction(active);

    // Determine available attacks — if all are restricted, add Struggle as fallback
    let attackList = [...active.attacks];
    const hasUsableAttack = attackList.some(atkKey => {
      const atk = ATTACKS[atkKey];
      return !allowedTypes || allowedTypes.includes(atk.type);
    });
    if (!hasUsableAttack && ATTACKS['struggle']) {
      attackList = ['struggle'];
    }

    const atkCount = attackList.length;
    const canSwitch = team.some((c, i) => c.alive && i !== activeIdx);
    const totalButtons = atkCount + (canSwitch ? 1 : 0);
    const spacing = Math.min(150, (W - 40) / totalButtons);
    const startX = W / 2 - (totalButtons - 1) * spacing / 2;

    attackList.forEach((atkKey, i) => {
      const atk = ATTACKS[atkKey];
      const restricted = allowedTypes && !allowedTypes.includes(atk.type);
      const bx = startX + i * spacing;
      const by = H * 0.80;

      const btnColor = restricted ? 0x222222 : color;
      const bg = this.add.rectangle(bx, by, spacing - 10, 44, btnColor).setStrokeStyle(1, restricted ? 0x444444 : 0xffffff);
      if (!restricted) bg.setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, by - 8, atk.name, { fontSize: '12px', fill: restricted ? '#555' : '#fff', fontFamily: 'monospace' }).setOrigin(0.5);

      let subLabel = atk.type;
      if (atk.damageType && TYPE_CHART.types[atk.damageType]) subLabel += ` ${TYPE_CHART.types[atk.damageType].emoji}`;
      if (atk.type === 'heal' && atk.power > 0) subLabel += ` ${atk.power}%`;
      else if (atk.power > 0) subLabel += ` ${atk.power}`;
      if ((atk.priority || 0) > 0) subLabel += ` ⚡+${atk.priority}`;
      if ((atk.priority || 0) < 0) subLabel += ` 🐢${atk.priority}`;
      if (atk.spread) subLabel += ' 🌊';
      if (atk.range === 'long') subLabel += ' 🎯';
      if (atk.statFx) {
        const fxStr = atk.statFx.map(fx => {
          const dir = fx.stages > 0 ? '↑' : '↓';
          return `${STAT_LABELS[fx.stat] || fx.stat}${dir}`;
        }).join(' ');
        subLabel += ` ${fxStr}`;
      }
      if (atk.delay) subLabel += ` ⏳${atk.delay}`;
      if (atk.duration) subLabel += ` 🔄${atk.duration}`;
      const sub = this.add.text(bx, by + 10, subLabel, { fontSize: '9px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);

      if (!restricted) {
        bg.on('pointerover', () => bg.setFillStyle(0xe94560));
        bg.on('pointerout', () => bg.setFillStyle(btnColor));
        bg.on('pointerdown', () => {
          if (atk.range === 'long') {
            this.showLongRangeTargetMenu(atkKey);
          } else {
            this.onCharChoiceMade({ type: 'attack', key: atkKey, targetPlayer: false });
          }
        });
      }

      this.buttons.push(bg, txt, sub);
    });

    if (canSwitch) {
      const bx = startX + atkCount * spacing;
      const by = H * 0.80;

      const bg = this.add.rectangle(bx, by, spacing - 10, 44, 0x1a4a1a).setStrokeStyle(1, 0x4ade80).setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, by, '⇄ Switch', { fontSize: '12px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);

      bg.on('pointerover', () => bg.setFillStyle(0x22c55e));
      bg.on('pointerout', () => bg.setFillStyle(0x1a4a1a));
      bg.on('pointerdown', () => this.showSwitchMenu());

      this.buttons.push(bg, txt);
    }
  }

  // ── Long Range Target (character attack) ────────────────────────
  showLongRangeTargetMenu(atkKey) {
    this.clearButtons();
    const W = this.battleW;
    const H = this.scale.height;
    const atk = ATTACKS[atkKey];
    const opponentChar = this.selectingPlayer === 1 ? this.p2Active : this.p1Active;

    this.promptText.setText(`${atk.name} — Target who?`);

    const bg1 = this.add.rectangle(W * 0.35, H * 0.80, 160, 44, 0x0f3460).setStrokeStyle(1, 0xffffff).setInteractive({ useHandCursor: true });
    const txt1 = this.add.text(W * 0.35, H * 0.80 - 6, `🗡 ${opponentChar.name}`, { fontSize: '12px', fill: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
    const sub1 = this.add.text(W * 0.35, H * 0.80 + 12, 'Full damage to character', { fontSize: '9px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    bg1.on('pointerover', () => bg1.setFillStyle(0xe94560));
    bg1.on('pointerout', () => bg1.setFillStyle(0x0f3460));
    bg1.on('pointerdown', () => this.onCharChoiceMade({ type: 'attack', key: atkKey, targetPlayer: false }));

    const bg2 = this.add.rectangle(W * 0.65, H * 0.80, 160, 44, 0x3a1a1a).setStrokeStyle(1, 0xff6666).setInteractive({ useHandCursor: true });
    const txt2 = this.add.text(W * 0.65, H * 0.80 - 6, `🎯 Player ${this.selectingPlayer === 1 ? 2 : 1}`, { fontSize: '12px', fill: '#ff6666', fontFamily: 'monospace' }).setOrigin(0.5);
    const sub2 = this.add.text(W * 0.65, H * 0.80 + 12, '1 HP to player directly', { fontSize: '9px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    bg2.on('pointerover', () => bg2.setFillStyle(0xe94560));
    bg2.on('pointerout', () => bg2.setFillStyle(0x3a1a1a));
    bg2.on('pointerdown', () => this.onCharChoiceMade({ type: 'attack', key: atkKey, targetPlayer: true }));

    const backBg = this.add.rectangle(W / 2, H * 0.92, 120, 30, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(W / 2, H * 0.92, '← Back', { fontSize: '12px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showCharActionMenu());

    this.buttons.push(bg1, txt1, sub1, bg2, txt2, sub2, backBg, backTxt);
  }

  // ── Switch Menu ─────────────────────────────────────────────────
  showSwitchMenu() {
    this.clearButtons();
    const W = this.battleW;
    const H = this.scale.height;
    const team = this.selectingPlayer === 1 ? this.p1Team : this.p2Team;
    const activeIdx = this.selectingPlayer === 1 ? this.p1Index : this.p2Index;
    const color = this.selectingPlayer === 1 ? 0x0f3460 : 0x5c2a2a;

    this.promptText.setText(`Player ${this.selectingPlayer} — Switch to who?`);

    const candidates = [];
    team.forEach((c, i) => { if (c.alive && i !== activeIdx) candidates.push({ char: c, index: i }); });

    const startX = W / 2 - (candidates.length) * 90;

    candidates.forEach((cand, i) => {
      const bx = startX + i * 180;
      const by = H * 0.80;

      const bg = this.add.rectangle(bx, by, 160, 55, color).setStrokeStyle(1, 0xffffff).setInteractive({ useHandCursor: true });
      const nameT = this.add.text(bx, by - 14, cand.char.name, { fontSize: '13px', fill: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
      const hpT = this.add.text(bx, by + 4, `HP: ${cand.char.currentHp}/${cand.char.maxHp}`, { fontSize: '10px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);

      const stages = cand.char.stages;
      const mods = ALLOCATABLE_STATS.filter(s => stages[s] !== 0)
        .map(s => `${STAT_LABELS[s]}${stages[s] > 0 ? '↑' : '↓'}${Math.abs(stages[s])}`)
        .join(' ');
      if (mods) {
        const modT = this.add.text(bx, by + 18, mods, { fontSize: '9px', fill: '#f0a500', fontFamily: 'monospace' }).setOrigin(0.5);
        this.buttons.push(modT);
      }

      bg.on('pointerover', () => bg.setFillStyle(0xe94560));
      bg.on('pointerout', () => bg.setFillStyle(color));
      bg.on('pointerdown', () => this.onCharChoiceMade({ type: 'switch', index: cand.index }));

      this.buttons.push(bg, nameT, hpT);
    });

    const backBg = this.add.rectangle(W / 2, H * 0.92, 120, 30, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(W / 2, H * 0.92, '← Back', { fontSize: '12px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showCharActionMenu());
    this.buttons.push(backBg, backTxt);
  }

  clearButtons() {
    this.buttons.forEach(b => b.destroy());
    this.buttons = [];
  }

  // ── Choice Made ─────────────────────────────────────────────────
  onCharChoiceMade(choice) {
    if (this.selectingPlayer === 1) {
      this.p1Choice = choice;
      this.selectingPlayer = 2;
      this.showPlayerActionMenu();
    } else {
      this.p2Choice = choice;
      this.selectingPlayer = 1;
      this.clearButtons();
      this.promptText.setText('');
      this.resolveRound();
    }
  }

  // ── Round Resolution ────────────────────────────────────────────
  resolveRound() {
    this.phase = 'resolve';
    this.roundNumber++;
    this.log.push(`── Round ${this.roundNumber} ──`);

    // Track blocking/protecting state for this round
    this.p1Blocking = (this.p1PlayerAction.key === 'block');
    this.p2Blocking = (this.p2PlayerAction.key === 'block');
    // Protect: blocks all damage but fails if used consecutively (any protect-type move)
    const p1TryProtect = (this.p1Choice.type === 'attack' && ATTACKS[this.p1Choice.key] && ATTACKS[this.p1Choice.key].type === 'protect');
    const p2TryProtect = (this.p2Choice.type === 'attack' && ATTACKS[this.p2Choice.key] && ATTACKS[this.p2Choice.key].type === 'protect');
    this.p1Protected = p1TryProtect && !this.p1UsedProtectLastTurn;
    this.p2Protected = p2TryProtect && !this.p2UsedProtectLastTurn;
    this.p1ProtectFailed = p1TryProtect && this.p1UsedProtectLastTurn;
    this.p2ProtectFailed = p2TryProtect && this.p2UsedProtectLastTurn;
    // Track for next turn
    this.p1UsedProtectLastTurn = p1TryProtect;
    this.p2UsedProtectLastTurn = p2TryProtect;

    let delay = 0;

    // Resolve player actions first
    delay = this.resolvePlayerActions(delay);

    // Then character actions
    const switches = [];
    const attacks = [];

    if (this.p1Choice.type === 'switch') switches.push({ player: 1, choice: this.p1Choice });
    else attacks.push({ player: 1, choice: this.p1Choice });

    if (this.p2Choice.type === 'switch') switches.push({ player: 2, choice: this.p2Choice });
    else attacks.push({ player: 2, choice: this.p2Choice });

    // Switches first
    switches.forEach(s => {
      this.time.delayedCall(delay, () => {
        const prop = s.player === 1 ? 'p1Index' : 'p2Index';
        const oldChar = s.player === 1 ? this.p1Active : this.p2Active;
        const enemy = s.player === 1 ? this.p2Active : this.p1Active;
        // Fire onExit for the departing character
        this.fireAbilityHooks('onExit', { char: oldChar, enemy, player: s.player });
        this[prop] = s.choice.index;
        const newChar = s.player === 1 ? this.p1Active : this.p2Active;
        this.log.push(`P${s.player} switches ${oldChar.name} → ${newChar.name}!`);
        // Clear stat stages on the departing character
        ALLOCATABLE_STATS.forEach(st => { oldChar.stages[st] = 0; });
        // Reset consecutive protect tracking on switch (new character hasn't used protect)
        if (s.player === 1) this.p1UsedProtectLastTurn = false;
        else this.p2UsedProtectLastTurn = false;
        // Fire onEntry for the arriving character
        this.fireAbilityHooks('onEntry', { char: newChar, enemy, player: s.player });
        this.refreshUI();
      });
      delay += 600;
    });

    // Attacks by priority bracket, then speed within each bracket
    this.time.delayedCall(delay, () => {
      const realAttacks = attacks.filter(a => {
        if (a.choice.type !== 'attack') return false;
        const atk = ATTACKS[a.choice.key];
        return atk.type !== 'protect';
      });

      attacks.forEach(a => {
        if (a.choice.type === 'attack' && ATTACKS[a.choice.key] && ATTACKS[a.choice.key].type === 'protect') {
          const char = a.player === 1 ? this.p1Active : this.p2Active;
          const failed = a.player === 1 ? this.p1ProtectFailed : this.p2ProtectFailed;
          if (failed) {
            this.log.push(`${char.name} tried to protect but it failed from consecutive use!`);
          } else {
            this.log.push(`${char.name} takes a protective stance!`);
          }
        }
      });
      this.refreshUI();

      if (realAttacks.length === 0) {
        this.time.delayedCall(400, () => this.checkRoundEnd());
        return;
      }

      // Build ordered list: higher priority first, then speed within same bracket
      const ordered = realAttacks.map(a => {
        const atk = ATTACKS[a.choice.key];
        const char = a.player === 1 ? this.p1Active : this.p2Active;
        const opp = a.player === 1 ? this.p2Active : this.p1Active;
        return {
          attacker: char,
          defender: opp,
          choice: a.choice,
          player: a.player,
          priority: atk.priority || 0,
          speed: effectiveStat(char, 'spd')
        };
      });

      ordered.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority; // higher priority first
        if (b.speed !== a.speed) return b.speed - a.speed; // higher speed first
        return Math.random() - 0.5; // tie-break randomly
      });

      // Execute sequentially with delays
      const executeNext = (idx) => {
        if (idx >= ordered.length) {
          this.time.delayedCall(600, () => this.checkRoundEnd());
          return;
        }
        const entry = ordered[idx];
        if (entry.attacker.currentHp > 0) {
          this.executeAttack(entry.attacker, entry.defender, entry.choice.key, entry.player, entry.choice.targetPlayer);
          this.refreshUI();
        }
        this.time.delayedCall(800, () => executeNext(idx + 1));
      };
      executeNext(0);
    });
  }

  // ── Resolve Player Actions ──────────────────────────────────────
  resolvePlayerActions(delay) {
    [1, 2].forEach(p => {
      const actionObj = p === 1 ? this.p1PlayerAction : this.p2PlayerAction;
      const actionKey = actionObj.key;
      const pa = PLAYER_ACTIONS[actionKey];
      if (!pa || actionKey === 'none') return;

      // Put this action on cooldown
      const actions = this.getActions(p);
      const entry = actions.find(a => a.key === actionKey);
      if (entry && pa.cooldown > 0) {
        entry.cooldownLeft = pa.cooldown;
      }

      this.time.delayedCall(delay, () => {
        const targetP = p === 1 ? 2 : 1;

        if (actionKey === 'heal') {
          const prop = p === 1 ? 'p1PlayerHp' : 'p2PlayerHp';
          if (this[prop] < MAX_PLAYER_HP) {
            this[prop] = Math.min(MAX_PLAYER_HP, this[prop] + 1);
            this.log.push(`Player ${p} heals 1 player HP!`);
          } else {
            this.log.push(`Player ${p} tries to heal but is already at full!`);
          }
        } else if (actionKey === 'strike') {
          const blocked = targetP === 1 ? this.p1Blocking : this.p2Blocking;
          const protectedByChar = targetP === 1 ? this.p1Protected : this.p2Protected;
          if (blocked || protectedByChar) {
            this.log.push(`Player ${p} strikes but Player ${targetP} ${blocked ? 'blocks' : "'s character protects them"}!`);
          } else {
            const prop = targetP === 1 ? 'p1PlayerHp' : 'p2PlayerHp';
            this[prop] = Math.max(0, this[prop] - 1);
            this.log.push(`Player ${p} strikes Player ${targetP} for 1 HP!`);
          }
        } else if (actionKey === 'block') {
          this.log.push(`Player ${p} braces for impact!`);
        } else if (pa.type === 'charAttack') {
          // Player action that attacks a character or player
          if (actionObj.targetPlayer) {
            // Target player for 1 HP
            this.dealPlayerDamage(targetP, 1, `Player ${p} fires ${pa.name} at Player ${targetP}`);
          } else {
            // Target opposing character with fixed stats
            const defender = p === 1 ? this.p2Active : this.p1Active;
            const dmg = calcPlayerActionDamage(pa, defender);
            defender.currentHp = Math.max(0, defender.currentHp - dmg);
            this.log.push(`Player ${p} uses ${pa.name} → ${dmg} dmg to ${defender.name}!`);
            if (defender.currentHp <= 0) {
              defender.alive = false;
              this.log.push(`${defender.name} is KO'd!`);
              this.dealPlayerDamage(targetP, 1, `Player ${targetP} loses 1 HP from the KO`);
            }
          }
        }
        this.refreshUI();
      });
      delay += 400;
    });

    return delay;
  }

  // ── Pending Effects: Queue a delayed or duration effect ────────
  queuePendingEffect(atkKey, attacker, attackerPlayer, targetPlayer) {
    const atk = ATTACKS[atkKey];
    const isDelay = (atk.delay || 0) > 0;
    const isDuration = (atk.duration || 0) > 0;

    // Check stackable — if not stackable and already pending, do nothing
    if (!atk.stackable) {
      const alreadyPending = this.pendingEffects.some(e => e.atkKey === atkKey && e.sourcePlayer === attackerPlayer);
      if (alreadyPending) {
        this.log.push(`${attacker.name} tries ${atk.name} but it's already active!`);
        return;
      }
    }

    // Snapshot caster stats at cast time (for damage calc later)
    const casterSnap = {
      key: attacker.key,
      name: attacker.name,
      maxHp: attacker.maxHp,
      hp: attacker.maxHp,
      atk: attacker.atk,
      def: attacker.def,
      mAtk: attacker.mAtk,
      mDef: attacker.mDef,
      spd: attacker.spd,
      stages: { ...attacker.stages },
      types: attacker.types ? [...attacker.types] : [],
      alive: true
    };

    // Determine target position: 'self' for heals/self-buffs, 'enemy' for attacks
    const isSelfTarget = atk.type === 'heal' || atk.type === 'status';
    const targetPosition = isSelfTarget ? 'self' : 'enemy';

    if (isDelay && isDuration) {
      // Delay before duration starts — queue delay first
      this.pendingEffects.push({
        id: this.nextPendingId++,
        atkKey,
        casterSnap,
        sourcePlayer: attackerPlayer,
        targetPosition,
        targetPlayerDirect: targetPlayer,
        turnsLeft: atk.delay,
        pendingDuration: atk.duration,
        totalDuration: atk.duration,
        phase: 'delay'
      });
    } else if (isDelay) {
      this.pendingEffects.push({
        id: this.nextPendingId++,
        atkKey,
        casterSnap,
        sourcePlayer: attackerPlayer,
        targetPosition,
        targetPlayerDirect: targetPlayer,
        turnsLeft: atk.delay,
        phase: 'delay'
      });
    } else if (isDuration) {
      // Duration starts immediately — first tick this round
      this.pendingEffects.push({
        id: this.nextPendingId++,
        atkKey,
        casterSnap,
        sourcePlayer: attackerPlayer,
        targetPosition,
        targetPlayerDirect: targetPlayer,
        turnsLeft: atk.duration,
        totalDuration: atk.duration,
        phase: 'duration'
      });
    }

    const emoji = atk.type === 'heal' ? '💚' : atk.type === 'status' ? '🔮' : '☄️';
    const turns = atk.delay || atk.duration;
    this.log.push(`${attacker.name} uses ${atk.name}! ${emoji} (${isDelay ? 'lands in' : 'lasts'} ${turns} turn${turns > 1 ? 's' : ''})`);
  }

  // ── Pending Effects: Resolve the target character for a position ──
  resolveTarget(effect) {
    if (effect.targetPosition === 'self') {
      // Self-targeting: the caster's slot
      const team = effect.sourcePlayer === 1 ? this.p1Team : this.p2Team;
      const idx = effect.sourcePlayer === 1 ? this.p1Index : this.p2Index;
      return { char: team[idx], player: effect.sourcePlayer };
    } else {
      // Enemy position: whoever is currently active on the opposing side
      const enemyPlayer = effect.sourcePlayer === 1 ? 2 : 1;
      const char = enemyPlayer === 1 ? this.p1Active : this.p2Active;
      return { char, player: enemyPlayer };
    }
  }

  // ── Pending Effects: Fire a single effect tick ────────────────
  firePendingEffect(effect) {
    const atk = ATTACKS[effect.atkKey];
    const { char: target, player: targetPlayer } = this.resolveTarget(effect);

    if (atk.type === 'heal') {
      if (!target || !target.alive) {
        this.log.push(`${atk.name} fizzles — no valid target!`);
        return;
      }
      const casterMaxHp = effect.casterSnap.maxHp || 100;
      const healAmt = Math.round(casterMaxHp * atk.power / 100);
      const healed = Math.min(healAmt, target.maxHp - target.currentHp);
      if (healed > 0) {
        target.currentHp += healed;
        this.log.push(`💚 ${atk.name} heals ${target.name} for ${healed} HP!`);
      } else {
        this.log.push(`💚 ${atk.name} — ${target.name} is already at full HP!`);
      }
    } else if (atk.type === 'status') {
      // Apply stat effects to the target position
      if (atk.statFx) {
        atk.statFx.forEach(fx => {
          const fxTarget = fx.target === 'self' ? this.resolveTarget({ ...effect, targetPosition: 'self' }).char
                                                 : this.resolveTarget({ ...effect, targetPosition: 'enemy' }).char;
          if (!fxTarget || !fxTarget.alive) return;
          fxTarget.stages[fx.stat] = Math.max(-4, Math.min(4, (fxTarget.stages[fx.stat] || 0) + fx.stages));
          const statLabel = STAT_LABELS[fx.stat] || fx.stat;
          const dir = fx.stages > 0 ? 'rose' : 'fell';
          const mult = stageMultiplier(fxTarget.stages[fx.stat]);
          this.log.push(`🔮 ${atk.name} — ${fxTarget.name}'s ${statLabel} ${dir}! (×${mult.toFixed(2)})`);
        });
      }
    } else {
      // Damage attack
      if (!target || !target.alive) {
        // If targeting enemy position and character is dead, still deal spread/player damage
        if (effect.targetPlayerDirect) {
          this.dealPlayerDamage(targetPlayer, 1, `☄️ ${atk.name} strikes Player ${targetPlayer}`);
        } else if (atk.spread) {
          const defenderPlayer = effect.sourcePlayer === 1 ? 2 : 1;
          this.dealPlayerDamage(defenderPlayer, 1, `☄️ ${atk.name} spreads to hit Player ${defenderPlayer}`);
          this.log.push(`☄️ ${atk.name} lands but the target slot is empty!`);
        } else {
          this.log.push(`☄️ ${atk.name} lands but the target slot is empty!`);
        }
        return;
      }

      if (effect.targetPlayerDirect) {
        const defenderPlayer = effect.sourcePlayer === 1 ? 2 : 1;
        this.dealPlayerDamage(defenderPlayer, 1, `☄️ ${atk.name} strikes Player ${defenderPlayer}`);
      } else {
        // Calculate damage using snapshotted caster stats
        const result = calcDamageResult(effect.atkKey, effect.casterSnap, target);
        if (result.isImmune) {
          this.log.push(`☄️ ${atk.name} lands on ${target.name} — immune!`);
          return;
        }
        target.currentHp = Math.max(0, target.currentHp - result.damage);
        const critTag = result.isCrit ? ' 💥' : '';
        this.log.push(`☄️ ${atk.name} lands on ${target.name} for ${result.damage} dmg!${critTag}`);
        if (result.typeLabel) this.log.push(result.typeLabel);

        const defenderPlayer = effect.sourcePlayer === 1 ? 2 : 1;
        if (target.currentHp <= 0) {
          target.alive = false;
          this.log.push(`${target.name} is KO'd!`);
          this.fireAbilityHooks('onKO', { char: target, enemy: effect.casterSnap, player: defenderPlayer });
          this.dealPlayerDamage(defenderPlayer, 1, `Player ${defenderPlayer} loses 1 HP from the KO`);
        }

        if (atk.spread) {
          this.dealPlayerDamage(defenderPlayer, 1, `☄️ ${atk.name} spreads to hit Player ${defenderPlayer}`);
        }
      }

      // Stat effects from the attack
      if (atk.statFx) {
        atk.statFx.forEach(fx => {
          const fxTarget = fx.target === 'self' ? this.resolveTarget({ ...effect, targetPosition: 'self' }).char : target;
          if (!fxTarget || !fxTarget.alive) return;
          fxTarget.stages[fx.stat] = Math.max(-4, Math.min(4, (fxTarget.stages[fx.stat] || 0) + fx.stages));
          const statLabel = STAT_LABELS[fx.stat] || fx.stat;
          const dir = fx.stages > 0 ? 'rose' : 'fell';
          const mult = stageMultiplier(fxTarget.stages[fx.stat]);
          this.log.push(`${fxTarget.name}'s ${statLabel} ${dir}! (×${mult.toFixed(2)})`);
        });
      }
    }
  }

  // ── Pending Effects: Tick all effects (called at round end) ───
  tickPendingEffects() {
    const toRemove = [];

    for (const effect of this.pendingEffects) {
      effect.turnsLeft--;

      if (effect.phase === 'delay' && effect.turnsLeft <= 0) {
        // Delay expired
        if (effect.pendingDuration) {
          // Transition to duration phase
          this.firePendingEffect(effect);
          effect.phase = 'duration';
          effect.turnsLeft = effect.pendingDuration - 1; // first tick just happened
          effect.pendingDuration = null;
          if (effect.turnsLeft <= 0) {
            toRemove.push(effect.id);
          }
        } else {
          // One-shot delayed effect
          this.firePendingEffect(effect);
          toRemove.push(effect.id);
        }
      } else if (effect.phase === 'duration' && effect.turnsLeft >= 0) {
        // Duration tick
        this.firePendingEffect(effect);
        if (effect.turnsLeft <= 0) {
          toRemove.push(effect.id);
        }
      }
    }

    // Clean up expired effects
    this.pendingEffects = this.pendingEffects.filter(e => !toRemove.includes(e.id));
  }

  // ── Execute Character Attack ────────────────────────────────────
  executeAttack(attacker, defender, atkKey, attackerPlayer, targetPlayer) {
    if (attacker.currentHp <= 0) return;

    const atk = ATTACKS[atkKey];

    // Check if this is a delayed or duration move
    if ((atk.delay || 0) > 0 || (atk.duration || 0) > 0) {
      this.queuePendingEffect(atkKey, attacker, attackerPlayer, targetPlayer);
      return;
    }

    const result = calcDamageResult(atkKey, attacker, defender);
    const defenderPlayer = attackerPlayer === 1 ? 2 : 1;

    // Apply item damage boost (passive items like War Belt / Spell Tome)
    if (result.damage > 0 && !result.isImmune && atk.type !== 'heal' && atk.type !== 'status') {
      const boostMult = this.getItemDamageBoost(attacker, atk.type);
      if (boostMult !== 1.0) {
        result.damage = Math.max(1, Math.round(result.damage * boostMult));
      }
    }

    // Apply ward damage reduction (consumable ward items on defender)
    if (result.damage > 0 && !result.isImmune && atk.damageType && atk.type !== 'heal') {
      const wardMult = this.fireItemOnHitByType(defender, atk.damageType);
      if (wardMult !== 1.0) {
        result.damage = Math.max(1, Math.round(result.damage * wardMult));
      }
    }

    if (atk.type === 'heal') {
      const healed = Math.min(-result.damage, attacker.maxHp - attacker.currentHp);
      attacker.currentHp += healed;
      this.log.push(`${attacker.name} heals for ${healed} HP!`);
    } else if (atk.type === 'status') {
      this.log.push(`${attacker.name} uses ${atk.name}!`);

      // Special status moves: item interaction
      if (atkKey === 'disarm') {
        if (defender.item && !defender.itemConsumed) {
          const removedItem = ITEMS[defender.item];
          const itemName = removedItem ? removedItem.name : defender.item;
          defender.item = null;
          defender.itemConsumed = false;
          this.log.push(`${defender.name}'s ${itemName} was knocked away!`);
        } else {
          this.log.push(`${defender.name} has no item to disarm!`);
        }
      } else if (atkKey === 'itemSwap') {
        const aItem = attacker.item;
        const aConsumed = attacker.itemConsumed;
        const aSealed = attacker.itemSealed;
        attacker.item = defender.item;
        attacker.itemConsumed = defender.itemConsumed;
        attacker.itemSealed = defender.itemSealed;
        defender.item = aItem;
        defender.itemConsumed = aConsumed;
        defender.itemSealed = aSealed;
        const aName = attacker.item && ITEMS[attacker.item] ? ITEMS[attacker.item].name : 'nothing';
        const dName = defender.item && ITEMS[defender.item] ? ITEMS[defender.item].name : 'nothing';
        this.log.push(`Items swapped! ${attacker.name} now holds ${aName}, ${defender.name} now holds ${dName}`);
      }
    } else if (result.isImmune) {
      this.log.push(`${attacker.name} uses ${atk.name} → ${defender.name} is immune!`);
      return;
    } else if (targetPlayer) {
      this.dealPlayerDamage(defenderPlayer, 1, `${attacker.name} fires ${atk.name} at Player ${defenderPlayer}`);
    } else {
      // Check if defender is protected (blocks all character damage)
      const defProtected = defenderPlayer === 1 ? this.p1Protected : this.p2Protected;
      if (defProtected && result.damage > 0) {
        this.log.push(`${attacker.name} uses ${atk.name} → ${defender.name} is protected! No damage!`);
        // Spread still gets blocked by dealPlayerDamage's protect check
        if (atk.spread) {
          this.dealPlayerDamage(defenderPlayer, 1, `${atk.name} spreads to hit Player ${defenderPlayer}`);
        }
        return;
      }
      defender.currentHp = Math.max(0, defender.currentHp - result.damage);
      const critTag = result.isCrit ? ' 💥' : '';
      this.log.push(`${attacker.name} uses ${atk.name} → ${result.damage} dmg to ${defender.name}!${critTag}`);
      if (result.typeLabel) this.log.push(result.typeLabel);

      // Fire onHit for defender, onDealDamage for attacker
      if (defender.alive) {
        this.fireAbilityHooks('onHit', { char: defender, enemy: attacker, player: defenderPlayer });
      }
      this.fireAbilityHooks('onDealDamage', { char: attacker, enemy: defender, player: attackerPlayer });

      // Check Healing Herb trigger (below 50% HP)
      if (defender.alive && defender.currentHp > 0) {
        this.fireItemOnHpBelow50(defender, defenderPlayer);
      }

      if (defender.currentHp <= 0) {
        defender.alive = false;
        this.log.push(`${defender.name} is KO'd!`);
        // Fire onKO for the KO'd character
        this.fireAbilityHooks('onKO', { char: defender, enemy: attacker, player: defenderPlayer });
        this.dealPlayerDamage(defenderPlayer, 1, `Player ${defenderPlayer} loses 1 HP from the KO`);
      }

      if (atk.spread) {
        this.dealPlayerDamage(defenderPlayer, 1, `${atk.name} spreads to hit Player ${defenderPlayer}`);
      }
    }

    // Stat effects only apply if not immune
    if (atk.statFx) {
      atk.statFx.forEach(fx => {
        const target = fx.target === 'self' ? attacker : defender;
        if (!target.alive) return;
        target.stages[fx.stat] = Math.max(-4, Math.min(4, (target.stages[fx.stat] || 0) + fx.stages));
        const statLabel = STAT_LABELS[fx.stat] || fx.stat;
        const dir = fx.stages > 0 ? 'rose' : 'fell';
        const mult = stageMultiplier(target.stages[fx.stat]);
        this.log.push(`${target.name}'s ${statLabel} ${dir}! (×${mult.toFixed(2)})`);
      });
    }
  }

  // ── Deal Player HP Damage (respects block/protect) ──────────────
  dealPlayerDamage(targetPlayer, amount, logMsg) {
    const blocked = targetPlayer === 1 ? this.p1Blocking : this.p2Blocking;
    const protectedByChar = targetPlayer === 1 ? this.p1Protected : this.p2Protected;

    if (blocked) {
      this.log.push(`${logMsg} — blocked!`);
      if (targetPlayer === 1) this.p1Blocking = false;
      else this.p2Blocking = false;
      return;
    }
    if (protectedByChar) {
      this.log.push(`${logMsg} — character absorbs the blow!`);
      if (targetPlayer === 1) this.p1Protected = false;
      else this.p2Protected = false;
      return;
    }

    const prop = targetPlayer === 1 ? 'p1PlayerHp' : 'p2PlayerHp';
    this[prop] = Math.max(0, this[prop] - amount);
    this.log.push(`${logMsg}!`);
  }

  // ── Post-round checks ──────────────────────────────────────────
  checkRoundEnd() {
    const p1Alive = this.p1Team.some(c => c.alive);
    const p2Alive = this.p2Team.some(c => c.alive);
    const p1PlayerAlive = this.p1PlayerHp > 0;
    const p2PlayerAlive = this.p2PlayerHp > 0;

    const p1Lost = !p1Alive || !p1PlayerAlive;
    const p2Lost = !p2Alive || !p2PlayerAlive;

    if (p1Lost || p2Lost) {
      this.phase = 'gameover';
      let winner;
      if (p1Lost && p2Lost) winner = 'Draw';
      else if (p2Lost) winner = 'Player 1';
      else winner = 'Player 2';

      const reason = [];
      if (!p1Alive) reason.push('P1 team wiped');
      if (!p1PlayerAlive) reason.push('P1 player HP depleted');
      if (!p2Alive) reason.push('P2 team wiped');
      if (!p2PlayerAlive) reason.push('P2 player HP depleted');

      this.promptText.setText(`${winner} wins! (${reason.join(', ')})\nClick to play again.`);
      this.refreshUI();
      this.input.once('pointerdown', () => this.scene.start('BattlePrepScene'));
      return;
    }

    if (!this.p1Active.alive) this.forceSwap(1);
    if (!this.p2Active.alive) this.forceSwap(2);

    // Fire turnEnd ability hooks for both active characters
    if (this.p1Active.alive) {
      this.fireAbilityHooks('turnEnd', { char: this.p1Active, enemy: this.p2Active, player: 1 });
      this.fireItemTurnEnd(this.p1Active, 1);
    }
    if (this.p2Active.alive) {
      this.fireAbilityHooks('turnEnd', { char: this.p2Active, enemy: this.p1Active, player: 2 });
      this.fireItemTurnEnd(this.p2Active, 2);
    }

    // Tick pending multi-turn effects
    this.tickPendingEffects();

    // Tick cooldowns down
    this.p1Actions.forEach(a => { if (a.cooldownLeft > 0) a.cooldownLeft--; });
    this.p2Actions.forEach(a => { if (a.cooldownLeft > 0) a.cooldownLeft--; });

    // Re-check for KOs caused by pending effects (e.g. delayed damage)
    if (!this.p1Active.alive && this.p1Team.some(c => c.alive)) this.forceSwap(1);
    if (!this.p2Active.alive && this.p2Team.some(c => c.alive)) this.forceSwap(2);

    // Check win condition again after pending effects
    const p1StillAlive = this.p1Team.some(c => c.alive) && this.p1PlayerHp > 0;
    const p2StillAlive = this.p2Team.some(c => c.alive) && this.p2PlayerHp > 0;
    if (!p1StillAlive || !p2StillAlive) {
      this.refreshUI();
      // Determine winner
      const p1Lost2 = !this.p1Team.some(c => c.alive) || this.p1PlayerHp <= 0;
      const p2Lost2 = !this.p2Team.some(c => c.alive) || this.p2PlayerHp <= 0;
      let winner;
      if (p1Lost2 && p2Lost2) winner = 'Draw';
      else if (p2Lost2) winner = 'Player 1';
      else winner = 'Player 2';
      this.phase = 'gameover';
      this.promptText.setText(`${winner} wins!\nClick to play again.`);
      this.input.once('pointerdown', () => this.scene.start('BattlePrepScene'));
      return;
    }

    this.refreshUI();
    this.startNextRound();
  }

  startNextRound() {
    this.phase = 'select';

    // Fire turnStart ability hooks
    if (this.p1Active.alive) {
      this.fireAbilityHooks('turnStart', { char: this.p1Active, enemy: this.p2Active, player: 1 });
    }
    if (this.p2Active.alive) {
      this.fireAbilityHooks('turnStart', { char: this.p2Active, enemy: this.p1Active, player: 2 });
    }
    this.refreshUI();

    this.time.delayedCall(400, () => this.showPlayerActionMenu());
  }

  forceSwap(player) {
    const team = player === 1 ? this.p1Team : this.p2Team;
    const prop = player === 1 ? 'p1Index' : 'p2Index';
    for (let i = 0; i < team.length; i++) {
      if (team[i].alive) {
        this[prop] = i;
        const newChar = player === 1 ? this.p1Active : this.p2Active;
        const enemy = player === 1 ? this.p2Active : this.p1Active;
        this.fireAbilityHooks('onEntry', { char: newChar, enemy, player });
        return;
      }
    }
  }
}
