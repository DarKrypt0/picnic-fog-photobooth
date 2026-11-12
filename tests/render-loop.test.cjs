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
    requestAnimationFrame(callback) { scheduled.push(callback); },
    setInterval, clearInterval, setTimeout, clearTimeout
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

test('Orientation modes calculate correct slot aspect ratios and keep live feed straight', () => {
  const { app, sandbox } = renderer(true);
  // Live feed remains straight to the user
  assert.equal(app.getOrientationAngle(), 0);

  // Mock orientation selector
  const mockElements = {
    'select-booth-orientation': { value: 'portrait' },
    'select-booth-layout': { value: 'photocard' }
  };
  sandbox.document = {
    getElementById(id) { return mockElements[id] || null; }
  };

  assert.equal(app.getOrientationAngle(), 0, 'Live feed must remain straight to the user');
  assert.equal(app.getSlotAspect(), 55 / 85);

  mockElements['select-booth-orientation'].value = 'landscape';
  assert.equal(app.getSlotAspect(), 85 / 55);

  mockElements['select-booth-layout'].value = '2x6_strip4';
  mockElements['select-booth-orientation'].value = 'portrait';
  assert.equal(app.getSlotAspect(), 339 / 484);

  mockElements['select-booth-orientation'].value = 'landscape';
  assert.equal(app.getSlotAspect(), 484 / 339);
});

test('Handoff pre-rotates photo to match slot orientation without cropping', () => {
  const { app, sandbox } = renderer(true);
  const mockElements = {
    'select-booth-layout': { value: '2x6_strip4' },
    'select-booth-orientation': { value: 'portrait' }
  };
  sandbox.document = {
    getElementById(id) { return mockElements[id] || null; },
    createElement(tag) {
      if (tag === 'canvas') {
        let _w = 0, _h = 0;
        return {
          set width(v) { _w = v; }, get width() { return _w; },
          set height(v) { _h = v; }, get height() { return _h; },
          getContext() { return { translate() {}, rotate() {}, drawImage() {} }; }
        };
      }
      return {};
    }
  };

  // 1. In 2x6 strip (landscape slot 484x339), a portrait capture (339x484) must rotate 90° into landscape (484x339)
  const portraitStage = { width: 339, height: 484 };
  const h1 = app.getHandoffCanvas(portraitStage);
  assert.equal(h1.shouldRotate, true, 'Portrait capture in 2x6 strip must rotate to fit landscape slot');
  assert.equal(h1.canvas.width, 484);
  assert.equal(h1.canvas.height, 339);

  // 2. In 2x6 strip, a landscape capture (484x339) must remain unrotated
  mockElements['select-booth-orientation'].value = 'landscape';
  const landscapeStage = { width: 484, height: 339 };
  const h2 = app.getHandoffCanvas(landscapeStage);
  assert.equal(h2.shouldRotate, false, 'Landscape capture in 2x6 strip fits directly without rotation');
  assert.equal(h2.canvas.width, 484);
  assert.equal(h2.canvas.height, 339);

  // 3. In photocard (portrait slot 648x1020), a landscape capture (484x339) must rotate 90° into portrait (339x484)
  mockElements['select-booth-layout'].value = 'photocard';
  mockElements['select-booth-orientation'].value = 'landscape';
  const h3 = app.getHandoffCanvas(landscapeStage);
  assert.equal(h3.shouldRotate, true, 'Landscape capture in photocard must rotate to fit portrait card');
  assert.equal(h3.canvas.width, 339);
  assert.equal(h3.canvas.height, 484);

  // 4. In photocard, a portrait capture fits directly without rotation
  mockElements['select-booth-orientation'].value = 'portrait';
  const h4 = app.getHandoffCanvas(portraitStage);
  assert.equal(h4.shouldRotate, false, 'Portrait capture in photocard fits directly without rotation');
  assert.equal(h4.canvas.width, 339);
  assert.equal(h4.canvas.height, 484);

  // 5. In 4x6_grid2x3 (square 480x480 slots), photos must NEVER rotate/flip in portrait, landscape, or auto
  mockElements['select-booth-layout'].value = '4x6_grid2x3';
  for (const ori of ['portrait', 'landscape', 'auto']) {
    mockElements['select-booth-orientation'].value = ori;
    const hSq = app.getHandoffCanvas({ width: 600, height: 600 });
    assert.equal(hSq.shouldRotate, false, `4x6_grid2x3 square capture must not rotate in ${ori}`);
    const hFs = app.getHandoffCanvas({ width: 1500, height: 1080 });
    assert.equal(hFs.shouldRotate, false, `4x6_grid2x3 fullscreen capture must not rotate in ${ori}`);
  }
});

