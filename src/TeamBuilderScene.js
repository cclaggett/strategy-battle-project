// ── Team Builder Scene ──────────────────────────────────────────────
class TeamBuilderScene extends Phaser.Scene {
  constructor() {
    super('TeamBuilderScene');
  }

  init() {
    this.currentPlayer = 1;
    this.step = 'pickChar';   // 'pickChar' | 'pickAttacks' | 'pickAbility' | 'pickItem' | 'pickSpecialization' | 'allocStats' | 'pickPlayerActions'
    this.p1Picks = [];
    this.p2Picks = [];
    this.p1PlayerActions = [];
    this.p2PlayerActions = [];
    this.currentCharKey = null;
    this.selectedAttacks = [];
    this.selectedAbility = null;
    this.selectedItem = null;
    this.selectedSpecialization = null;
    this.selectedPlayerActions = [];
    this.statAlloc = {};
    this.buttons = [];
    this.playerActionsDrafted = { 1: false, 2: false };
  }

  get currentPicks() { return this.currentPlayer === 1 ? this.p1Picks : this.p2Picks; }
  get pointsUsed() { return Object.values(this.statAlloc).reduce((a, b) => a + b, 0); }
  get pointsLeft() { return STAT_POINTS - this.pointsUsed; }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.add.rectangle(W / 2, H / 2, W, H, 0x1a1a2e);
    this.titleText = this.add.text(W / 2, 20, '', { fontSize: '20px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5, 0);
    this.subtitleText = this.add.text(W / 2, 48, '', { fontSize: '13px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5, 0);
    this.infoText = this.add.text(W / 2, H - 30, '', { fontSize: '11px', fill: '#666', fontFamily: 'monospace' }).setOrigin(0.5, 0.5);

    // Start with load/build choice
    this.showTeamChoice();
  }

  clearButtons() {
    this.buttons.forEach(b => b.destroy());
    this.buttons = [];
  }

  // ── Team Save / Load ──────────────────────────────────────────
  static STORAGE_KEY = 'strategyGame_savedTeams';

  getSavedTeams() {
    try {
      return JSON.parse(localStorage.getItem(TeamBuilderScene.STORAGE_KEY)) || {};
    } catch { return {}; }
  }

  saveTeamToStorage(name, teamData) {
    const teams = this.getSavedTeams();
    teams[name] = teamData;
    localStorage.setItem(TeamBuilderScene.STORAGE_KEY, JSON.stringify(teams));
  }

  deleteTeamFromStorage(name) {
    const teams = this.getSavedTeams();
    delete teams[name];
    localStorage.setItem(TeamBuilderScene.STORAGE_KEY, JSON.stringify(teams));
  }

  showTeamChoice() {
    this.clearButtons();
    const W = this.scale.width;
    const H = this.scale.height;
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';
    const saved = this.getSavedTeams();
    const teamNames = Object.keys(saved);

    this.titleText.setText(`Player ${this.currentPlayer} — Team Setup`);
    this.subtitleText.setText('Load a saved team or build a new one');

    // Build New button
    const newBg = this.add.rectangle(W / 2, 100, 300, 44, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
    const newTxt = this.add.text(W / 2, 100, '+ Build New Team', { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
    newBg.on('pointerover', () => newBg.setFillStyle(0x22c55e));
    newBg.on('pointerout', () => newBg.setFillStyle(0x166534));
    newBg.on('pointerdown', () => this.showPlayerActionSelect());
    this.buttons.push(newBg, newTxt);

    if (teamNames.length === 0) {
      const noTeams = this.add.text(W / 2, 180, 'No saved teams yet', { fontSize: '13px', fill: '#555', fontFamily: 'monospace' }).setOrigin(0.5);
      this.buttons.push(noTeams);
    } else {
      const header = this.add.text(W / 2, 160, '— Saved Teams —', { fontSize: '13px', fill: '#888', fontFamily: 'monospace' }).setOrigin(0.5);
      this.buttons.push(header);

      teamNames.forEach((name, i) => {
        const team = saved[name];
        const by = 200 + i * 56;

        // Team summary
        const charNames = team.characters.map(c => {
          const r = ROSTER[c.key];
          return r ? r.name : c.key;
        }).join(', ');

        const bg = this.add.rectangle(W / 2, by, 550, 46, 0x16213e).setStrokeStyle(1, 0x333333).setInteractive({ useHandCursor: true });
        const nameT = this.add.text(W / 2 - 240, by - 8, name, { fontSize: '14px', fill: accent, fontFamily: 'monospace' });
        const detailT = this.add.text(W / 2 - 240, by + 10, charNames, { fontSize: '10px', fill: '#888', fontFamily: 'monospace' });

        bg.on('pointerover', () => bg.setStrokeStyle(2, parseInt(accent.replace('#', ''), 16)));
        bg.on('pointerout', () => bg.setStrokeStyle(1, 0x333333));
        bg.on('pointerdown', () => this.loadSavedTeam(name));

        // Delete button
        const delBg = this.add.rectangle(W / 2 + 250, by, 30, 30, 0x5c2a2a).setStrokeStyle(1, 0xe94560).setInteractive({ useHandCursor: true });
        const delTxt = this.add.text(W / 2 + 250, by, '✕', { fontSize: '14px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);
        delBg.on('pointerdown', (pointer) => {
          pointer.event.stopPropagation();
          this.deleteTeamFromStorage(name);
          this.showTeamChoice();
        });

        this.buttons.push(bg, nameT, detailT, delBg, delTxt);
      });
    }

    this.infoText.setText('');
  }

  loadSavedTeam(name) {
    const saved = this.getSavedTeams();
    const team = saved[name];
    if (!team) return;

    // Validate: check all characters and attacks still exist
    for (const c of team.characters) {
      if (!ROSTER[c.key]) { alert(`Character "${c.key}" no longer exists. Cannot load.`); return; }
      for (const a of c.attacks) {
        if (!ATTACKS[a]) { alert(`Attack "${a}" no longer exists. Cannot load.`); return; }
      }
    }
    for (const pa of team.playerActions) {
      if (pa !== 'none' && !PLAYER_ACTIONS[pa]) { alert(`Player action "${pa}" no longer exists. Cannot load.`); return; }
    }

    // Apply the team
    const picks = team.characters.map(c => ({
      key: c.key,
      attacks: [...c.attacks],
      ability: c.ability || null,
      item: c.item || null,
      specialization: c.specialization || null,
      bonuses: { ...c.bonuses },
    }));

    if (this.currentPlayer === 1) {
      this.p1Picks = picks;
      this.p1PlayerActions = [...team.playerActions];
    } else {
      this.p2Picks = picks;
      this.p2PlayerActions = [...team.playerActions];
    }

    this.playerActionsDrafted[this.currentPlayer] = true;

    // Advance
    if (this.currentPlayer === 1) {
      this.currentPlayer = 2;
      this.selectedPlayerActions = [];
      this.showTeamChoice();
    } else {
      this.scene.start('BattleScene', {
        p1Picks: this.p1Picks,
        p2Picks: this.p2Picks,
        p1PlayerActions: this.p1PlayerActions,
        p2PlayerActions: this.p2PlayerActions,
      });
    }
  }

  showSavePrompt() {
    this.clearButtons();
    const W = this.scale.width;
    const H = this.scale.height;
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';
    const picks = this.currentPicks;

    this.titleText.setText(`Player ${this.currentPlayer} — Team Complete!`);

    // Show team summary
    const summaryLines = picks.map(p => {
      const char = ROSTER[p.key];
      const atkNames = p.attacks.map(a => ATTACKS[a].name).join(', ');
      const abilityName = p.ability && ABILITIES[p.ability] ? ` | ${ABILITIES[p.ability].name}` : '';
      const itemName = p.item && ITEMS[p.item] ? ` ${ITEMS[p.item].emoji}${ITEMS[p.item].name}` : '';
      const specName = p.specialization && SPECIALIZATIONS[p.specialization] ? ` [${SPECIALIZATIONS[p.specialization].emoji}${SPECIALIZATIONS[p.specialization].name}]` : '';
      const bonusStr = ALLOCATABLE_STATS
        .filter(s => p.bonuses[s] > 0)
        .map(s => `${STAT_LABELS[s]}+${p.bonuses[s]}`)
        .join(' ');
      return `${char.name}: ${atkNames}${abilityName}${itemName}${specName}${bonusStr ? '  [' + bonusStr + ']' : ''}`;
    });

    const playerActions = this.currentPlayer === 1 ? this.p1PlayerActions : this.p2PlayerActions;
    const paNames = playerActions.map(k => PLAYER_ACTIONS[k].name).join(', ');
    summaryLines.push(`Actions: ${paNames}`);

    summaryLines.forEach((line, i) => {
      const t = this.add.text(W / 2, 90 + i * 24, line, { fontSize: '12px', fill: '#ccc', fontFamily: 'monospace' }).setOrigin(0.5);
      this.buttons.push(t);
    });

    this.subtitleText.setText('Save this team for later?');

    const saveY = 90 + summaryLines.length * 24 + 40;

    // Save button
    const saveBg = this.add.rectangle(W / 2 - 80, saveY, 200, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
    const saveTxt = this.add.text(W / 2 - 80, saveY, '💾 Save Team', { fontSize: '15px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
    saveBg.on('pointerover', () => saveBg.setFillStyle(0x22c55e));
    saveBg.on('pointerout', () => saveBg.setFillStyle(0x166534));
    saveBg.on('pointerdown', () => {
      const name = prompt('Enter a name for this team:');
      if (name && name.trim()) {
        this.saveTeamToStorage(name.trim(), {
          characters: picks.map(p => ({
            key: p.key,
            attacks: [...p.attacks],
            ability: p.ability || null,
            item: p.item || null,
            bonuses: { ...p.bonuses },
          })),
          playerActions: [...playerActions],
        });
        this.infoText.setText(`Team "${name.trim()}" saved!`).setFill('#4ade80');
        // Brief delay then advance
        this.time.delayedCall(800, () => this.advanceAfterTeam());
      }
    });
    this.buttons.push(saveBg, saveTxt);

    // Skip button
    const skipBg = this.add.rectangle(W / 2 + 120, saveY, 160, 40, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const skipTxt = this.add.text(W / 2 + 120, saveY, 'Skip →', { fontSize: '15px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    skipBg.on('pointerover', () => skipBg.setFillStyle(0x444444));
    skipBg.on('pointerout', () => skipBg.setFillStyle(0x333333));
    skipBg.on('pointerdown', () => this.advanceAfterTeam());
    this.buttons.push(skipBg, skipTxt);

    this.infoText.setText('');
  }

  advanceAfterTeam() {
    if (this.currentPlayer === 1) {
      this.currentPlayer = 2;
      this.selectedPlayerActions = [];
      this.showTeamChoice();
    } else {
      this.scene.start('BattleScene', {
        p1Picks: this.p1Picks,
        p2Picks: this.p2Picks,
        p1PlayerActions: this.p1PlayerActions,
        p2PlayerActions: this.p2PlayerActions,
      });
    }
  }

  // ── Player Action Selection ────────────────────────────────────
  showPlayerActionSelect() {
    this.clearButtons();
    this.step = 'pickPlayerActions';
    const W = this.scale.width;
    const H = this.scale.height;
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';

    this.titleText.setText(`Player ${this.currentPlayer} — Pick Your Actions`);
    this.subtitleText.setText(`Choose ${PLAYER_ACTION_SLOTS} player actions (${this.selectedPlayerActions.length}/${PLAYER_ACTION_SLOTS}). Pass is always available.`);

    // Get all selectable player actions (exclude 'none'/pass — it's always available)
    const actionKeys = Object.keys(PLAYER_ACTIONS).filter(k => k !== 'none' && k !== 'strike');
    const startY = 95;

    actionKeys.forEach((key, i) => {
      const pa = PLAYER_ACTIONS[key];
      const by = startY + i * 52;
      const isSelected = this.selectedPlayerActions.includes(key);

      const bg = this.add.rectangle(W / 2, by, 550, 42, isSelected ? 0x1a4a1a : 0x16213e)
        .setStrokeStyle(1, isSelected ? 0x4ade80 : 0x333333)
        .setInteractive({ useHandCursor: true });

      let label = `${pa.name}`;
      if (pa.cooldown > 0) label += `  [CD: ${pa.cooldown} turns]`;
      if (pa.power) label += `  Pow: ${pa.power}`;
      if (pa.offenseBase) {
        const statName = STAT_LABELS[pa.offenseStat] || pa.offenseStat;
        label += `  ${statName}: ${pa.offenseBase}`;
      }
      if (pa.range === 'long') label += '  🎯';

      const txt = this.add.text(W / 2, by - 6, label, { fontSize: '12px', fill: isSelected ? '#4ade80' : '#ccc', fontFamily: 'monospace' }).setOrigin(0.5);
      const descT = this.add.text(W / 2, by + 12, pa.description, { fontSize: '9px', fill: '#888', fontFamily: 'monospace' }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        if (isSelected) {
          this.selectedPlayerActions = this.selectedPlayerActions.filter(a => a !== key);
        } else if (this.selectedPlayerActions.length < PLAYER_ACTION_SLOTS) {
          this.selectedPlayerActions.push(key);
        }
        this.showPlayerActionSelect();
      });

      this.buttons.push(bg, txt, descT);
    });

    // Confirm button
    if (this.selectedPlayerActions.length === PLAYER_ACTION_SLOTS) {
      const confirmBg = this.add.rectangle(W / 2, H - 60, 220, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
      const confirmTxt = this.add.text(W / 2, H - 60, '✓ Pick Characters →', { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
      confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x22c55e));
      confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x166534));
      confirmBg.on('pointerdown', () => {
        if (this.currentPlayer === 1) {
          this.p1PlayerActions = [...this.selectedPlayerActions];
        } else {
          this.p2PlayerActions = [...this.selectedPlayerActions];
        }
        this.playerActionsDrafted[this.currentPlayer] = true;
        this.showCharacterSelect();
      });
      this.buttons.push(confirmBg, confirmTxt);
    }

    this.infoText.setText('Pass is always free and has no cooldown.');
  }

  // ── Character Selection ────────────────────────────────────────
  showCharacterSelect() {
    this.clearButtons();
    this.step = 'pickChar';
    const W = this.scale.width;
    const picked = this.currentPicks.length;
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';

    this.titleText.setText(`Player ${this.currentPlayer} — Pick Character ${picked + 1} of ${TEAM_SIZE}`);
    this.subtitleText.setText('Choose a character for your team');

    const currentTeamKeys = new Set(this.currentPicks.map(p => p.key));
    const keys = Object.keys(ROSTER).filter(k => !currentTeamKeys.has(k));
    const cols = Math.min(keys.length, 4);
    const startX = W / 2 - (cols - 1) * 95;

    keys.forEach((key, i) => {
      const char = ROSTER[key];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * 190;
      const by = 110 + row * 160;

      const card = this.add.rectangle(bx, by, 170, 140, 0x16213e).setStrokeStyle(1, 0x333333).setInteractive({ useHandCursor: true });
      const typeEmojis = (char.types || []).map(t => TYPE_CHART.types[t] ? TYPE_CHART.types[t].emoji : '').join(' ');
      const nameT = this.add.text(bx, by - 50, `${typeEmojis} ${char.name}`, { fontSize: '15px', fill: accent, fontFamily: 'monospace' }).setOrigin(0.5);
      const statsStr = `HP ${char.hp}  ATK ${char.atk}  DEF ${char.def}\nMAG ${char.mAtk}  RES ${char.mDef}  SPD ${char.spd}`;
      const statsT = this.add.text(bx, by - 15, statsStr, { fontSize: '10px', fill: '#888', fontFamily: 'monospace', align: 'center' }).setOrigin(0.5);
      const poolNames = char.pool.map(a => ATTACKS[a].name).join(', ');
      const poolT = this.add.text(bx, by + 30, poolNames, { fontSize: '9px', fill: '#555', fontFamily: 'monospace', align: 'center', wordWrap: { width: 160 } }).setOrigin(0.5);

      card.on('pointerover', () => card.setStrokeStyle(2, parseInt(accent.replace('#', ''), 16)));
      card.on('pointerout', () => card.setStrokeStyle(1, 0x333333));
      card.on('pointerdown', () => {
        this.currentCharKey = key;
        this.selectedAttacks = [];
        this.showAttackSelect();
      });

      this.buttons.push(card, nameT, statsT, poolT);
    });

    const pickNames = this.currentPicks.map(p => ROSTER[p.key].name).join(', ');
    this.infoText.setText(picked > 0 ? `Team so far: ${pickNames}` : '');
  }

  // ── Attack Selection ───────────────────────────────────────────
  showAttackSelect() {
    this.clearButtons();
    this.step = 'pickAttacks';
    const W = this.scale.width;
    const H = this.scale.height;
    const char = ROSTER[this.currentCharKey];
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';

    this.titleText.setText(`Player ${this.currentPlayer} — Attacks for ${char.name}`);
    this.subtitleText.setText(`Pick ${ATTACK_SLOTS} attacks (${this.selectedAttacks.length}/${ATTACK_SLOTS} selected)`);

    const statsSummary = this.add.text(W / 2, 80, `HP ${char.hp}  ATK ${char.atk}  DEF ${char.def}  MAG ${char.mAtk}  RES ${char.mDef}  SPD ${char.spd}`, {
      fontSize: '11px', fill: '#888', fontFamily: 'monospace'
    }).setOrigin(0.5);
    this.buttons.push(statsSummary);

    const pool = char.pool;
    const startY = 115;

    pool.forEach((atkKey, i) => {
      const atk = ATTACKS[atkKey];
      const by = startY + i * 48;
      const isSelected = this.selectedAttacks.includes(atkKey);

      const bg = this.add.rectangle(W / 2, by, 550, 38, isSelected ? 0x1a4a1a : 0x16213e)
        .setStrokeStyle(1, isSelected ? 0x4ade80 : 0x333333)
        .setInteractive({ useHandCursor: true });

      const typeEmoji = atk.damageType && TYPE_CHART.types[atk.damageType] ? TYPE_CHART.types[atk.damageType].emoji + ' ' : '';
      let label = `${typeEmoji}${atk.name}  [${atk.type.toUpperCase()}]`;
      if (atk.power > 0) label += `  Pow: ${atk.power}`;
      if (atk.spread) label += '  🌊';
      if (atk.range === 'long') label += '  🎯';
      if (atk.statFx) {
        const fxStr = atk.statFx.map(fx => {
          const dir = fx.stages > 0 ? '↑' : '↓';
          const tgt = fx.target === 'self' ? 'self' : 'enemy';
          return `${STAT_LABELS[fx.stat] || fx.stat}${dir} (${tgt})`;
        }).join(', ');
        label += `  ${fxStr}`;
      }
      label += `  — ${atk.description}`;

      const txt = this.add.text(W / 2, by, label, { fontSize: '11px', fill: isSelected ? '#4ade80' : '#ccc', fontFamily: 'monospace' }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        if (isSelected) {
          this.selectedAttacks = this.selectedAttacks.filter(a => a !== atkKey);
        } else if (this.selectedAttacks.length < ATTACK_SLOTS) {
          this.selectedAttacks.push(atkKey);
        }
        this.showAttackSelect();
      });

      this.buttons.push(bg, txt);
    });

    if (this.selectedAttacks.length === ATTACK_SLOTS) {
      const confirmBg = this.add.rectangle(W / 2, H - 70, 200, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
      const confirmTxt = this.add.text(W / 2, H - 70, '✓ Pick Stats →', { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
      confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x22c55e));
      confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x166534));
      confirmBg.on('pointerdown', () => {
        this.selectedAbility = null;
        this.showAbilitySelect();
      });
      this.buttons.push(confirmBg, confirmTxt);
    }

    const backBg = this.add.rectangle(80, H - 70, 120, 36, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(80, H - 70, '← Back', { fontSize: '13px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showCharacterSelect());
    this.buttons.push(backBg, backTxt);

    this.infoText.setText('');
  }

  // ── Ability Selection ──────────────────────────────────────────
  showAbilitySelect() {
    this.clearButtons();
    this.step = 'pickAbility';
    const W = this.scale.width;
    const H = this.scale.height;
    const char = ROSTER[this.currentCharKey];
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';
    const pool = char.abilityPool || [];

    this.titleText.setText(`Player ${this.currentPlayer} — Ability for ${char.name}`);
    this.subtitleText.setText('Choose 1 passive ability');

    if (pool.length === 0) {
      // No abilities available, skip to items
      this.selectedItem = null;
      this.showItemSelect();
      return;
    }

    const startY = 120;

    pool.forEach((abilityKey, i) => {
      const ability = ABILITIES[abilityKey];
      if (!ability) return;
      const by = startY + i * 80;
      const isSelected = this.selectedAbility === abilityKey;

      const bg = this.add.rectangle(W / 2, by, 550, 65, isSelected ? 0x1a4a1a : 0x16213e)
        .setStrokeStyle(2, isSelected ? 0x4ade80 : 0x333333)
        .setInteractive({ useHandCursor: true });

      const nameT = this.add.text(W / 2, by - 16, ability.name, {
        fontSize: '16px', fill: isSelected ? '#4ade80' : accent, fontFamily: 'monospace'
      }).setOrigin(0.5);

      const triggerLabel = {
        onEntry: '⚡ On Entry', onExit: '🚪 On Exit', onHit: '💥 When Hit',
        onKO: '💀 On KO', onDealDamage: '⚔ On Deal Damage',
        turnStart: '🔄 Turn Start', turnEnd: '🔄 Turn End'
      }[ability.trigger] || ability.trigger;

      const triggerT = this.add.text(W / 2, by + 4, triggerLabel, {
        fontSize: '11px', fill: '#f0a500', fontFamily: 'monospace'
      }).setOrigin(0.5);

      const descT = this.add.text(W / 2, by + 22, ability.description, {
        fontSize: '11px', fill: '#aaa', fontFamily: 'monospace'
      }).setOrigin(0.5);

      bg.on('pointerover', () => { if (!isSelected) bg.setStrokeStyle(2, parseInt(accent.replace('#', ''), 16)); });
      bg.on('pointerout', () => { if (!isSelected) bg.setStrokeStyle(2, 0x333333); });
      bg.on('pointerdown', () => {
        this.selectedAbility = abilityKey;
        this.showAbilitySelect();
      });

      this.buttons.push(bg, nameT, triggerT, descT);
    });

    if (this.selectedAbility) {
      const confirmBg = this.add.rectangle(W / 2, H - 60, 200, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
      const confirmTxt = this.add.text(W / 2, H - 60, '✓ Pick Item →', { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
      confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x22c55e));
      confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x166534));
      confirmBg.on('pointerdown', () => {
        this.selectedItem = null;
        this.showItemSelect();
      });
      this.buttons.push(confirmBg, confirmTxt);
    }

    const backBg = this.add.rectangle(80, H - 60, 120, 36, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(80, H - 60, '← Back', { fontSize: '13px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showAttackSelect());
    this.buttons.push(backBg, backTxt);

    this.infoText.setText('');
  }

  // ── Item Selection ──────────────────────────────────────────────
  showItemSelect() {
    this.clearButtons();
    this.step = 'pickItem';
    const W = this.scale.width;
    const H = this.scale.height;
    const char = ROSTER[this.currentCharKey];
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';

    this.titleText.setText(`Player ${this.currentPlayer} — Item for ${char.name}`);
    this.subtitleText.setText('Choose 1 held item (or skip for none)');

    const itemKeys = Object.keys(ITEMS);
    const startY = 100;

    itemKeys.forEach((key, i) => {
      const item = ITEMS[key];
      const by = startY + i * 48;
      const isSelected = this.selectedItem === key;

      const bg = this.add.rectangle(W / 2, by, 600, 38, isSelected ? 0x1a4a1a : 0x16213e)
        .setStrokeStyle(1, isSelected ? 0x4ade80 : 0x333333)
        .setInteractive({ useHandCursor: true });

      let label = `${item.emoji} ${item.name}`;
      if (item.consumable) label += '  [consumable]';
      label += `  — ${item.description}`;

      const txt = this.add.text(W / 2, by, label, {
        fontSize: '11px', fill: isSelected ? '#4ade80' : '#ccc', fontFamily: 'monospace'
      }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        this.selectedItem = isSelected ? null : key;
        this.showItemSelect();
      });

      this.buttons.push(bg, txt);
    });

    // Confirm with item
    const hasSelection = this.selectedItem !== null;
    const confirmLabel = hasSelection ? '✓ Pick Specialization →' : 'Skip (no item) →';
    const confirmBg = this.add.rectangle(W / 2, H - 60, 280, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
    const confirmTxt = this.add.text(W / 2, H - 60, confirmLabel, { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
    confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x22c55e));
    confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x166534));
    confirmBg.on('pointerdown', () => {
      this.selectedSpecialization = null;
      this.showSpecializationSelect();
    });
    this.buttons.push(confirmBg, confirmTxt);

    const backBg = this.add.rectangle(80, H - 60, 120, 36, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(80, H - 60, '← Back', { fontSize: '13px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showAbilitySelect());
    this.buttons.push(backBg, backTxt);

    this.infoText.setText('Multiple characters can hold the same item.');
  }

  // ── Specialization Select ───────────────────────────────────────
  showSpecializationSelect() {
    this.clearButtons();
    this.step = 'pickSpecialization';
    const W = this.scale.width;
    const H = this.scale.height;
    const char = ROSTER[this.currentCharKey];
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';
    const specKeys = Object.keys(SPECIALIZATIONS);

    this.titleText.setText(`Player ${this.currentPlayer} — ${char.name} Specialization`);
    this.subtitleText.setText('Pick a specialization (15% stat trade-off) or skip');

    const startY = 100;
    const rowH = 56;

    specKeys.forEach((key, i) => {
      const spec = SPECIALIZATIONS[key];
      const by = startY + i * rowH;
      const isSelected = this.selectedSpecialization === key;

      const bg = this.add.rectangle(W / 2, by, W * 0.8, 46, isSelected ? 0x166534 : 0x222244)
        .setStrokeStyle(2, isSelected ? 0x4ade80 : 0x444466)
        .setInteractive({ useHandCursor: true });

      const label = `${spec.emoji} ${spec.name}`;
      const txt = this.add.text(W * 0.18, by, label, {
        fontSize: '16px', fill: isSelected ? '#4ade80' : '#fff', fontFamily: 'monospace'
      }).setOrigin(0, 0.5);

      const desc = this.add.text(W * 0.55, by, spec.description, {
        fontSize: '12px', fill: '#aaa', fontFamily: 'monospace'
      }).setOrigin(0, 0.5);

      bg.on('pointerover', () => { if (!isSelected) bg.setFillStyle(0x333355); });
      bg.on('pointerout', () => { if (!isSelected) bg.setFillStyle(0x222244); });
      bg.on('pointerdown', () => {
        this.selectedSpecialization = (this.selectedSpecialization === key) ? null : key;
        this.showSpecializationSelect();
      });

      this.buttons.push(bg, txt, desc);
    });

    // Confirm button
    const hasSpec = this.selectedSpecialization !== null;
    const confirmLabel = hasSpec ? '✓ Pick Stats →' : 'Skip (no specialization) →';
    const confirmBg = this.add.rectangle(W / 2, H - 60, 300, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
    const confirmTxt = this.add.text(W / 2, H - 60, confirmLabel, { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
    confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x22c55e));
    confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x166534));
    confirmBg.on('pointerdown', () => {
      this.statAlloc = {};
      ALLOCATABLE_STATS.forEach(s => this.statAlloc[s] = 0);
      this.showStatAlloc();
    });
    this.buttons.push(confirmBg, confirmTxt);

    // Back button
    const backBg = this.add.rectangle(80, H - 60, 120, 36, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(80, H - 60, '← Back', { fontSize: '13px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showItemSelect());
    this.buttons.push(backBg, backTxt);

    this.infoText.setText('Specializations apply a 15% multiplier after skill investment.');
  }

  // ── Stat Allocation ────────────────────────────────────────────
  showStatAlloc() {
    this.clearButtons();
    this.step = 'allocStats';
    const W = this.scale.width;
    const H = this.scale.height;
    const char = ROSTER[this.currentCharKey];
    const accent = this.currentPlayer === 1 ? '#53a8b6' : '#e94560';

    this.titleText.setText(`Player ${this.currentPlayer} — ${char.name} Stat Points`);
    this.subtitleText.setText(`${this.pointsLeft} / ${STAT_POINTS} points remaining  (max ${STAT_MAX_PER} per stat)`);

    const startY = 110;
    const rowH = 60;

    ALLOCATABLE_STATS.forEach((stat, i) => {
      const by = startY + i * rowH;
      const base = char[stat];
      const bonus = this.statAlloc[stat];
      const total = base + bonus;

      const label = this.add.text(W * 0.15, by, `${STAT_LABELS[stat]}`, { fontSize: '16px', fill: accent, fontFamily: 'monospace' }).setOrigin(0, 0.5);
      const baseT = this.add.text(W * 0.3, by, `${base}`, { fontSize: '14px', fill: '#888', fontFamily: 'monospace' }).setOrigin(0.5);

      const minusBg = this.add.rectangle(W * 0.42, by, 36, 36, bonus > 0 ? 0x5c2a2a : 0x222222)
        .setStrokeStyle(1, bonus > 0 ? 0xe94560 : 0x333333);
      const minusT = this.add.text(W * 0.42, by, '−', { fontSize: '20px', fill: bonus > 0 ? '#e94560' : '#555', fontFamily: 'monospace' }).setOrigin(0.5);
      if (bonus > 0) {
        minusBg.setInteractive({ useHandCursor: true });
        minusBg.on('pointerdown', () => { this.statAlloc[stat]--; this.showStatAlloc(); });
      }

      const bonusColor = bonus > 0 ? '#4ade80' : '#666';
      const bonusT = this.add.text(W * 0.52, by, `+${bonus}`, { fontSize: '16px', fill: bonusColor, fontFamily: 'monospace' }).setOrigin(0.5);

      const canAdd = bonus < STAT_MAX_PER && this.pointsLeft > 0;
      const plusBg = this.add.rectangle(W * 0.62, by, 36, 36, canAdd ? 0x1a4a1a : 0x222222)
        .setStrokeStyle(1, canAdd ? 0x4ade80 : 0x333333);
      const plusT = this.add.text(W * 0.62, by, '+', { fontSize: '20px', fill: canAdd ? '#4ade80' : '#555', fontFamily: 'monospace' }).setOrigin(0.5);
      if (canAdd) {
        plusBg.setInteractive({ useHandCursor: true });
        plusBg.on('pointerdown', () => { this.statAlloc[stat]++; this.showStatAlloc(); });
      }

      const totalT = this.add.text(W * 0.75, by, `= ${total}`, { fontSize: '16px', fill: '#fff', fontFamily: 'monospace' }).setOrigin(0, 0.5);

      const barW = 100;
      const basePct = Math.min(base / 80, 1);
      const totalPct = Math.min(total / 80, 1);
      const barBg = this.add.rectangle(W * 0.88, by, barW, 12, 0x222222);
      const barBase = this.add.rectangle(W * 0.88 - barW / 2 + (barW * basePct) / 2, by, barW * basePct, 12, 0x333333);
      const barTotal = this.add.rectangle(W * 0.88 - barW / 2 + (barW * totalPct) / 2, by, barW * totalPct, 10, bonus > 0 ? 0x4ade80 : 0x53a8b6).setAlpha(0.7);

      this.buttons.push(label, baseT, minusBg, minusT, bonusT, plusBg, plusT, totalT, barBg, barBase, barTotal);
    });

    const confirmBg = this.add.rectangle(W / 2, H - 60, 200, 40, 0x166534).setStrokeStyle(2, 0x4ade80).setInteractive({ useHandCursor: true });
    const confirmTxt = this.add.text(W / 2, H - 60, '✓ Confirm', { fontSize: '16px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
    confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x22c55e));
    confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x166534));
    confirmBg.on('pointerdown', () => this.confirmCharacter());
    this.buttons.push(confirmBg, confirmTxt);

    const backBg = this.add.rectangle(80, H - 60, 120, 36, 0x333333).setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(80, H - 60, '← Back', { fontSize: '13px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.showSpecializationSelect());
    this.buttons.push(backBg, backTxt);

    this.infoText.setText('');
  }

  // ── Confirm & Advance ──────────────────────────────────────────
  confirmCharacter() {
    this.currentPicks.push({
      key: this.currentCharKey,
      attacks: [...this.selectedAttacks],
      ability: this.selectedAbility,
      item: this.selectedItem,
      specialization: this.selectedSpecialization,
      bonuses: { ...this.statAlloc },
    });

    if (this.currentPicks.length < TEAM_SIZE) {
      this.showCharacterSelect();
    } else {
      // Team complete — offer to save before advancing
      this.showSavePrompt();
    }
  }
}
