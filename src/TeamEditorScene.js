// ── Team Editor Scene ───────────────────────────────────────────────
// Single-page character editor for building and saving teams.
// Layout from mockup:
//   Left sidebar: saved teams button + 6 character slots
//   Main panel: character name/types, ability/item/specialization buttons,
//               stat sliders, move buttons, remaining skill points
//   Overlays for selection lists with search

class TeamEditorScene extends Phaser.Scene {
  constructor() {
    super('TeamEditorScene');
  }

  init(data) {
    // If editing an existing team, load it; otherwise start blank
    this.teamName = data.teamName || '';
    this.editingTeam = data.team || null;
    this.returnTo = data.returnTo || 'BattlePrepScene';

    // 6 character slots
    this.slots = [];
    for (let i = 0; i < TEAM_SIZE; i++) {
      this.slots.push({
        characterKey: null,
        attacks: [],
        ability: null,
        item: null,
        specialization: null,
        bonuses: {},
      });
    }
    ALLOCATABLE_STATS.forEach(s => {
      this.slots.forEach(slot => { slot.bonuses[s] = 0; });
    });

    // Load existing team data if editing
    if (this.editingTeam) {
      this.editingTeam.characters.forEach((c, i) => {
        if (i < TEAM_SIZE) {
          this.slots[i] = {
            characterKey: c.key,
            attacks: [...c.attacks],
            ability: c.ability || null,
            item: c.item || null,
            specialization: c.specialization || null,
            bonuses: { ...c.bonuses },
          };
        }
      });
    }

    this.activeSlot = 0;
    this.overlay = null; // current overlay type
    this.overlayObjects = [];
    this.scrollOffset = 0;
    this.searchText = '';
  }

  get currentSlot() { return this.slots[this.activeSlot]; }

  create() {
    this.W = this.scale.width;
    this.H = this.scale.height;

    // Background
    this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x1a1a2e);

    this.mainObjects = [];
    this.sidebarObjects = [];

    // Slider drag state
    this._draggingStat = null;
    this._sliderMeta = {}; // stat -> { sliderX, sliderW, maxAlloc, slot }

    // Scene-level pointer tracking for slider dragging
    this.input.on('pointermove', (pointer) => {
      if (!this._draggingStat || !pointer.isDown) return;
      const meta = this._sliderMeta[this._draggingStat];
      if (!meta) return;
      const clamped = Phaser.Math.Clamp(pointer.x, meta.sliderX, meta.sliderX + meta.sliderW);
      const rawVal = Math.round(((clamped - meta.sliderX) / meta.sliderW) * STAT_MAX_PER);
      const newBonus = Phaser.Math.Clamp(rawVal, 0, meta.maxAlloc);
      if (newBonus !== meta.slot.bonuses[this._draggingStat]) {
        meta.slot.bonuses[this._draggingStat] = newBonus;
        this.redraw();
      }
    });
    this.input.on('pointerup', () => {
      this._draggingStat = null;
    });