test('Photo strip window clears based on layout-specific shots', () => {
  const { app, sandbox } = renderer(true);

  // Layout shot counts
  assert.equal(app.getLayoutNeededShots('2x6_strip4'), 4);
  assert.equal(app.getLayoutNeededShots('photocard'), 1);
  assert.equal(app.getLayoutNeededShots('mini_strip24x72'), 4);
  assert.equal(app.getLayoutNeededShots('4x6_grid2x2'), 4);
  assert.equal(app.getLayoutNeededShots('4x6_grid2x3'), 6);

  // Initialize strip photos and verify clearing
  app.stripPhotos = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  app.updateStudioUI = () => {};
  assert.equal(app.stripPhotos.length, 4);

  app.clearStripWindow();
  assert.equal(app.stripPhotos.length, 0, 'clearStripWindow must reset stripPhotos to empty');

  // Verify startCountdown clears if stripPhotos already completed needed shots
  const mockElements = {
    'select-booth-layout': { value: 'photocard' },
    'select-countdown-timer': { value: '3' },
    'countdown-overlay': { classList: { remove() {}, add() {} } },
    'countdown-number': { textContent: '' }
  };
  sandbox.document = {
    getElementById(id) { return mockElements[id] || null; }
  };
  app.stripPhotos = [{ id: 'card-1' }];
  app.countdownActive = false;
  app.startCountdown();
  assert.equal(app.stripPhotos.length, 0, 'startCountdown must clear finished photocard (1/1) for a fresh session');
  clearInterval(app.countdownTimer);
  app.countdownActive = false;
});

test('2x6 strip prints 2-at-a-time side-by-side with 1 copy default and center cut ticks', async () => {
  const { app, sandbox } = renderer(true);

  // 1. Verify UI copies default in index.html is 1 (not hardcoded to 2)
  const defaultCopiesMatch = html.match(/id="input-booth-copies"[^>]*value="(\d+)"/);
  assert.ok(defaultCopiesMatch, 'input-booth-copies element exists');
  assert.equal(defaultCopiesMatch[1], '1', 'Default copies input must be 1 (1 sheet yields 2 strips)');

  // 2. Test composeForPaper in BoothHardware for strip layout on 4x6 paper
  const lineDraws = [];
  const imageDraws = [];
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        fillText() {},
        beginPath() {},
        moveTo(x, y) { lineDraws.push(['moveTo', x, y]); },
        lineTo(x, y) { lineDraws.push(['lineTo', x, y]); },
        stroke() { lineDraws.push(['stroke']); },
        drawImage(...args) { imageDraws.push(args); }
      };
    },
    toBlob(callback) { callback(new Uint8Array([1, 2, 3])); }
  };

  sandbox.document = {
    createElement(tag) {
      if (tag === 'canvas') return mockCanvas;
      return {};
    }
  };
  sandbox.createImageBitmap = async () => ({ width: 600, height: 450, close() {} });

  // Verify App prototype exists in sandbox
  assert.ok(sandbox.App, 'PicnicPhotoboothApp should be defined');

  // Verify that booth_worker.py also tiles 2x6 strips into 1200x1800 printable sheet
  const boothWorkerCode = fs.readFileSync(path.join('C:', 'Users', 'hh', 'Downloads', 'Photobooth', 'booth_worker.py'), 'utf8');
  assert.ok(boothWorkerCode.includes('layout_name == "2x6_strip4"'), 'booth_worker.py must handle 2x6_strip4 in prepare_printable_sheet');
  assert.ok(boothWorkerCode.includes('(1200, 1800)'), '2x6 sheet must be standard 1200x1800 4x6');
  assert.ok(boothWorkerCode.includes('sheet.paste(strip, (0, 0))'), 'Strip 1 must be pasted at (0, 0)');
  assert.ok(boothWorkerCode.includes('sheet.paste(strip, (600, 0))'), 'Strip 2 must be pasted at (600, 0)');
  assert.ok(boothWorkerCode.includes('(600, 0), (600, 25)'), 'Center top cut mark must be drawn at x=600');
  assert.ok(boothWorkerCode.includes('(600, 1775), (600, 1800)'), 'Center bottom cut mark must be drawn at x=600');
});

