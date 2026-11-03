const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the actual inline entry point, not the separate js/app.js implementation.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;$/gm, '');

function renderer(cameraActive) {
  const scheduled = [];
  const sandbox = {
    window: { addEventListener() {} },
    requestAnimationFrame(callback) { scheduled.push(callback); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`'use strict';\n${moduleSource}\nglobalThis.App = PicnicPhotoboothApp;`, sandbox);
  const cameraDraws = [];
  const transforms = [];
  const ctx = () => ({
    clearRect() {}, save() {}, restore() {}, fillRect() {},
    drawImage(...args) { cameraDraws.push(args); },
    translate(...args) { transforms.push(['translate', ...args]); },
    scale(...args) { transforms.push(['scale', ...args]); }
  });
  const app = Object.create(sandbox.App.prototype);
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  Object.assign(app, {
    cameraActive, videoEl: video, countdownActive: false,
    lastFrameTime: 0, stageCanvas: { width: 640, height: 480 },
    sharpBuffer: {}, fogBuffer: {}, sharpCtx: ctx(), stageCtx: ctx(), fogCtx: ctx(),
    activeTool: 'write', sceneManager: { renderDemoBackground() {}, renderScene() {} },
    fogEngine: { step() {}, renderMaskCanvas() { return {}; } },
    processTracking() {}
  });
  return { app, scheduled, cameraDraws, transforms, video, sandbox };
}

for (const cameraActive of [false, true]) {
  test(`${cameraActive ? 'Camera' : 'Demo'} renderer completes and schedules subsequent frames`, () => {
    const { app, scheduled, cameraDraws, transforms, video, sandbox } = renderer(cameraActive);
    assert.doesNotThrow(() => app.loop(16));
    assert.equal(scheduled.length, 1, 'The next animation frame must be scheduled');
    scheduled.shift()(32);
    assert.equal(scheduled.length, 1, 'Animation must continue beyond the first frame');
    assert.equal(Object.hasOwn(sandbox, 'f_restore'), false, 'Rendering must not leak a global');
    assert.equal(cameraDraws.filter(args => args[0] === video).length, cameraActive ? 2 : 0);
    if (cameraActive) assert.ok(transforms.some(args => args[0] === 'scale' && args[1] === -1), 'Camera remains mirrored');
  });
}
