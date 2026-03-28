// ── Battle Prep Scene ───────────────────────────────────────────────
// Both players select a saved team + 3 player actions, then start battle.
// Layout: Player 1 (left) | Player 2 (right) | Start button (bottom center)

class BattlePrepScene extends Phaser.Scene {
  constructor() {
    super('BattlePrepScene');
  }

  init() {
    this.p1Team = null; // { name, characters }
    this.p2Team = null;
    this.p1PlayerActions = [];
    this.p2PlayerActions = [];
    this.selectingActionsFor = null; // 1 or 2
    this.overlayObjects = [];
    this.scrollOffset = 0;
    this.searchText = '';
  }

  get p1Ready() {
    return this.p1Team && this.p1Team.characters.length > 0 && this.p1PlayerActions.length === PLAYER_ACTION_SLOTS;
  }
  get p2Ready() {
    return this.p2Team && this.p2Team.characters.length > 0 && this.p2PlayerActions.length === PLAYER_ACTION_SLOTS;
  }

  create() {
    this.W = this.scale.width;
    this.H = this.scale.height;
    this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x1a1a2e);
    this.mainObjects = [];
    this.drawMain();
  }

  clearMain() {
    this.mainObjects.forEach(o => o.destroy());
    this.mainObjects = [];
  }

  drawMain() {
    this.clearMain();
    const W = this.W;
    const H = this.H;
    const halfW = W / 2;

    // Title
    const title = this.add.text(W / 2, 20, 'Battle Prep', { fontSize: '22px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);
    this.mainObjects.push(title);

    // Divider
    const divider = this.add.rectangle(W / 2, H / 2, 2, H - 80, 0x333355);
    this.mainObjects.push(divider);

    // Draw each player side
    this.drawPlayerSide(1, 20, halfW - 30);
    this.drawPlayerSide(2, halfW + 10, halfW - 30);

    // Edit Teams button (centered bottom)
    const editBg = this.add.rectangle(W / 2, H - 65, 180, 34, 0x0f3460)
      .setStrokeStyle(1, 0x53a8b6).setInteractive({ useHandCursor: true });
    const editTxt = this.add.text(W / 2, H - 65, '✏️ Edit Teams', { fontSize: '14px', fill: '#53a8b6', fontFamily: 'monospace' }).setOrigin(0.5);
    editBg.on('pointerover', () => editBg.setFillStyle(0x1a5a8e));
    editBg.on('pointerout', () => editBg.setFillStyle(0x0f3460));
    editBg.on('pointerdown', () => this.scene.start('TeamEditorScene', { returnTo: 'BattlePrepScene' }));
    this.mainObjects.push(editBg, editTxt);

    // Start Battle button
    const ready = this.p1Ready && this.p2Ready;
    const startBg = this.add.rectangle(W / 2, H - 25, 200, 38, ready ? 0x166534 : 0x222222)
      .setStrokeStyle(2, ready ? 0x4ade80 : 0x333333);
    const startTxt = this.add.text(W / 2, H - 25, '⚔️ Start Battle', {
      fontSize: '16px', fill: ready ? '#4ade80' : '#555', fontFamily: 'monospace'
    }).setOrigin(0.5);
    if (ready) {
      startBg.setInteractive({ useHandCursor: true });
      startBg.on('pointerover', () => startBg.setFillStyle(0x22c55e));
      startBg.on('pointerout', () => startBg.setFillStyle(0x166534));
      startBg.on('pointerdown', () => this.startBattle());
    }
    this.mainObjects.push(startBg, startTxt);
  }

  drawPlayerSide(player, ox, pw) {
    const accent = player === 1 ? '#53a8b6' : '#e94560';
    const accentHex = player === 1 ? 0x53a8b6 : 0xe94560;
    const team = player === 1 ? this.p1Team : this.p2Team;
    const actions = player === 1 ? this.p1PlayerActions : this.p2PlayerActions;

    // Player label
    const label = this.add.text(ox + pw / 2, 50, `Player ${player}`, {
      fontSize: '16px', fill: accent, fontFamily: 'monospace'
    }).setOrigin(0.5);
    this.mainObjects.push(label);

    // Team select button
    const teamLabel = team ? team.name : 'Select Team';
    const teamBg = this.add.rectangle(ox + pw / 2, 85, pw - 20, 34, 0x222244)
      .setStrokeStyle(1, team ? 0x4ade80 : accentHex).setInteractive({ useHandCursor: true });
    const teamTxt = this.add.text(ox + pw / 2, 85, teamLabel, {
      fontSize: '13px', fill: team ? '#4ade80' : accent, fontFamily: 'monospace'
    }).setOrigin(0.5);
    teamBg.on('pointerdown', () => this.showTeamOverlay(player));
    this.mainObjects.push(teamBg, teamTxt);

    // Show team characters if selected
    if (team && team.characters) {
      const startY = 115;
      team.characters.forEach((c, i) => {
        const char = ROSTER[c.key];
        if (!char) return;
        const types = (char.types || []).map(t => TYPE_CHART.types[t]?.emoji || '').join('');
        const by = startY + i * 22;
        const ct = this.add.text(ox + 15, by, `${types} ${char.name}`, {
          fontSize: '10px', fill: '#ccc', fontFamily: 'monospace'
        });
        this.mainObjects.push(ct);
      });
    }

    // Player actions section
    const actY = team ? 115 + Math.min((team?.characters?.length || 0), TEAM_SIZE) * 22 + 15 : 125;
    const actLabel = this.add.text(ox + pw / 2, actY, 'Player Actions', {
      fontSize: '12px', fill: '#888', fontFamily: 'monospace'
    }).setOrigin(0.5);
    this.mainObjects.push(actLabel);

    // Action slots
    for (let i = 0; i < PLAYER_ACTION_SLOTS; i++) {
      const by = actY + 25 + i * 32;
      const paKey = actions[i] || null;
      const pa = paKey ? PLAYER_ACTIONS[paKey] : null;

      const bg = this.add.rectangle(ox + pw / 2, by, pw - 30, 26, 0x222244)
        .setStrokeStyle(1, pa ? 0x4ade80 : 0x444466).setInteractive({ useHandCursor: true });
      const txt = this.add.text(ox + pw / 2, by, pa ? `${pa.emoji || ''} ${pa.name}` : `Action ${i + 1}`, {
        fontSize: '11px', fill: pa ? '#4ade80' : '#555', fontFamily: 'monospace'
      }).setOrigin(0.5);
      bg.on('pointerdown', () => this.showActionOverlay(player, i));
      this.mainObjects.push(bg, txt);
    }

    // Ready indicator
    const isReady = player === 1 ? this.p1Ready : this.p2Ready;
    if (isReady) {
      const readyT = this.add.text(ox + pw / 2, actY + 25 + PLAYER_ACTION_SLOTS * 32 + 10, '✓ Ready', {
        fontSize: '13px', fill: '#4ade80', fontFamily: 'monospace'
      }).setOrigin(0.5);
      this.mainObjects.push(readyT);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  OVERLAYS
  // ══════════════════════════════════════════════════════════════
  clearOverlay() {
    this.overlayObjects.forEach(o => o.destroy());
    this.overlayObjects = [];
    this.scrollOffset = 0;
    this.searchText = '';
  }

  showTeamOverlay(player) {
    this.clearOverlay();
    const W = this.W;
    const H = this.H;

    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x000000).setAlpha(0.6).setInteractive();
    backdrop.on('pointerdown', () => { this.clearOverlay(); });
    this.overlayObjects.push(backdrop);

    const OW = 400;
    const OH = H - 60;
    const OX = W / 2 - OW / 2;
    const OY = 30;

    const panel = this.add.rectangle(W / 2, OY + OH / 2, OW, OH, 0x1a1a2e).setStrokeStyle(2, 0x53a8b6);
    this.overlayObjects.push(panel);

    const titleT = this.add.text(W / 2, OY + 18, `Player ${player} — Select Team`, {
      fontSize: '14px', fill: '#53a8b6', fontFamily: 'monospace'
    }).setOrigin(0.5);
    this.overlayObjects.push(titleT);

    const closeBg = this.add.rectangle(OX + OW - 20, OY + 18, 28, 24, 0x5c2a2a)
      .setStrokeStyle(1, 0xe94560).setInteractive({ useHandCursor: true });
    const closeT = this.add.text(OX + OW - 20, OY + 18, '✕', { fontSize: '14px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);
    closeBg.on('pointerdown', () => this.clearOverlay());
    this.overlayObjects.push(closeBg, closeT);

    // Search bar
    const searchY = OY + 45;
    const searchBg = this.add.rectangle(W / 2, searchY, OW - 40, 24, 0x222244).setStrokeStyle(1, 0x444466);
    const searchTxt = this.add.text(OX + 30, searchY, '🔍 Type to search...', {
      fontSize: '11px', fill: '#555', fontFamily: 'monospace'
    }).setOrigin(0, 0.5);
    this.overlayObjects.push(searchBg, searchTxt);

    // Team list
    const saved = this.getSavedTeams();
    let teamEntries = Object.keys(saved).map(name => {
      const team = saved[name];
      const chars = (team.characters || []).map(c => ROSTER[c.key]?.name || '?').join(', ');
      return { name, description: chars, data: team };
    });

    const listY = OY + 65;
    const listH = OH - 75;
    const itemH = 48;
    const maxVisible = Math.floor(listH / itemH);

    const renderTeams = (offset, filter) => {
      this.overlayObjects = this.overlayObjects.filter(o => {
        if (o.getData && o.getData('listItem')) { o.destroy(); return false; }
        return true;
      });

      let filtered = filter
        ? teamEntries.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))
        : teamEntries;

      filtered.slice(offset, offset + maxVisible).forEach((entry, i) => {
        const iy = listY + 10 + i * itemH;
        const bg = this.add.rectangle(W / 2, iy, OW - 30, itemH - 4, 0x222244)
          .setStrokeStyle(1, 0x333355).setInteractive({ useHandCursor: true });
        bg.setData('listItem', true);
        const txt = this.add.text(OX + 30, iy - 8, entry.name, {
          fontSize: '13px', fill: '#fff', fontFamily: 'monospace'
        }).setOrigin(0, 0.5);
        txt.setData('listItem', true);
        const desc = this.add.text(OX + 30, iy + 10, entry.description, {
          fontSize: '9px', fill: '#888', fontFamily: 'monospace'
        }).setOrigin(0, 0.5);
        desc.setData('listItem', true);

        bg.on('pointerdown', () => {
          if (player === 1) {
            this.p1Team = { name: entry.name, characters: entry.data.characters };
          } else {
            this.p2Team = { name: entry.name, characters: entry.data.characters };
          }
          this.clearOverlay();
          this.drawMain();
        });

        this.overlayObjects.push(bg, txt, desc);
      });
    };

    renderTeams(0, '');

    this.input.off('wheel');
    this.input.on('wheel', (pointer, go, dx, dy) => {
      this.scrollOffset = Phaser.Math.Clamp(
        this.scrollOffset + (dy > 0 ? 1 : -1),
        0, Math.max(0, teamEntries.length - maxVisible)
      );
      renderTeams(this.scrollOffset, this.searchText);
    });

    if (this.searchHandler) this.input.keyboard.off('keydown', this.searchHandler);
    this.searchHandler = (event) => {
      if (event.key === 'Backspace') this.searchText = this.searchText.slice(0, -1);
      else if (event.key === 'Escape') { this.clearOverlay(); return; }
      else if (event.key.length === 1) this.searchText += event.key;
      else return;
      searchTxt.setText(this.searchText ? `🔍 ${this.searchText}` : '🔍 Type to search...');
      searchTxt.setFill(this.searchText ? '#fff' : '#555');
      this.scrollOffset = 0;
      renderTeams(0, this.searchText);
    };
    this.input.keyboard.on('keydown', this.searchHandler);

    if (teamEntries.length === 0) {
      const noT = this.add.text(W / 2, listY + 40, 'No saved teams.\nUse Edit Teams to create one.', {
        fontSize: '12px', fill: '#555', fontFamily: 'monospace', align: 'center'
      }).setOrigin(0.5);
      this.overlayObjects.push(noT);
    }
  }

  showActionOverlay(player, slotIndex) {
    this.clearOverlay();
    const W = this.W;
    const H = this.H;
    const actions = player === 1 ? this.p1PlayerActions : this.p2PlayerActions;

    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x000000).setAlpha(0.6).setInteractive();
    backdrop.on('pointerdown', () => this.clearOverlay());
    this.overlayObjects.push(backdrop);

    const OW = 380;
    const OH = H - 80;
    const OX = W / 2 - OW / 2;
    const OY = 40;

    const panel = this.add.rectangle(W / 2, OY + OH / 2, OW, OH, 0x1a1a2e).setStrokeStyle(2, 0x53a8b6);
    const titleT = this.add.text(W / 2, OY + 18, `Player ${player} — Action ${slotIndex + 1}`, {
      fontSize: '14px', fill: '#53a8b6', fontFamily: 'monospace'
    }).setOrigin(0.5);
    const closeBg = this.add.rectangle(OX + OW - 20, OY + 18, 28, 24, 0x5c2a2a)
      .setStrokeStyle(1, 0xe94560).setInteractive({ useHandCursor: true });
    const closeT = this.add.text(OX + OW - 20, OY + 18, '✕', { fontSize: '14px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);
    closeBg.on('pointerdown', () => this.clearOverlay());
    this.overlayObjects.push(panel, titleT, closeBg, closeT);

    // List all player actions
    const paKeys = Object.keys(PLAYER_ACTIONS);
    const otherSelected = actions.filter((a, i) => i !== slotIndex && a);
    const listY = OY + 45;
    const itemH = 40;

    paKeys.forEach((key, i) => {
      const pa = PLAYER_ACTIONS[key];
      const iy = listY + i * itemH;
      const taken = otherSelected.includes(key);
      const isSelected = actions[slotIndex] === key;

      const bg = this.add.rectangle(W / 2, iy, OW - 30, itemH - 4, isSelected ? 0x166534 : 0x222244)
        .setStrokeStyle(1, isSelected ? 0x4ade80 : 0x333355);
      if (!taken) bg.setInteractive({ useHandCursor: true });
      const txt = this.add.text(OX + 30, iy, `${pa.emoji || ''} ${pa.name}${taken ? ' (taken)' : ''}`, {
        fontSize: '12px', fill: taken ? '#555' : (isSelected ? '#4ade80' : '#fff'), fontFamily: 'monospace'
      }).setOrigin(0, 0.5);

      if (!taken) {
        bg.on('pointerdown', () => {
          if (player === 1) this.p1PlayerActions[slotIndex] = key;
          else this.p2PlayerActions[slotIndex] = key;
          this.clearOverlay();
          this.drawMain();
        });
      }

      this.overlayObjects.push(bg, txt);
    });
  }

  getSavedTeams() {
    try { return JSON.parse(localStorage.getItem('strategyGame_savedTeams')) || {}; }
    catch { return {}; }
  }

  startBattle() {
    const buildPicks = (team) => team.characters.map(c => ({
      key: c.key,
      attacks: [...c.attacks],
      ability: c.ability || null,
      item: c.item || null,
      specialization: c.specialization || null,
      bonuses: { ...c.bonuses },
    }));

    this.scene.start('BattleScene', {
      p1Picks: buildPicks(this.p1Team),
      p2Picks: buildPicks(this.p2Team),
      p1PlayerActions: [...this.p1PlayerActions],
      p2PlayerActions: [...this.p2PlayerActions],
    });
  }
}