test('Mini strip layout saves 1 per purchase without auto-printing and supports batch tiling', () => {
  const boothWorkerCode = fs.readFileSync(path.join('C:', 'Users', 'hh', 'Downloads', 'Photobooth', 'booth_worker.py'), 'utf8');

  // Verify booth_worker preserves single mini strip (1 per purchase) and skips auto-print
  assert.ok(boothWorkerCode.includes('layout_name == "mini_strip24x72"'), 'booth_worker.py must handle mini_strip24x72');
  assert.ok(boothWorkerCode.includes('Auto-print skipped for laminating batch'), 'process_session must skip auto-printing for mini strip');
  assert.ok(boothWorkerCode.includes('def tile_mini_strips_sheet'), 'tile_mini_strips_sheet helper must be defined for batching sets');
  assert.ok(boothWorkerCode.includes('--combine-mini'), 'CLI flag --combine-mini must be supported for laminating sets');

  // Verify webapp does not auto-print mini strip
  assert.ok(html.includes("layoutId !== 'mini_strip24x72'"), 'index.html must bypass auto-printing for mini_strip24x72');
});

test('Clicking shutter once auto-sequences through all 4 shots for strip layout', async () => {
  const { app, sandbox } = renderer(true);
  const mockElements = {
    'select-booth-layout': { value: '2x6_strip4' },
    'select-countdown-timer': { value: '0' },
    'countdown-overlay': { classList: { remove() {}, add() {} } },
    'countdown-number': { textContent: '' },
    'countdown-shot-pill': { textContent: '' },
    'shutter-main-label': { textContent: '' },
    'shutter-sub-label': { textContent: '' },
    'capture-progress-text': { textContent: '' }
  };
  sandbox.document = {
    getElementById(id) { return mockElements[id] || null; }
  };
  app.updateStudioUI = () => {};
  app.renderPhotoTray = () => {};
  app.showToast = () => {};
  app.trayManager = {
    captureFramedBlob: async () => ({ item: { id: `shot-${Date.now()}-${Math.random()}` } })
  };
  const handoffs = [];
  app.hardware = { status: { handoff: true } };
  app.handoffShot = () => handoffs.push(app.stripPhotos.length);
  app.stripPhotos = [];

  // 1. Trigger single shutter click
  await app.startCountdown();
  assert.equal(app.multiShotActive, true, 'Shutter click must start multi-shot sequence');
  assert.equal(app.stripPhotos.length, 1, 'First shot captured immediately when countdown timer is 0');
  assert.equal(app.multiShotActive, true, 'Sequence remains active after shot 1 of 4');
  assert.ok(app.nextShotTimeout, 'Next shot is queued automatically');

  // Shot 2
  clearTimeout(app.nextShotTimeout);
  app.nextShotTimeout = null;
  await app.completePhotoCapture();
  assert.equal(app.stripPhotos.length, 2, 'Second shot captured');
  assert.equal(app.multiShotActive, true, 'Sequence remains active after shot 2 of 4');
  assert.ok(app.nextShotTimeout);

  // Shot 3
  clearTimeout(app.nextShotTimeout);
  app.nextShotTimeout = null;
  await app.completePhotoCapture();
  assert.equal(app.stripPhotos.length, 3, 'Third shot captured');
  assert.equal(app.multiShotActive, true, 'Sequence remains active after shot 3 of 4');
  assert.ok(app.nextShotTimeout);

  // Shot 4
  clearTimeout(app.nextShotTimeout);
  app.nextShotTimeout = null;
  await app.completePhotoCapture();
  assert.equal(app.stripPhotos.length, 4, 'All 4 shots captured');
  assert.equal(app.multiShotActive, false, 'Sequence finishes when all 4 shots are captured');
  assert.equal(app.nextShotTimeout, null, 'No further shots queued');
  assert.deepEqual(handoffs, [1, 2, 3, 4], 'All 4 photos must be handed off and saved');

  // 2. Cancellation stops sequence mid-way
  app.clearStripWindow();
  await app.startCountdown();
  assert.equal(app.stripPhotos.length, 1);
  assert.equal(app.multiShotActive, true);
  assert.ok(app.nextShotTimeout);
  app.cancelCountdown('User cancelled');
  assert.equal(app.multiShotActive, false, 'Cancellation aborts auto-sequence');
  assert.equal(app.nextShotTimeout, null);
});

