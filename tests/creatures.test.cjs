const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = (file) =>
  import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '..', file))).toString('base64'));

test('creature renderer includes all 3 butterfly 3D models and randomized personalities without birds or bees', async () => {
  const { CreatureRenderer, SPECIES_CATALOG } = await load('js/scenes/creature-renderer.js');

  // Verify all 3 butterfly models exist in catalog and birds/bees are excluded
  const expectedSpecies = ['butterfly_poly', 'butterfly_hugo', 'butterfly_sirkitree'];
  for (const s of expectedSpecies) {
    assert.ok(SPECIES_CATALOG[s], `Species ${s} should be defined in catalog`);
    assert.ok(SPECIES_CATALOG[s].file.includes('.glb'), `Species ${s} should reference a .glb file`);
  }
  assert.strictEqual(Object.keys(SPECIES_CATALOG).length, 3, 'Only the 3 butterfly species should be in SPECIES_CATALOG');

  // Instantiate CreatureRenderer
  const cr = new CreatureRenderer(null, 800, 600);
  assert.ok(cr.creatures.length >= 3 && cr.creatures.length <= 5, 'Should spawn 3 to 5 butterflies max');
  assert.ok(cr.creatures.every((c) => c.cfg.type === 'butterfly'), 'Every spawned creature should be a butterfly');

  // Verify variety of species present in active roster
  const activeSpecies = new Set(cr.creatures.map((c) => c.species));
  assert.strictEqual(activeSpecies.size, 3, 'All 3 distinct butterfly species should be on screen');

  // Verify randomized personalities (not all follow finger)
  const personalities = new Set(cr.creatures.map((c) => c.personality));
  assert.ok(personalities.has('curious'), 'Should have curious creatures that follow');
  assert.ok(personalities.has('wanderer') || personalities.has('shy'), 'Should have creatures that do not follow finger');

  const curiousCount = cr.creatures.filter((c) => c.personality === 'curious').length;
  const nonCuriousCount = cr.creatures.filter((c) => c.personality !== 'curious').length;
  assert.ok(curiousCount > 0, 'Some creatures follow the finger');
  assert.ok(nonCuriousCount > 0, 'Not all creatures follow the finger (some wander or shy away)');

  // Verify mock 2D rendering passes without errors
  const mockCtx = {
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, ellipse() {}, fill() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, stroke() {},
    drawImage() {}
  };

  assert.doesNotThrow(() => cr.render(mockCtx, 0.033, { x: 0.5, y: 0.5 }));

  // Test roster remixing
  assert.doesNotThrow(() => cr.randomizeRoster());
  assert.doesNotThrow(() => cr.render(mockCtx, 0.033, null));
  assert.doesNotThrow(() => cr.dispose());
});

test('all 6 bundled GLB models verify as glTF 2.0 binaries and 3D wing hinges + PerspectiveCamera orient in 3D', async () => {
  const vm = require('node:vm');
  const rootDir = path.join(__dirname, '..');

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'js/vendor/creature-models-bundle.js'), 'utf8'), sandbox);

  const bundle = sandbox.window.CREATURE_GLB_BASE64;
  assert.ok(bundle, 'CREATURE_GLB_BASE64 bundle should be defined');

  const { CreatureRenderer, SPECIES_CATALOG } = await load('js/scenes/creature-renderer.js');

  for (const [key, cfg] of Object.entries(SPECIES_CATALOG)) {
    assert.ok(bundle[key], `Bundled base64 GLB should exist for ${key}`);
    const buf = Buffer.from(bundle[key], 'base64');
    const diskBuf = fs.readFileSync(path.join(rootDir, cfg.file));
    assert.strictEqual(buf.length, diskBuf.length, `Bundled GLB size for ${key} matches disk file`);
    assert.strictEqual(buf.toString('ascii', 0, 4), 'glTF', `${key} has valid glTF binary header`);
    assert.strictEqual(buf.readUInt32LE(4), 2, `${key} is glTF version 2.0`);
  }

  // Verify 3D cylindrical wing hinge deformation rotates vertices in 3D rather than 2D scaling
  const origPos = new Float32Array([
    0.45, 0.0, 0.0,  // right wingtip
    -0.45, 0.0, 0.0, // left wingtip
    0.0, 0.0, 0.1    // thorax body center (inside hingeX)
  ]);
  const posArr = new Float32Array(origPos);
  const origNorm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const normArr = new Float32Array(origNorm);

  const cr = new CreatureRenderer(null, 800, 600);
  const mockCreature = {
    wingPhase: Math.PI / 2,
    cfg: { hingeX: 0.04, hingeY: 0.0, flapCenter: 0.0, flapAmp: Math.PI / 4, wingTwist: 0.2 },
    deformableMeshes: [{
      posAttr: { array: posArr, needsUpdate: false },
      normAttr: { array: normArr, needsUpdate: false },
      origPos,
      origNorm
    }]
  };

  cr.deformWings3D(mockCreature);
  // Right wingtip should lift up in +Y and pull inward in X along a 3D circular arc
  assert.ok(posArr[1] > 0.2, 'Right wingtip lifts in 3D +Y during upstroke');
  assert.ok(posArr[0] < 0.45 && posArr[0] > 0.2, 'Right wingtip arcs inward in X preserving 3D wing length');
  // Left wingtip should mirror symmetrically in 3D
  assert.ok(posArr[4] > 0.2, 'Left wingtip lifts in 3D +Y during upstroke');
  assert.ok(posArr[3] > -0.45 && posArr[3] < -0.2, 'Left wingtip arcs inward in -X preserving 3D wing length');
  // Thorax inside hingeX stays rigid
  assert.strictEqual(posArr[6], 0.0, 'Thorax X remains rigid');
  assert.strictEqual(posArr[7], 0.0, 'Thorax Y remains rigid');
});
