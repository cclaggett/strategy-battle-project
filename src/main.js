// ── Phaser Config ───────────────────────────────────────────────────
(async function () {
  await loadGameData();

  const config = {
    type: Phaser.AUTO,
    width: 1050,
    height: 500,
    backgroundColor: '#1a1a2e',
    scene: [BattlePrepScene, TeamEditorScene, BattleScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  const game = new Phaser.Game(config);
})();