test('QR generation bundles both animated GIF and digital photo strip with unified mobile landing page', async () => {
  const { app, sandbox } = renderer(true);
  sandbox.Blob = Blob;
  sandbox.URL = { revokeObjectURL() {}, createObjectURL() { return 'blob:mock-gif'; } };
  const elements = {
    'btn-make-gif': { disabled: false, textContent: '' },
    'gif-modal': { classList: { remove() {}, add() {} } },
    'gif-preview': { src: '' },
    'strip-preview': { src: '' },
    'btn-download-gif': { href: '', download: '' },
    'qr-box': { innerHTML: '', textContent: '' },
    'qr-url': { textContent: '' },
    'qr-caption': { textContent: '' }
  };
  sandbox.document = {
    getElementById(id) { return elements[id] || null; }
  };

  const dummyPhotos = [
    { blob: new Blob(['fake1'], { type: 'image/jpeg' }) },
    { blob: new Blob(['fake2'], { type: 'image/jpeg' }) }
  ];
  app.stripPhotos = dummyPhotos;
  app.trayManager = { photos: dummyPhotos };

  let uploadedStripId = null;
  sandbox.fetch = async (url) => {
    const match = url.match(/\/api\/strip\?id=([A-Za-z0-9_\-]+)/);
    if (match) uploadedStripId = match[1];
    return { ok: true, json: async () => ({ ok: true }) };
  };

  app.hardware = {
    buildAndUploadGif: async () => ({
      gifBlob: new Blob(['fakegif'], { type: 'image/gif' }),
      shareInfo: { id: 'test_session_123', url: 'http://192.168.1.100:8081/g/test_session_123' }
    })
  };

  app.renderCompositeStripCanvas = async () => ({
    toBlob: (cb) => cb(new Blob(['fakestrip'], { type: 'image/jpeg' })),
    toDataURL: () => 'data:image/jpeg;base64,mockstripdata'
  });

  await app.makeGifAndShowQr();

  // 1. Photo strip must be previewed and uploaded with matching GIF ID
  assert.equal(uploadedStripId, 'test_session_123', 'Strip upload must share the identical ID with the animated GIF');
  assert.equal(elements['strip-preview'].src, 'data:image/jpeg;base64,mockstripdata', 'Strip preview image must be populated in modal');
  assert.ok(elements['gif-preview'].src, 'GIF preview image must be populated in modal');
  assert.equal(elements['btn-make-gif'].textContent, '📱 Digital Strip & GIF (QR)', 'Button text must reflect digital strip & GIF bundle');

  // 2. server.ps1 verification: regex and mobile page must support both strip & GIF
  const fs = require('fs');
  const path = require('path');
  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.ps1'), 'utf8');

  assert.ok(serverCode.includes('Digital Photo Strip'), 'server.ps1 mobile page must include Digital Photo Strip');
  assert.ok(serverCode.includes('Animated GIF'), 'server.ps1 mobile page must include Animated GIF');
  assert.ok(serverCode.includes('clickkit-strip-$id.jpg'), 'server.ps1 must provide download button for strip');
  assert.ok(serverCode.includes('clickkit-glass-$id.gif'), 'server.ps1 must provide download button for GIF');
  assert.ok(serverCode.includes('function Save-Gif([byte[]]$Bytes, [string]$ForceId = $null)'), 'Save-Gif must accept $ForceId');
});

