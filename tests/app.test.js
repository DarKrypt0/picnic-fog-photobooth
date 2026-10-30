import { evaluateMouthPose, evaluateHandPose, InteractionArbitrator } from '../js/input/classifiers.js';
import { mapNormalizedToStage } from '../js/tracking/coordinates.js';
import { FogEngine } from '../js/fog.js';
import { MarksLayer } from '../js/marks.js';
import { SceneManager } from '../js/scenes/scenes.js';
import { PhotoTrayManager } from '../js/capture.js';

const resultsList = document.getElementById('test-results');
const summaryEl = document.getElementById('summary');
let failures = 0;
let total = 0;

function assert(condition, message) {
  total++;
  const li = document.createElement('li');
  if (condition) {
    li.className = 'pass';
    li.textContent = `✓ PASS: ${message}`;
  } else {
    failures++;
    li.className = 'fail';
    li.textContent = `✗ FAIL: ${message}`;
  }
  resultsList.appendChild(li);
}

async function runTests() {
  // 1. Mouth dwell & max duration & rearming
  const arb = new InteractionArbitrator();
  let state = arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 0 });
  assert(!state.mouthActive, 'Mouth does not activate immediately at t=0ms');

  state = arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 250 });
  assert(!state.mouthActive && state.mouthProgress > 0.5, 'Mouth dwell ring fills at t=250ms');

  state = arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 410 });
  assert(state.mouthActive, 'Mouth activates after 400ms dwell');

  state = arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 3000 });
  assert(!state.mouthActive, 'Mouth stops automatically after 2.5s max active cap');

  // Must remain neutral for 300ms before rearming
  state = arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 3100 });
  assert(!state.mouthActive, 'Mouth cannot reactivate without neutral rearm period');

  arb.update({ mouthScore: 0.1, handPose: 'neutral', nowMs: 3200 });
  arb.update({ mouthScore: 0.1, handPose: 'neutral', nowMs: 3550 });
  arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 3600 });
  state = arb.update({ mouthScore: 0.75, handPose: 'neutral', nowMs: 4020 });
  assert(state.mouthActive, 'Mouth rearms and activates after 300ms neutral pose');

  // 2. Conflict prevention: Drawing pauses mouth fog + 300ms cooldown
  state = arb.update({ mouthScore: 0.8, handPose: 'point', nowMs: 4100 });
  state = arb.update({ mouthScore: 0.8, handPose: 'point', nowMs: 4200 });
  assert(state.handApplying && !state.mouthActive, 'Index pointing activates drawing and pauses mouth fogging');

  // Release hand at 4300ms; mouth should still be in cooldown at 4450ms
  arb.update({ mouthScore: 0.8, handPose: 'fist', nowMs: 4300 });
  state = arb.update({ mouthScore: 0.8, handPose: 'fist', nowMs: 4450 });
  assert(!state.mouthActive, '300ms post-drawing cooldown blocks immediate refogging');

  // 3. Hand classifier ignores open hand and detects index point
  const fakeHand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  fakeHand[0] = { x: 0.5, y: 0.8 }; // wrist
  fakeHand[6] = { x: 0.5, y: 0.6 };
  fakeHand[8] = { x: 0.5, y: 0.3 }; // index extended
  const handRes = evaluateHandPose(fakeHand);
  assert(handRes.pose === 'point', 'Single extended index finger classified as point');

  // 4. Mirrored coordinate transform
  const mapped = mapNormalizedToStage(0.25, 0.5, 1280, 720, 1280, 720, true);
  assert(Math.abs(mapped.x - 960) < 1 && Math.abs(mapped.y - 360) < 1, 'Mirrored stage coordinate maps x=0.25 to 960px');

  // 5. Fog floating-point evaporation & clearing
  const fog = new FogEngine(160, 90);
  fog.addBreath(0.5, 0.5, 0.5, 1.2);
  const centerIdx = 45 * 160 + 80;
  const beforeEvap = fog.density[centerIdx];
  fog.step(1.0);
  assert(fog.density[centerIdx] < beforeEvap && fog.density[centerIdx] > 0, 'Floating-point fog density preserves gradual 1s evaporation');

  fog.clearSegment(0.4, 0.5, 0.6, 0.5, 0.08);
  assert(fog.density[centerIdx] < 0.05, 'Continuous segment stamping clears fog across center');

  // 6. Undo restores marks and fog
  const marks = new MarksLayer(320, 180);
  fog.addBreath(0.5, 0.5, 0.5, 1.2);
  const snap = fog.cloneDensity();
  marks.pushUndo(snap);
  fog.clearAll();
  marks.popUndo(fog);
  assert(snap[centerIdx] > 0 && Math.abs(fog.density[centerIdx] - snap[centerIdx]) < 1e-5, 'Undo restores previous fog snapshot');

  // 7. Capture tray caps at 8 and revokes URLs
  const tray = new PhotoTrayManager(8);
  const dummyStage = document.createElement('canvas');
  dummyStage.width = 320;
  dummyStage.height = 180;
  for (let i = 0; i < 9; i++) {
    await tray.captureFramedBlob(dummyStage, true);
  }
  assert(tray.photos.length === 8, 'Photo tray enforces 8-photo cap and evicts oldest');

  for (const frame of ['classic', 'botanical', 'midnight', 'none']) {
    const { item } = await tray.captureFramedBlob(dummyStage, true, frame);
    const bitmap = await createImageBitmap(item.blob);
    assert(bitmap.width === (frame === 'none' ? 320 : 376) && bitmap.height === (frame === 'none' ? 180 : 286), frame + ' export has correct dimensions');
    assert(item.blob.type === 'image/png', frame + ' export is PNG');
    bitmap.close();
  }
  tray.clearAll();
  assert(tray.photos.length === 0, 'Clearing tray removes all photos');
  const scenes = new SceneManager(320, 180);
  const ctx = dummyStage.getContext('2d');
  for (const scene of ['meadow', 'aquarium', 'rain', 'fireflies']) {
    scenes.setScene(scene); scenes.renderDemoBackground(ctx); scenes.renderScene(ctx, .016);
    assert(ctx.getImageData(160, 90, 1, 1).data[3] === 255, scene + ' paints an opaque landscape');
  }
  scenes.paused = true;
  const position = scenes.fireflies[0].x;
  scenes.renderScene(ctx, 1);
  assert(scenes.fireflies[0].x === position, 'Pause freezes firefly motion');

  summaryEl.dataset.testComplete = 'true';
  summaryEl.dataset.failures = String(failures);
  summaryEl.textContent = `Completed ${total} tests with ${failures} failure(s).`;
}

runTests();