    this.drawSidebar();
    this.drawMain();
  }

  // ══════════════════════════════════════════════════════════════
  //  SIDEBAR (left strip)
  // ══════════════════════════════════════════════════════════════
  drawSidebar() {
    this.sidebarObjects.forEach(o => o.destroy());
    this.sidebarObjects = [];

    const SB_W = 120;
    const bg = this.add.rectangle(SB_W / 2, this.H / 2, SB_W, this.H, 0x16213e);
    this.sidebarObjects.push(bg);

    // Saved Teams button (opens overlay)
    const stBg = this.add.rectangle(SB_W / 2, 30, 100, 32, 0x0f3460)
      .setStrokeStyle(1, 0x53a8b6).setInteractive({ useHandCursor: true });
    const stTxt = this.add.text(SB_W / 2, 30, '💾 Teams', { fontSize: '12px', fill: '#53a8b6', fontFamily: 'monospace' }).setOrigin(0.5);
    stBg.on('pointerdown', () => this.showOverlay('savedTeams'));
    this.sidebarObjects.push(stBg, stTxt);

    // Character slots
    for (let i = 0; i < TEAM_SIZE; i++) {
      const slot = this.slots[i];
      const by = 80 + i * 62;
      const isActive = i === this.activeSlot;
      const hasCh = !!slot.characterKey;

      const slotBg = this.add.rectangle(SB_W / 2, by, 100, 52, isActive ? 0x2a4a6e : 0x222244)
        .setStrokeStyle(2, isActive ? 0x53a8b6 : (hasCh ? 0x444466 : 0x333344))
        .setInteractive({ useHandCursor: true });

      const label = hasCh ? ROSTER[slot.characterKey].name : `Slot ${i + 1}`;
      const color = hasCh ? '#fff' : '#555';
      const slotTxt = this.add.text(SB_W / 2, by - 8, label, { fontSize: '11px', fill: color, fontFamily: 'monospace' }).setOrigin(0.5);

      let subTxt;
      if (hasCh) {
        const types = (ROSTER[slot.characterKey].types || []).map(t => TYPE_CHART.types[t] ? TYPE_CHART.types[t].emoji : '').join('');
        subTxt = this.add.text(SB_W / 2, by + 10, types, { fontSize: '10px', fill: '#888', fontFamily: 'monospace' }).setOrigin(0.5);
      } else {
        subTxt = this.add.text(SB_W / 2, by + 10, 'empty', { fontSize: '9px', fill: '#444', fontFamily: 'monospace' }).setOrigin(0.5);
      }

      slotBg.on('pointerdown', () => {
        this.activeSlot = i;
        this.redraw();
      });

      this.sidebarObjects.push(slotBg, slotTxt, subTxt);
    }

    // Back button
    const backBg = this.add.rectangle(SB_W / 2, this.H - 60, 100, 32, 0x333333)
      .setStrokeStyle(1, 0x555555).setInteractive({ useHandCursor: true });
    const backTxt = this.add.text(SB_W / 2, this.H - 60, '← Back', { fontSize: '12px', fill: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
    backBg.on('pointerdown', () => this.scene.start(this.returnTo));
    this.sidebarObjects.push(backBg, backTxt);

    // Save Team button
    const saveBg = this.add.rectangle(SB_W / 2, this.H - 25, 100, 32, 0x166534)
      .setStrokeStyle(1, 0x4ade80).setInteractive({ useHandCursor: true });
    const saveTxt = this.add.text(SB_W / 2, this.H - 25, '💾 Save', { fontSize: '12px', fill: '#4ade80', fontFamily: 'monospace' }).setOrigin(0.5);
    saveBg.on('pointerdown', () => this.saveCurrentTeam());
    this.sidebarObjects.push(saveBg, saveTxt);
  }

  // ══════════════════════════════════════════════════════════════
  //  MAIN PANEL
  // ══════════════════════════════════════════════════════════════
  drawMain() {
    this.mainObjects.forEach(o => o.destroy());
    this.mainObjects = [];
    this._sliderMeta = {};

    const OX = 140; // offset past sidebar
    const PW = this.W - OX - 20; // panel width
    const slot = this.currentSlot;

    // ── Team Name ──
    const nameBg = this.add.rectangle(OX + PW / 2, 22, PW, 30, 0x222244).setStrokeStyle(1, 0x444466)
      .setInteractive({ useHandCursor: true });
    const nameLabel = this.add.text(OX + PW / 2, 22, this.teamName || 'Click to name team...', {
      fontSize: '14px', fill: this.teamName ? '#fff' : '#555', fontFamily: 'monospace'
    }).setOrigin(0.5);
    nameBg.on('pointerdown', () => {
      const name = prompt('Team name:', this.teamName);
      if (name !== null) { this.teamName = name.trim(); this.redraw(); }
    });
    this.mainObjects.push(nameBg, nameLabel);

    // ── Character Name + Types ──
    if (slot.characterKey) {
      const char = ROSTER[slot.characterKey];
      const types = (char.types || []).map(t => TYPE_CHART.types[t] ? TYPE_CHART.types[t].emoji : '').join(' ');

      const charNameBg = this.add.rectangle(OX + PW * 0.35, 55, PW * 0.5, 28, 0x0f3460)
        .setStrokeStyle(1, 0x53a8b6).setInteractive({ useHandCursor: true });
      const charNameTxt = this.add.text(OX + PW * 0.35, 55, `${types} ${char.name}`, {
        fontSize: '16px', fill: '#53a8b6', fontFamily: 'monospace'
      }).setOrigin(0.5);
      charNameBg.on('pointerdown', () => this.showOverlay('character'));
      this.mainObjects.push(charNameBg, charNameTxt);
    } else {
      const pickBg = this.add.rectangle(OX + PW * 0.35, 55, PW * 0.5, 28, 0x0f3460)
        .setStrokeStyle(1, 0x53a8b6).setInteractive({ useHandCursor: true });
      const pickTxt = this.add.text(OX + PW * 0.35, 55, '+ Pick Character', {
        fontSize: '14px', fill: '#53a8b6', fontFamily: 'monospace'
      }).setOrigin(0.5);
      pickBg.on('pointerdown', () => this.showOverlay('character'));
      this.mainObjects.push(pickBg, pickTxt);
    }

    if (!slot.characterKey) {
      const hint = this.add.text(OX + PW / 2, this.H / 2, 'Select a character to begin', {
        fontSize: '14px', fill: '#555', fontFamily: 'monospace'
      }).setOrigin(0.5);
      this.mainObjects.push(hint);
      return;
    }

    const char = ROSTER[slot.characterKey];

    // ── Ability / Item / Specialization row ──
    const rowY = 90;
    const btnW = (PW - 30) / 3;
    const sections = [
      { label: 'Ability', key: 'ability', getData: () => slot.ability ? ABILITIES[slot.ability]?.name : null, overlay: 'ability' },
      { label: 'Item', key: 'item', getData: () => slot.item ? (ITEMS[slot.item]?.emoji + ' ' + ITEMS[slot.item]?.name) : null, overlay: 'item' },
      { label: 'Spec', key: 'specialization', getData: () => slot.specialization ? (SPECIALIZATIONS[slot.specialization]?.emoji + ' ' + SPECIALIZATIONS[slot.specialization]?.name) : null, overlay: 'specialization' },
    ];
    sections.forEach((sec, i) => {
      const bx = OX + 10 + btnW * i + btnW / 2;
      const val = sec.getData();
      const bg = this.add.rectangle(bx, rowY, btnW - 6, 28, 0x222244)
        .setStrokeStyle(1, val ? 0x4ade80 : 0x444466).setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, rowY, val || sec.label, {
        fontSize: '11px', fill: val ? '#4ade80' : '#888', fontFamily: 'monospace'
      }).setOrigin(0.5);
      bg.on('pointerdown', () => this.showOverlay(sec.overlay));
      this.mainObjects.push(bg, txt);
    });

    // ── Stats section ──
    const statsY = 125;
    const rowH = 38;
    const allStats = ALLOCATABLE_STATS;
    const statNames = { ...STAT_LABELS };

    const pointsUsed = Object.values(slot.bonuses).reduce((a, b) => a + b, 0);
    const pointsLeft = STAT_POINTS - pointsUsed;

    allStats.forEach((stat, i) => {
      const by = statsY + i * rowH;
      const baseStat = char[stat];
      const bonus = slot.bonuses[stat] || 0;
      const afterInvest = baseStat + bonus;

      // Specialization modifier
      let specMult = 1;
      if (slot.specialization && SPECIALIZATIONS[slot.specialization]) {
        const spec = SPECIALIZATIONS[slot.specialization];
        if (spec.boost.stat === stat) specMult = spec.boost.multiplier;
        if (spec.penalty.stat === stat) specMult = spec.penalty.multiplier;
      }
      const finalVal = Math.floor(afterInvest * specMult);
      const specDiff = finalVal - afterInvest;

      // Label
      const label = this.add.text(OX + 15, by, statNames[stat] || stat, {
        fontSize: '12px', fill: '#53a8b6', fontFamily: 'monospace'
      }).setOrigin(0, 0.5);
      this.mainObjects.push(label);

      // Base value
      const baseT = this.add.text(OX + 55, by, `${baseStat}`, {
        fontSize: '11px', fill: '#666', fontFamily: 'monospace'
      }).setOrigin(0, 0.5);
      this.mainObjects.push(baseT);

      // Slider for bonus allocation
      const sliderX = OX + 85;
      const sliderW = 160;
      const maxAlloc = Math.min(STAT_MAX_PER, bonus + pointsLeft);
      const statRef = stat;

      // Register slider metadata for scene-level drag tracking
      this._sliderMeta[statRef] = { sliderX, sliderW, maxAlloc, slot };

      // Track
      const trackBg = this.add.rectangle(sliderX + sliderW / 2, by, sliderW, 6, 0x222222).setStrokeStyle(1, 0x333333);
      this.mainObjects.push(trackBg);

      // Filled portion
      const fillPct = STAT_MAX_PER > 0 ? bonus / STAT_MAX_PER : 0;
      const fillW = Math.max(sliderW * fillPct, 0);
      const trackFill = this.add.rectangle(sliderX + fillW / 2, by, fillW, 6, 0x4ade80).setAlpha(0.7);
      this.mainObjects.push(trackFill);

      // Thumb
      const thumbX = sliderX + fillW;
      const thumb = this.add.circle(thumbX, by, 8, 0x4ade80).setStrokeStyle(2, 0xffffff);
      this.mainObjects.push(thumb);

      // Bonus text
      const bonusT = this.add.text(sliderX + sliderW + 10, by, `+${bonus}`, {
        fontSize: '11px', fill: bonus > 0 ? '#4ade80' : '#555', fontFamily: 'monospace'
      }).setOrigin(0, 0.5);
      this.mainObjects.push(bonusT);

      // Hit zone — pointerdown starts drag, scene pointermove handles the rest
      const hitZone = this.add.rectangle(sliderX + sliderW / 2, by, sliderW + 20, 24, 0x000000).setAlpha(0.001)
        .setInteractive({ useHandCursor: true });
      this.mainObjects.push(hitZone);

      hitZone.on('pointerdown', (pointer) => {
        this._draggingStat = statRef;
        // Immediately apply click position
        const clamped = Phaser.Math.Clamp(pointer.x, sliderX, sliderX + sliderW);
        const rawVal = Math.round(((clamped - sliderX) / sliderW) * STAT_MAX_PER);
        const newBonus = Phaser.Math.Clamp(rawVal, 0, maxAlloc);
        slot.bonuses[statRef] = newBonus;
        this.redraw();
      });

      // Spec modifier
      const specX = sliderX + sliderW + 40;
      if (specDiff !== 0) {
        const specColor = specDiff > 0 ? '#4ade80' : '#e94560';
        const specT = this.add.text(specX, by, `${specDiff > 0 ? '+' : ''}${specDiff}`, {
          fontSize: '10px', fill: specColor, fontFamily: 'monospace'
        }).setOrigin(0, 0.5);
        this.mainObjects.push(specT);
      }

      // Stat bar (visual)
      const barX = specX + 35;
      const barW = 100;
      const maxStatVal = stat === 'hp' ? 200 : 80;
      const basePct = Math.min(baseStat / maxStatVal, 1);
      const finalPct = Math.min(finalVal / maxStatVal, 1);
      const barBg2 = this.add.rectangle(barX + barW / 2, by, barW, 10, 0x222222);
      const barBase = this.add.rectangle(barX + (barW * basePct) / 2, by, barW * basePct, 10, 0x333333);
      const barColor = specDiff >= 0 ? 0x4ade80 : 0xe94560;
      const barFinal = this.add.rectangle(barX + (barW * finalPct) / 2, by, Math.max(barW * finalPct, 1), 8, bonus > 0 || specDiff !== 0 ? barColor : 0x53a8b6).setAlpha(0.7);
      this.mainObjects.push(barBg2, barBase, barFinal);

      // Final value
      const finalT = this.add.text(barX + barW + 10, by, `${finalVal}`, {
        fontSize: '12px', fill: '#fff', fontFamily: 'monospace'
      }).setOrigin(0, 0.5);
      this.mainObjects.push(finalT);
    });

    // Remaining skill points
    const spY = statsY + allStats.length * rowH + 5;
    const spT = this.add.text(OX + 15, spY, `Remaining skill points: ${pointsLeft}`, {
      fontSize: '12px', fill: pointsLeft > 0 ? '#f0a500' : '#4ade80', fontFamily: 'monospace'
    });
    this.mainObjects.push(spT);

    // ── Move buttons (right side) ──
    const moveX = OX + PW - 130;
    for (let i = 0; i < ATTACK_SLOTS; i++) {
      const by = statsY + i * 52;
      const atkKey = slot.attacks[i] || null;
      const atk = atkKey ? ATTACKS[atkKey] : null;

      const bg = this.add.rectangle(moveX, by, 240, 40, 0x222244)
        .setStrokeStyle(1, atk ? 0x4ade80 : 0x444466).setInteractive({ useHandCursor: true });
      const label = atk ? atk.name : `Move ${i + 1}`;
      const txt = this.add.text(moveX, by - 6, label, {
        fontSize: '12px', fill: atk ? '#fff' : '#555', fontFamily: 'monospace'
      }).setOrigin(0.5);

      let subLabel = '';
      if (atk) {
        subLabel = atk.type;
        if (atk.damageType && TYPE_CHART.types[atk.damageType]) subLabel += ` ${TYPE_CHART.types[atk.damageType].emoji}`;
        if (atk.power > 0) subLabel += atk.type === 'heal' ? ` ${atk.power}%` : ` ${atk.power}`;
      }
      const sub = this.add.text(moveX, by + 10, subLabel, {
        fontSize: '9px', fill: '#888', fontFamily: 'monospace'
      }).setOrigin(0.5);

      bg.on('pointerdown', () => this.showOverlay('move', i));
      this.mainObjects.push(bg, txt, sub);
    }
  }

  redraw() {
    this.drawSidebar();
    this.drawMain();
  }

  // ══════════════════════════════════════════════════════════════
  //  OVERLAY SYSTEM
  // ══════════════════════════════════════════════════════════════
  clearOverlay() {
    this.overlayObjects.forEach(o => o.destroy());
    this.overlayObjects = [];
    this.overlay = null;
    this.searchText = '';
    this.scrollOffset = 0;
  }

  showOverlay(type, extra) {
    this.clearOverlay();
    this.overlay = type;
    this.overlayExtra = extra; // e.g. move index

    const OX = 160;
    const OY = 20;
    const OW = this.W - OX - 20;
    const OH = this.H - 40;

    // Backdrop
    const backdrop = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000).setAlpha(0.6).setInteractive();
    backdrop.on('pointerdown', () => this.clearOverlay());
    this.overlayObjects.push(backdrop);

    // Panel
    const panel = this.add.rectangle(OX + OW / 2, OY + OH / 2, OW, OH, 0x1a1a2e).setStrokeStyle(2, 0x53a8b6);
    this.overlayObjects.push(panel);

    // Title
    const titles = {
      character: 'Select Character',
      ability: 'Select Ability',
      item: 'Select Item',
      specialization: 'Select Specialization',
      move: `Select Move ${(extra ?? 0) + 1}`,
      savedTeams: 'Saved Teams',
    };
    const titleT = this.add.text(OX + OW / 2, OY + 18, titles[type] || type, {
      fontSize: '14px', fill: '#53a8b6', fontFamily: 'monospace'
    }).setOrigin(0.5);
    this.overlayObjects.push(titleT);

    // Close button
    const closeBg = this.add.rectangle(OX + OW - 20, OY + 18, 28, 24, 0x5c2a2a)
      .setStrokeStyle(1, 0xe94560).setInteractive({ useHandCursor: true });
    const closeT = this.add.text(OX + OW - 20, OY + 18, '✕', { fontSize: '14px', fill: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5);
    closeBg.on('pointerdown', () => this.clearOverlay());
    this.overlayObjects.push(closeBg, closeT);

    // Search bar area
    const searchY = OY + 45;
    const searchBg = this.add.rectangle(OX + OW / 2, searchY, OW - 40, 24, 0x222244).setStrokeStyle(1, 0x444466);
    const searchTxt = this.add.text(OX + 30, searchY, '🔍 Type to search...', {
      fontSize: '11px', fill: '#555', fontFamily: 'monospace'
    }).setOrigin(0, 0.5);
    this.overlayObjects.push(searchBg, searchTxt);

    // Build list items
    const listY = OY + 65;
    const listH = OH - 75;
    const itemH = 42;
    let items = this.getOverlayItems(type);

    // Create mask zone for scrolling
    const zone = this.add.zone(OX + OW / 2, listY + listH / 2, OW - 20, listH).setInteractive();
    this.overlayObjects.push(zone);

    // Render items
    const maxVisible = Math.floor(listH / itemH);
    const renderItems = (offset) => {
      // Remove old item renders
      this.overlayObjects = this.overlayObjects.filter(o => {
        if (o.getData && o.getData('listItem')) { o.destroy(); return false; }
        return true;
      });

      const visible = items.slice(offset, offset + maxVisible);
      visible.forEach((item, i) => {
        const iy = listY + 10 + i * itemH;
        const isSelected = this.isOverlayItemSelected(type, item, extra);

        const bg = this.add.rectangle(OX + OW / 2, iy, OW - 30, itemH - 4, isSelected ? 0x166534 : 0x222244)
          .setStrokeStyle(1, isSelected ? 0x4ade80 : 0x333355)
          .setInteractive({ useHandCursor: true });
        bg.setData('listItem', true);

        const txt = this.add.text(OX + 40, iy - 6, item.displayName, {
          fontSize: '12px', fill: isSelected ? '#4ade80' : '#fff', fontFamily: 'monospace'
        }).setOrigin(0, 0.5);
        txt.setData('listItem', true);

        const desc = this.add.text(OX + 40, iy + 10, item.description || '', {
          fontSize: '9px', fill: '#888', fontFamily: 'monospace'
        }).setOrigin(0, 0.5);
        desc.setData('listItem', true);

        bg.on('pointerdown', () => {
          this.selectOverlayItem(type, item, extra);
          this.clearOverlay();
          this.redraw();
        });

        this.overlayObjects.push(bg, txt, desc);
      });
    };

    renderItems(0);

    // Scroll via wheel
    this.input.off('wheel'); // clear old listener
    this.input.on('wheel', (pointer, gameObjects, dx, dy) => {
      if (!this.overlay) return;
      this.scrollOffset = Phaser.Math.Clamp(
        this.scrollOffset + (dy > 0 ? 1 : -1),
        0, Math.max(0, items.length - maxVisible)
      );
      renderItems(this.scrollOffset);
    });

    // Keyboard search
    if (this.searchHandler) this.input.keyboard.off('keydown', this.searchHandler);
    this.searchHandler = (event) => {
      if (!this.overlay) return;
      if (event.key === 'Backspace') {
        this.searchText = this.searchText.slice(0, -1);
      } else if (event.key === 'Escape') {
        this.clearOverlay();
        return;
      } else if (event.key.length === 1) {
        this.searchText += event.key;
      } else {
        return;
      }
      searchTxt.setText(this.searchText ? `🔍 ${this.searchText}` : '🔍 Type to search...');
      searchTxt.setFill(this.searchText ? '#fff' : '#555');
      items = this.getOverlayItems(type).filter(it =>
        it.displayName.toLowerCase().includes(this.searchText.toLowerCase())
      );
      this.scrollOffset = 0;
      renderItems(0);
    };
    this.input.keyboard.on('keydown', this.searchHandler);
  }

  getOverlayItems(type) {
    const slot = this.currentSlot;
    switch (type) {
      case 'character':
        return Object.values(ROSTER).map(c => {
          const types = (c.types || []).map(t => TYPE_CHART.types[t]?.emoji || '').join('');
          return {
            id: c.id,
            displayName: `${types} ${c.name}`,
            description: `HP ${c.hp}  ATK ${c.atk}  DEF ${c.def}  MAG ${c.mAtk}  RES ${c.mDef}  SPD ${c.spd}`,
          };
        });

      case 'ability':
        if (!slot.characterKey) return [];
        const char = ROSTER[slot.characterKey];
        return (char.abilityPool || []).map(id => {
          const ab = ABILITIES[id];
          return { id, displayName: `✦ ${ab.name}`, description: ab.description || ab.trigger };
        });

      case 'item':
        return Object.values(ITEMS).map(it => ({
          id: it.id,
          displayName: `${it.emoji} ${it.name}`,
          description: it.description || (it.consumable ? 'Consumable' : 'Passive'),
        }));

      case 'specialization':
        return [
          { id: null, displayName: 'None', description: 'No specialization' },
          ...Object.values(SPECIALIZATIONS).map(sp => ({
            id: sp.id,
            displayName: `${sp.emoji} ${sp.name}`,
            description: sp.description,
          })),
        ];

      case 'move': {
        if (!slot.characterKey) return [];
        const ch = ROSTER[slot.characterKey];
        const moveIdx = this.overlayExtra;
        // Show all moves in pool; grey out already selected (in other slots)
        const otherSelected = slot.attacks.filter((a, i) => i !== moveIdx && a);
        return ch.pool.map(atkId => {
          const atk = ATTACKS[atkId];
          let desc = atk.type;
          if (atk.damageType && TYPE_CHART.types[atk.damageType]) desc += ` ${TYPE_CHART.types[atk.damageType].emoji}`;
          if (atk.power > 0) desc += atk.type === 'heal' ? ` ${atk.power}%` : ` pwr:${atk.power}`;
          if (atk.spread) desc += ' 🌊';
          if (atk.range === 'long') desc += ' 🎯';
          const taken = otherSelected.includes(atkId);
          return { id: atkId, displayName: `${atk.name}${taken ? ' (taken)' : ''}`, description: desc, disabled: taken };
        });
      }

      case 'savedTeams':
        return this.getSavedTeamList();

      default: return [];
    }
  }

  isOverlayItemSelected(type, item, extra) {
    const slot = this.currentSlot;
    switch (type) {
      case 'character': return slot.characterKey === item.id;
      case 'ability': return slot.ability === item.id;
      case 'item': return slot.item === item.id;
      case 'specialization': return slot.specialization === item.id;
      case 'move': return slot.attacks[extra] === item.id;
      default: return false;
    }
  }

  selectOverlayItem(type, item, extra) {
    const slot = this.currentSlot;
    switch (type) {
      case 'character':
        if (slot.characterKey !== item.id) {
          // Reset slot when changing character
          slot.characterKey = item.id;
          slot.attacks = [];
          slot.ability = null;
          slot.item = null;
          ALLOCATABLE_STATS.forEach(s => { slot.bonuses[s] = 0; });
        }
        break;
      case 'ability': slot.ability = item.id; break;
      case 'item': slot.item = item.id; break;
      case 'specialization': slot.specialization = item.id; break;
      case 'move':
        if (!item.disabled) {
          slot.attacks[extra] = item.id;
        }
        break;
      case 'savedTeams':
        this.loadTeamFromSaved(item.id);
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SAVE / LOAD
  // ══════════════════════════════════════════════════════════════
  static STORAGE_KEY = 'strategyGame_savedTeams';

  getSavedTeams() {
    try { return JSON.parse(localStorage.getItem(TeamEditorScene.STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  getSavedTeamList() {
    const teams = this.getSavedTeams();
    return Object.keys(teams).map(name => {
      const team = teams[name];
      const chars = (team.characters || []).map(c => ROSTER[c.key]?.name || '?').join(', ');
      return { id: name, displayName: name, description: chars };
    });
  }

  saveCurrentTeam() {
    // Validate: at least one character
    const filledSlots = this.slots.filter(s => s.characterKey);
    if (filledSlots.length === 0) {
      alert('Add at least one character before saving.');
      return;
    }

    let name = this.teamName;
    if (!name) {
      name = prompt('Team name:');
      if (!name) return;
      this.teamName = name.trim();
    }

    const teams = this.getSavedTeams();
    teams[this.teamName] = {
      characters: this.slots.filter(s => s.characterKey).map(s => ({
        key: s.characterKey,
        attacks: [...s.attacks],
        ability: s.ability,
        item: s.item,
        specialization: s.specialization,
        bonuses: { ...s.bonuses },
      })),
    };
    localStorage.setItem(TeamEditorScene.STORAGE_KEY, JSON.stringify(teams));
    this.redraw();
  }

  loadTeamFromSaved(name) {
    const teams = this.getSavedTeams();
    const team = teams[name];
    if (!team) return;

    this.teamName = name;
    // Reset all slots
    for (let i = 0; i < TEAM_SIZE; i++) {
      this.slots[i] = { characterKey: null, attacks: [], ability: null, item: null, specialization: null, bonuses: {} };
      ALLOCATABLE_STATS.forEach(s => { this.slots[i].bonuses[s] = 0; });
    }
    // Fill from saved
    team.characters.forEach((c, i) => {
      if (i < TEAM_SIZE) {
        this.slots[i] = {
          characterKey: c.key,
          attacks: [...c.attacks],
          ability: c.ability || null,
          item: c.item || null,
          specialization: c.specialization || null,
          bonuses: { ...c.bonuses },
        };
      }
    });
    this.activeSlot = 0;
    this.redraw();
  }
}