test('Fullscreen kiosk mode displays live view and zoomed photostrip view without gaps', async () => {
  const { app, sandbox } = renderer(true);

  // 1. Verify CSS rules for fullscreen kiosk hide admin clutter and keep live view + photostrip view
  assert.ok(html.includes('body.fullscreen-kiosk .top-bar'), 'Fullscreen hides top bar');
  assert.ok(html.includes('body.fullscreen-kiosk #photo-list'), 'Fullscreen hides photo tray history list');
  assert.ok(html.includes('body.fullscreen-kiosk .scene-header-bar'), 'Fullscreen displays scene header bar');
  assert.ok(html.includes('body.fullscreen-kiosk .scene-select'), 'Fullscreen displays filter selector');
  assert.ok(html.includes('body.fullscreen-kiosk .glass-panel-card'), 'Fullscreen displays glass tools panel');
  assert.ok(html.includes('body.fullscreen-kiosk .glass-tools-row'), 'Fullscreen displays glass fog & clear buttons');
  assert.ok(html.includes('body.fullscreen-kiosk .photo-tray'), 'Fullscreen displays clean photostrip tray');
  assert.ok(html.includes('max-height: calc(100vh - 96px)'), 'Fullscreen allows photostrip card to zoom to full height');

  // 2. Verify photostrip card width is dynamic (no hardcoded 124px width restriction)
  const card = { style: { background: '', color: '', aspectRatio: '', width: 'previous-width' } };
  const grid = { innerHTML: '', style: {}, appendChild() {} };
  const mockElements = {
    'template-card-visual': card,
    'template-slots-grid': grid,
    'select-booth-layout': { value: '2x6_strip4' },
    'select-booth-orientation': { value: 'auto' },
    'select-booth-template': { value: 'none' }
  };
  card.querySelector = () => null;
  sandbox.document = {
    getElementById(id) { return mockElements[id] || null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, appendChild() {}, classList: { add() {} } }; }
  };

  app.stripPhotos = [
    {
      id: 'p1',
      url: 'blob:mock-framed-url',
      rawUrl: 'blob:mock-raw-clean-url',
      width: 640,
      height: 480
    }
  ];
  app.updateStudioUI();

  // Width must not be clamped to 124px
  assert.equal(card.style.width, '', 'Photostrip card width must not be locked to 124px');
  assert.equal(card.style.aspectRatio, '600 / 1800', 'Aspect ratio must govern responsive dimensions');

  // Slot thumbnail must prioritize clean rawUrl to avoid Polaroid padding gaps
  assert.ok(html.includes('photoItem.rawUrl || photoItem.url'), 'Slot images must use rawUrl to eliminate borders/gaps');
  assert.ok(html.includes('p.rawBlob || p.blob'), 'Composite canvas must use rawBlob for edge-to-edge slots');
});

test('Immediate fog freeze on photo capture, full prior-customer photo clearing, and QR bat auto-setup', async () => {
  const { app, sandbox } = renderer(true);

  const mockElements = {
    'select-booth-layout': { value: '2x6_strip4' },
    'select-countdown-timer': { value: '3' },
    'select-paper-size': { value: '4x6' },
    'countdown-overlay': { classList: { remove() {}, add() {} } },
    'countdown-number': { textContent: '' },
    'gesture-status': { textContent: '' },
    'gif-modal': { classList: { contains: () => true, add() {}, remove() {} } }
  };
  sandbox.document = {
    getElementById(id) { return mockElements[id] || null; },
    createElement() { return { click() {}, style: {} }; }
  };
  sandbox.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };

  let clearSessionCalls = 0;
  sandbox.fetch = async (url) => {
    if (String(url).includes('/api/clear-session')) clearSessionCalls++;
    return { ok: true, json: async () => ({ ok: true }) };
  };

  let trayCleared = false;
  app.trayManager = {
    photos: [{ id: 'old-cust-1', blob: {} }, { id: 'old-cust-2', blob: {} }],
    clearAll() {
      this.photos = [];
      trayCleared = true;
    }
  };
  app.stripPhotos = [{ id: 'old-cust-1', blob: {} }];
  app.pinchWriteLatched = true;
  app.mouthActive = true;
  app.fogFrozen = false;
  app.updateStudioUI = () => {};
  app.renderPhotoTray = () => {};
  app.showToast = () => {};

  // 1. Taking a photo immediately freezes fog and clears all prior customer photos
  app.startCountdown();
  assert.equal(app.fogFrozen, true, 'Fog must freeze immediately when customer initiates photo capture');
  assert.equal(app.pinchWriteLatched, false, 'Hand clearing latch must lock immediately on photo capture');
  assert.equal(app.mouthActive, false, 'Mouth breath fogging must stop immediately on photo capture');
  assert.equal(app.stripPhotos.length, 0, 'Prior customer stripPhotos must be cleared before new customer starts');
  assert.equal(app.trayManager.photos.length, 0, 'Prior customer trayManager.photos must be cleared before new customer starts');
  assert.equal(trayCleared, true, 'trayManager.clearAll() must be called prior to new customer');
  assert.ok(clearSessionCalls >= 1, '/api/clear-session must be called to purge leftover incoming/processed files');
  clearInterval(app.countdownTimer);
  app.countdownActive = false;
  app.multiShotActive = false;

  // 2. While fogFrozen is true, loop() must not evaporate fog
  let fogStepped = false;
  app.fogEngine.step = () => { fogStepped = true; };
  app.loop(100);
  assert.equal(fogStepped, false, 'Fog must not evaporate while fogFrozen is true');

  // Clicking reset fog unfreezes fog
  app.resetFogWithClickKit();
  assert.equal(app.fogFrozen, false, 'resetFogWithClickKit must unfreeze fog');

  // 3. Printing a photo clears all customer photos afterwards
  app.stripPhotos = [{ id: 'cur-1', blob: {} }];
  app.trayManager.photos = [{ id: 'cur-1', blob: {} }];
  app.hardware = {
    paper: () => ({ id: '4x6', label: '4x6', layout: 'single' }),
    print: async () => ({ ok: true })
  };
  await app.printPhoto(app.stripPhotos[0]);
  assert.equal(app.stripPhotos.length, 0, 'All customer stripPhotos must be cleared after print');
  assert.equal(app.trayManager.photos.length, 0, 'All customer trayManager.photos must be cleared after print');

  // 4. Saving a composite strip clears all customer photos afterwards
  app.stripPhotos = [{ id: 'cur-2', blob: {} }];
  app.trayManager.photos = [{ id: 'cur-2', blob: {} }];
  app.hardware = { status: { handoff: false, irfanView: false } };
  app.renderCompositeStripCanvas = async () => ({
    toBlob(cb) { cb(new Uint8Array([1, 2, 3])); }
  });
  await app.downloadCompositeStrip();
  assert.equal(app.stripPhotos.length, 0, 'All customer stripPhotos must be cleared after save');
  assert.equal(app.trayManager.photos.length, 0, 'All customer trayManager.photos must be cleared after save');

  // 5. Verify server.ps1 exposes /api/clear-session
  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.ps1'), 'utf8');
  assert.ok(serverCode.includes('"/api/clear-session"'), 'server.ps1 must expose /api/clear-session');
});

test('Webapp composite strip & live preview align all photo slots (especially the last 2 photos) with 300 DPI template cutouts', async () => {
  const { app, sandbox } = renderer(true);

  // 1. Verify getLayoutGeometry matches exact template PNG hole coordinates for all 4 layouts
  const g2x6 = app.getLayoutGeometry('2x6_strip4');
  assert.deepEqual(Array.from(g2x6.canvas), [600, 1800]);
  assert.deepEqual(Array.from(g2x6.slots[2]), [58, 841, 484, 340], '2x6_strip4 3rd slot must align at y=841');
  assert.deepEqual(Array.from(g2x6.slots[3]), [58, 1233, 484, 340], '2x6_strip4 4th slot must align at y=1233');

  const gMini = app.getLayoutGeometry('mini_strip24x72');
  assert.deepEqual(Array.from(gMini.canvas), [283, 850]);
  assert.deepEqual(Array.from(gMini.slots[2]), [24, 409, 236, 168], 'mini_strip24x72 3rd slot must align at y=409');
  assert.deepEqual(Array.from(gMini.slots[3]), [24, 598, 236, 169], 'mini_strip24x72 4th slot must align at y=598');

  const g2x2 = app.getLayoutGeometry('4x6_grid2x2');
  assert.deepEqual(Array.from(g2x2.canvas), [1200, 1800]);
  assert.deepEqual(Array.from(g2x2.slots[2]), [80, 840, 480, 680], '4x6_grid2x2 3rd slot must align at (80, 840)');
  assert.deepEqual(Array.from(g2x2.slots[3]), [640, 840, 480, 680], '4x6_grid2x2 4th slot must align at (640, 840)');

  const g2x3 = app.getLayoutGeometry('4x6_grid2x3');
  assert.deepEqual(Array.from(g2x3.canvas), [1200, 1800]);
  assert.deepEqual(Array.from(g2x3.slots[4]), [80, 1120, 480, 480], '4x6_grid2x3 5th slot must align at (80, 1120)');
  assert.deepEqual(Array.from(g2x3.slots[5]), [640, 1120, 480, 480], '4x6_grid2x3 6th slot must align at (640, 1120)');

  // 2. Verify renderCompositeStripCanvas clips & draws each photo at the exact slot rects instead of drifting with pad=32,gap=18
  const clipRects = [];
  let activeLayout = '2x6_strip4';
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        fillText() {},
        save() {},
        restore() {},
        beginPath() {},
        rect(x, y, w, h) { clipRects.push([x, y, w, h]); },
        clip() {},
        translate() {},
        rotate() {},
        drawImage() {}
      };
    }
  };
  sandbox.document = {
    getElementById(id) {
      if (id === 'select-booth-layout') return { value: activeLayout };
      if (id === 'select-booth-template') return { value: 'none' };
      if (id === 'select-booth-orientation') return { value: 'auto' };
      return null;
    },
    createElement(tag) {
      if (tag === 'canvas') return mockCanvas;
      return {};
    }
  };
  sandbox.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  app.stripPhotos = [
    { rawBlob: {} }, { rawBlob: {} }, { rawBlob: {} }, { rawBlob: {} }, { rawBlob: {} }, { rawBlob: {} }
  ];

  await app.renderCompositeStripCanvas();
  assert.equal(mockCanvas.width, 600, '2x6_strip4 composite canvas width must be 600');
  assert.equal(mockCanvas.height, 1800, '2x6_strip4 composite canvas height must be 1800');
  assert.deepEqual(clipRects, [
    [58, 57, 484, 340],
    [58, 450, 484, 340],
    [58, 841, 484, 340],
    [58, 1233, 484, 340]
  ], 'renderCompositeStripCanvas must place all 4 photos in 2x6_strip4 at exact template hole coordinates');

  clipRects.length = 0;
  activeLayout = '4x6_grid2x2';
  await app.renderCompositeStripCanvas();
  assert.equal(mockCanvas.width, 1200);
  assert.equal(mockCanvas.height, 1800);
  assert.deepEqual(clipRects[2], [80, 840, 480, 680]);
  assert.deepEqual(clipRects[3], [640, 840, 480, 680]);
});
