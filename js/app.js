/**
 * Main application coordinator: lifecycle, camera setup, onboarding,
 * rendering order, countdown locking, and accessible toolbar controls.
 */

import { computeCoverTransform, mapNormalizedToStage, PointSmoother } from './tracking/coordinates.js';
import { VisionTracker } from './tracking/tracker.js';
import { evaluateMouthPose, evaluateHandPose, InteractionArbitrator } from './input/classifiers.js';
import { FogEngine } from './fog.js';
import { MarksLayer } from './marks.js';
import { SceneManager } from './scenes/scenes.js';
import { PhotoTrayManager } from './capture.js';

class PicnicPhotoboothApp {
  constructor() {
    this.videoEl = document.getElementById('camera-video');
    this.stageCanvas = document.getElementById('stage-canvas');
    this.stageCtx = this.stageCanvas.getContext('2d');
    this.uiCanvas = document.getElementById('ui-canvas');
    this.uiCtx = this.uiCanvas.getContext('2d');

    this.sharpBuffer = document.createElement('canvas');
    this.sharpCtx = this.sharpBuffer.getContext('2d');
    this.fogBuffer = document.createElement('canvas');
    this.fogCtx = this.fogBuffer.getContext('2d');

    this.fogEngine = new FogEngine(320, 180);
    this.marksLayer = new MarksLayer(1280, 720);
    this.sceneManager = new SceneManager(1280, 720);
    this.trayManager = new PhotoTrayManager(8);
    this.tracker = new VisionTracker();
    this.arbitrator = new InteractionArbitrator();
    this.handSmoother = new PointSmoother(0.45, 220);

    // State
    this.cameraActive = false;
    this.activeTool = 'write'; // 'write' | 'wipe' | 'lipstick' | 'play'
    this.lipstickColor = '#B64758';
    this.brushSize = 1;
    this.captureOptions = null;
    this.stampMode = 'draw'; // 'draw' | 'kiss' | 'berry' | 'daisy'
    this.calibratedBaseline = 1.0;

    this.pointerDown = false;
    this.pointerPos = null;
    this.lastStrokePos = null;
    this.lastHandStrokePos = null;
    this.fogKeyHeld = false;
    this.lastFogPulseMs = 0;

    this.countdownActive = false;
    this.countdownTimer = null;
    this.lockedDimensions = null;

    this.lastFrameTime = performance.now();

    this.initDOM();
    this.handleResize();
    this.fogEngine.fillInitialIntroFog();
    window.addEventListener('resize', () => this.handleResize());
    requestAnimationFrame((t) => this.loop(t));
  }

  initDOM() {
    this.sceneManager.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('btn-pause-scene').setAttribute('aria-pressed', String(this.sceneManager.paused));
    document.getElementById('btn-pause-scene').textContent = this.sceneManager.paused ? 'Resume Motion' : 'Pause Motion';
    document.getElementById('brush-size').addEventListener('input', e => { this.brushSize = Number(e.target.value); });
    document.getElementById('ink-color').addEventListener('input', e => { this.lipstickColor = e.target.value; });
    window.addEventListener('blur', () => { this.fogKeyHeld = false; this.pointerDown = false; this.lastStrokePos = null; this.arbitrator.setPointerActive(false, performance.now()); });
    window.addEventListener('pagehide', () => { this.stopCameraStream(); this.trayManager.clearAll(); });
    // Intro buttons
    document.getElementById('btn-start-camera').addEventListener('click', () => this.startCamera());
    document.getElementById('btn-try-demo').addEventListener('click', () => this.startDemoMode());
    document.getElementById('btn-retry-camera').addEventListener('click', () => this.startCamera());
    document.getElementById('btn-skip-calib').addEventListener('click', () => {
      document.getElementById('calibration-overlay').classList.add('hidden');
    });

    // Scene picker
    const selectScene = document.getElementById('select-scene');
    selectScene.addEventListener('change', (e) => {
      this.sceneManager.setScene(e.target.value);
      this.showToast('Scene changed — glass fog and marks preserved.');
    });

    const btnPause = document.getElementById('btn-pause-scene');
    btnPause.addEventListener('click', () => {
      this.sceneManager.paused = !this.sceneManager.paused;
      btnPause.setAttribute('aria-pressed', String(this.sceneManager.paused));
      btnPause.textContent = this.sceneManager.paused ? 'Resume Motion' : 'Pause Motion';
    });

    // Top utilities
    document.getElementById('btn-undo').addEventListener('click', () => this.handleUndo());
    document.getElementById('btn-clear-glass').addEventListener('click', () => this.clearGlassOnly());
    document.getElementById('btn-clear-marks').addEventListener('click', () => this.clearMarksOnly());
    document.getElementById('btn-reset-scene').addEventListener('click', () => this.resetScene());
    document.getElementById('btn-toggle-tray').addEventListener('click', (e) => {
      const tray = document.getElementById('photo-tray');
      const hidden = tray.classList.toggle('hidden');
      e.currentTarget.setAttribute('aria-expanded', String(!hidden));
    });
    document.getElementById('btn-help').addEventListener('click', () => {
      document.getElementById('intro-overlay').classList.remove('hidden');
    });

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.selectTool(btn.dataset.tool));
    });

    // Lipstick swatches & stamp mode
    document.querySelectorAll('.swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach((s) => { s.classList.remove('active'); s.setAttribute('aria-pressed', 'false'); });
        sw.setAttribute('aria-pressed', 'true');
        sw.classList.add('active');
        this.lipstickColor = sw.dataset.color;
      });
    });
    document.getElementById('select-stamp-mode').addEventListener('change', (e) => {
      this.stampMode = e.target.value;
    });

    document.querySelectorAll('[role="radiogroup"] .tool-btn').forEach((btn, index, buttons) => {
      btn.addEventListener('keydown', e => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
      });
    });
    // Fog & Photo controls
    const btnFog = document.getElementById('btn-fog-pulse');
    btnFog.addEventListener('click', () => this.triggerBoundedFogPulse());
    btnFog.addEventListener('pointercancel', () => { this.fogKeyHeld = false; });
    btnFog.addEventListener('pointerdown', () => {
      this.fogKeyHeld = true;
      this.triggerBoundedFogPulse();
    });
    window.addEventListener('pointerup', () => {
      this.fogKeyHeld = false;
    });

    this.selectTool('write');
    document.getElementById('btn-photo').addEventListener('click', () => this.startCountdown());
    document.getElementById('btn-cancel-countdown').addEventListener('click', () => this.cancelCountdown('Countdown cancelled.'));

    // Stage Pointer events (mouse and touch)
    this.stageCanvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.stageCanvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.stageCanvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.stageCanvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON';

      if (e.key === 'Escape' && this.countdownActive) {
        e.preventDefault();
        this.cancelCountdown('Countdown cancelled.');
        return;
      }
      if (isInputFocused) return;

      if (e.code === 'Space' && !this.countdownActive) {
        e.preventDefault();
        this.startCountdown();
      } else if (e.key === 'f' || e.key === 'F') {
        this.fogKeyHeld = true;
        this.triggerBoundedFogPulse();
      } else if (e.key === 'c' || e.key === 'C') {
        this.clearGlassOnly();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'f' || e.key === 'F') {
        this.fogKeyHeld = false;
      }
    });
  }

  selectTool(toolName) {
    this.activeTool = toolName;
    this.lastStrokePos = null;
    this.lastHandStrokePos = null;

    document.querySelectorAll('.tool-btn').forEach((btn) => {
      const active = btn.dataset.tool === toolName;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
      btn.tabIndex = active ? 0 : -1;
    });

    const lipSettings = document.getElementById('lipstick-settings');
    lipSettings.classList.toggle('hidden', toolName !== 'lipstick');
  }

  async startCamera() {
    if (this.startingCamera) return;
    this.startingCamera = true;
    this.stopCameraStream();
    document.getElementById('intro-overlay').classList.add('hidden');
    this.updateStatus('Starting camera...', 'warn');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false // Never request microphone access
      });
      this.videoEl.srcObject = stream;
      await this.videoEl.play();
      this.cameraActive = true;
      document.getElementById('btn-retry-camera').classList.add('hidden');

      this.updateStatus('Loading on-device AI...', 'warn');
      const res = await this.tracker.init();
      if (res.ready) {
        this.updateStatus('Camera & Tracking Ready', 'ready');
        this.showToast('Make an "O" mouth to fog, or point your index finger to draw!');
        if (document.getElementById('chk-calibrate-mouth').checked) {
          this.runMouthCalibration();
        }
      } else {
        this.updateStatus('Camera Ready (Pointer Mode)', 'warn');
        this.showToast('Tracking models unavailable; mouse and touch controls active.');
      }
    } catch (err) {
      this.stopCameraStream();
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission blocked'
        : err.name === 'NotFoundError'
          ? 'No camera found'
          : 'Camera busy or unavailable';
      this.updateStatus(msg, 'error');
      document.getElementById('btn-retry-camera').classList.remove('hidden');
      this.showToast(`${msg}. Running with Picnic Demo background.`);
    } finally { this.startingCamera = false; }
  }

  startDemoMode() {
    this.stopCameraStream();
    document.getElementById('intro-overlay').classList.add('hidden');
    this.updateStatus('Picnic Demo Mode', 'ready');
    this.showToast('Hold F to breathe fog and drag on the glass to draw!');
  }

  stopCameraStream() {
    if (this.videoEl.srcObject) {
      this.videoEl.srcObject.getTracks().forEach((t) => t.stop());
      this.videoEl.srcObject = null;
    }
    this.cameraActive = false;
  }

  runMouthCalibration() {
    const overlay = document.getElementById('calibration-overlay');
    const bar = document.getElementById('calib-progress');
    overlay.classList.remove('hidden');
    const samples = [];
    const start = performance.now();
    const duration = 2200;

    const tick = (now) => {
      if (overlay.classList.contains('hidden')) return;
      const pct = Math.min(100, ((now - start) / duration) * 100);
      bar.style.width = `${pct}%`;

      if (this.lastMouthRawScore > 0.2) {
        samples.push(this.lastMouthRawScore);
      }

      if (now - start < duration) {
        requestAnimationFrame(tick);
      } else {
        if (samples.length > 5) {
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          this.calibratedBaseline = Math.max(0.65, Math.min(1.35, avg / 0.55));
          this.showToast('Mouth fog calibration complete!');
        }
        overlay.classList.add('hidden');
      }
    };
    requestAnimationFrame(tick);
  }

  handleResize() {
    const rect = this.stageCanvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));

    if (this.countdownActive && this.lockedDimensions) {
      if (Math.abs(w - this.lockedDimensions.w) > 40 || Math.abs(h - this.lockedDimensions.h) > 40) {
        this.cancelCountdown('Orientation or window size changed; countdown cancelled.');
      }
    }

    this.stageCanvas.width = w;
    this.stageCanvas.height = h;
    this.uiCanvas.width = w;
    this.uiCanvas.height = h;
    this.sharpBuffer.width = w;
    this.sharpBuffer.height = h;
    this.fogBuffer.width = w;
    this.fogBuffer.height = h;

    this.marksLayer.resize(w, h);
    this.updateUndoButton();
    this.sceneManager.resize(w, h);
  }

  onPointerDown(e) {
    if (this.countdownActive) return;
    this.stageCanvas.setPointerCapture(e.pointerId);
    this.pointerDown = true;
    const pos = this.getPointerPos(e);
    this.pointerPos = pos;
    this.lastStrokePos = pos;
    this.arbitrator.setPointerActive(true, performance.now());

    if (this.activeTool !== 'play') {
      this.marksLayer.pushUndo(this.fogEngine.cloneDensity());
      this.updateUndoButton();
    }

    if (this.activeTool === 'lipstick' && this.stampMode !== 'draw') {
      this.marksLayer.placeStamp(pos.x, pos.y, this.stampMode, this.lipstickColor);
    } else {
      this.applyToolSegment(pos, pos);
    }
  }

  onPointerMove(e) {
    const pos = this.getPointerPos(e);
    this.pointerPos = pos;
    if (!this.pointerDown || this.countdownActive) return;

    if (this.activeTool === 'lipstick' && this.stampMode !== 'draw') {
      return;
    }
    if (this.lastStrokePos) {
      this.applyToolSegment(this.lastStrokePos, pos);
    }
    this.lastStrokePos = pos;
  }

  onPointerUp(e) {
    if (this.stageCanvas.hasPointerCapture?.(e.pointerId)) {
      this.stageCanvas.releasePointerCapture(e.pointerId);
    }
    this.pointerDown = false;
    this.lastStrokePos = null;
    this.arbitrator.setPointerActive(false, performance.now());
  }

  getPointerPos(e) {
    const rect = this.stageCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  applyToolSegment(p0, p1, scaleMultiplier = 1) {
    if (this.activeTool === 'play' || this.countdownActive) return;
    scaleMultiplier *= this.brushSize;
    const w = this.stageCanvas.width;
    const h = this.stageCanvas.height;
    const nx0 = p0.x / w;
    const ny0 = p0.y / h;
    const nx1 = p1.x / w;
    const ny1 = p1.y / h;

    if (this.activeTool === 'write') {
      this.fogEngine.clearSegment(nx0, ny0, nx1, ny1, 0.032 * scaleMultiplier);
    } else if (this.activeTool === 'wipe') {
      this.fogEngine.clearSegment(nx0, ny0, nx1, ny1, 0.068 * scaleMultiplier);
      this.marksLayer.wipeSegment(p0.x, p0.y, p1.x, p1.y, 42 * scaleMultiplier);
    } else if (this.activeTool === 'lipstick' && this.stampMode === 'draw') {
      this.marksLayer.drawLipstickSegment(p0.x, p0.y, p1.x, p1.y, this.lipstickColor, 11 * scaleMultiplier);
    }
  }

  triggerBoundedFogPulse() {
    if (this.countdownActive) return;
    const now = performance.now();
    if (now - this.lastFogPulseMs < 110) return;
    this.lastFogPulseMs = now;
    this.fogEngine.addBreath(0.5, 0.55, 0.16, 1.45);
  }

  clearGlassOnly() {
    this.marksLayer.pushUndo(this.fogEngine.cloneDensity());
    this.fogEngine.clearAll();
    this.updateUndoButton();
    this.announce('Cleared glass condensation. Lipstick marks preserved.');
  }

  clearMarksOnly() {
    this.marksLayer.pushUndo(this.fogEngine.cloneDensity());
    this.marksLayer.clearAll();
    this.updateUndoButton();
    this.announce('Cleared lipstick and stamps.');
  }

  resetScene() {
    this.marksLayer.pushUndo(this.fogEngine.cloneDensity());
    this.fogEngine.clearAll();
    this.marksLayer.clearAll();
    this.updateUndoButton();
    this.announce('Scene reset. Captured photos remain in the tray.');
  }

  handleUndo() {
    if (this.marksLayer.popUndo(this.fogEngine)) {
      this.updateUndoButton();
      this.announce('Undid last action.');
    }
  }

  updateUndoButton() {
    document.getElementById('btn-undo').disabled = !this.marksLayer.canUndo();
  }

  startCountdown() {
    if (this.countdownActive) return;
    this.countdownActive = true;
    this.lockedDimensions = { w: this.stageCanvas.width, h: this.stageCanvas.height };

    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    overlay.classList.remove('hidden');

    this.captureOptions = { frame: document.getElementById('select-frame').value, includeDate: document.getElementById('include-date').checked };
    let remaining = Number(document.getElementById('select-timer').value);
    if (remaining === 0) { overlay.classList.add('hidden'); this.completePhotoCapture(); return; }
    numEl.textContent = String(remaining);
    this.announce(`Countdown started: ${remaining}`);

    this.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        numEl.textContent = String(remaining);
        this.announce(String(remaining));
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        overlay.classList.add('hidden');
        this.completePhotoCapture();
      }
    }, 1000);
  }

  cancelCountdown(reason) {
    if (!this.countdownActive) return;
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownActive = false;
    this.lockedDimensions = null;
    document.getElementById('countdown-overlay').classList.add('hidden');
    this.showToast(reason);
    this.announce(reason);
  }

  async completePhotoCapture() {
    try {
      await this.trayManager.captureFramedBlob(this.stageCanvas, this.captureOptions.includeDate, this.captureOptions.frame);
      this.renderPhotoTray();
      document.getElementById('photo-tray').classList.remove('hidden');
      document.getElementById('btn-toggle-tray').setAttribute('aria-expanded', 'true');
      this.announce('Picnic photo captured and added to tray.');
      this.showToast('📸 Picnic print added to tray!');
    } catch (err) {
      console.error(err);
      this.showToast('Could not capture photo.');
    } finally {
      this.countdownActive = false;
      this.lockedDimensions = null;
    }
  }

  renderPhotoTray() {
    const list = document.getElementById('photo-list');
    const countEl = document.getElementById('photo-count');
    const warnEl = document.getElementById('tray-warning');

    countEl.textContent = String(this.trayManager.photos.length);
    warnEl.classList.toggle('hidden', !this.trayManager.isFull());
    list.innerHTML = '';

    if (this.trayManager.photos.length === 0) {
      list.innerHTML = '<p class="empty-tray-msg">No photos yet. Fog the glass and press <strong>Photo</strong>!</p>';
      return;
    }

    for (const photo of [...this.trayManager.photos].reverse()) {
      const card = document.createElement('div');
      card.className = 'photo-card';

      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = `Captured picnic print from ${photo.createdAt.toLocaleTimeString()}`;

      const actions = document.createElement('div');
      actions.className = 'photo-card-actions';

      const saveBtn = document.createElement('a');
      saveBtn.className = 'btn btn-primary';
      saveBtn.href = photo.url;
      saveBtn.download = `${photo.id}.png`;
      saveBtn.textContent = 'Save';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-secondary';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        this.trayManager.removePhoto(photo.id);
        this.renderPhotoTray();
      });

      actions.append(saveBtn, delBtn);
      card.append(img, actions);
      list.appendChild(card);
    }
  }

  updateStatus(text, state = 'ready') {
    document.getElementById('status-text').textContent = text;
    const dot = document.getElementById('status-dot');
    dot.className = 'status-dot';
    if (state === 'ready') dot.classList.add('ready');
    if (state === 'error') dot.classList.add('error');
  }

  showToast(msg) {
    const toast = document.getElementById('toast-banner');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3400);
  }

  announce(msg) {
    document.getElementById('sr-announcer').textContent = msg;
  }

  loop(nowMs) {
    const dtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastFrameTime) / 1000));
    this.lastFrameTime = nowMs;

    const w = this.stageCanvas.width;
    const h = this.stageCanvas.height;

    if (!this.countdownActive) {
      if (this.fogKeyHeld) {
        this.triggerBoundedFogPulse();
      }
      this.processTracking(nowMs, dtSec);
      this.fogEngine.step(dtSec);
    }

    this.renderComposite(dtSec, w, h);
    requestAnimationFrame((t) => this.loop(t));
  }

  processTracking(nowMs, dtSec) {
    this.uiCtx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);

    if (!this.cameraActive || !this.tracker.isReady) {
      return;
    }

    const detection = this.tracker.detect(this.videoEl, nowMs);
    if (detection) {
      this.lastDetection = detection;
    }
    if (!this.lastDetection) return;

    const vw = this.videoEl.videoWidth || 1280;
    const vh = this.videoEl.videoHeight || 720;
    const sw = this.stageCanvas.width;
    const sh = this.stageCanvas.height;

    const mouthEval = evaluateMouthPose(
      this.lastDetection.faceLandmarks,
      this.lastDetection.blendshapes,
      this.calibratedBaseline
    );
    this.lastMouthRawScore = mouthEval.score;

    const handEval = evaluateHandPose(this.lastDetection.handLandmarks);
    const arb = this.arbitrator.update({
      mouthScore: mouthEval.score,
      handPose: this.activeTool === 'wipe' && handEval.pose === 'fist' ? 'point' : handEval.pose,
      nowMs
    });

    // 1. Mouth Breath Ring & Fogging
    if (mouthEval.mouthCenter) {
      const mStage = mapNormalizedToStage(mouthEval.mouthCenter.x, mouthEval.mouthCenter.y, vw, vh, sw, sh, true);
      if (arb.mouthProgress > 0.05) {
        this.drawBreathIndicator(mStage.x, mStage.y, arb.mouthProgress, arb.mouthActive);
      }
      if (arb.mouthActive) {
        this.fogEngine.addBreath(mStage.x / sw, mStage.y / sh, dtSec, 1.25);
      }
    }

    // 2. Hand Tool Cursor & Application
    if (handEval.indexTip) {
      const handPoint = this.activeTool === 'wipe' && handEval.pose === 'fist' ? handEval.fistCenter : handEval.indexTip;
      const rawTip = mapNormalizedToStage(handPoint.x, handPoint.y, vw, vh, sw, sh, true);
      if (this.lastDetection.handReacquired) {
        this.handSmoother.reset();
        this.lastHandStrokePos = null;
      }
      const tip = this.handSmoother.update(rawTip.x, rawTip.y, nowMs);
      this.trackedHandPos = tip;

      this.drawTrackingCursor(tip.x, tip.y, arb.handApplying);

      if (arb.handApplying) {
        if (!this.lastHandStrokePos) {
          this.marksLayer.pushUndo(this.fogEngine.cloneDensity());
          this.updateUndoButton();
          if (this.activeTool === 'lipstick' && this.stampMode !== 'draw') {
            this.marksLayer.placeStamp(tip.x, tip.y, this.stampMode, this.lipstickColor);
          }
        }
        const prev = this.lastHandStrokePos || tip;
        this.applyToolSegment(prev, tip, Math.max(0.75, Math.min(1.5, handEval.handScale * 6)));
        this.lastHandStrokePos = tip;
      } else {
        this.lastHandStrokePos = null;
      }
    } else {
      this.trackedHandPos = null;
      this.lastHandStrokePos = null;
    }
  }

  drawBreathIndicator(x, y, progress, active) {
    const ctx = this.uiCtx;
    ctx.save();
    ctx.strokeStyle = active ? '#7FC8C2' : '#F2B544';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 24, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.restore();
  }

  drawTrackingCursor(x, y, isApplying) {
    const ctx = this.uiCtx;
    ctx.save();
    ctx.strokeStyle = '#F4F8F9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    if (isApplying) {
      ctx.fillStyle = this.activeTool === 'lipstick' ? this.lipstickColor : '#7FC8C2';
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Renders in strict order:
   * 1) Mirrored camera or picnic demo background
   * 2) Behind-glass scene effects
   * 3) Fogged copy of combined scene composited via fog density mask
   * 4) Surface lipstick marks and water drip highlights
   */
  renderComposite(dtSec, w, h) {
    const sCtx = this.sharpCtx;
    sCtx.clearRect(0, 0, w, h);

    // 1. Mirrored Video or Demo Background
    if (this.cameraActive && this.videoEl.readyState >= 2) {
      const vw = this.videoEl.videoWidth;
      const vh = this.videoEl.videoHeight;
      const { scale, offsetX, offsetY } = computeCoverTransform(vw, vh, w, h);
      sCtx.save();
      sCtx.translate(w, 0);
      sCtx.scale(-1, 1);
      sCtx.drawImage(this.videoEl, offsetX, offsetY, vw * scale, vh * scale);
      sCtx.restore();
    } else {
      this.sceneManager.renderDemoBackground(sCtx);
    }

    // 2. Behind-the-glass Picnic Scene Effects
    const playTarget = this.activeTool === 'play' ? (this.pointerPos || this.trackedHandPos) : null;
    this.sceneManager.renderScene(sCtx, this.countdownActive ? 0 : dtSec, playTarget);

    // Draw sharp base onto stage
    this.stageCtx.clearRect(0, 0, w, h);
    this.stageCtx.drawImage(this.sharpBuffer, 0, 0);

    // 3. Fogged copy of combined scene + condensation mask
    const fCtx = this.fogCtx;
    fCtx.clearRect(0, 0, w, h);
    fCtx.save();
    fCtx.filter = 'blur(12px) brightness(1.06)';
    fCtx.drawImage(this.sharpBuffer, 0, 0);
    fCtx.restore();

    // Subtle cool fog haze tint
    fCtx.fillStyle = 'rgba(214, 226, 232, 0.42)';
    fCtx.fillRect(0, 0, w, h);

    // Mask by floating-point fog density field
    const maskCanvas = this.fogEngine.renderMaskCanvas();
    fCtx.save();
    fCtx.globalCompositeOperation = 'destination-in';
    fCtx.drawImage(maskCanvas, 0, 0, w, h);
    fCtx.restore();

    this.stageCtx.drawImage(this.fogBuffer, 0, 0);

    // 4. Surface Lipstick & Water Drip Highlights
    this.stageCtx.drawImage(this.marksLayer.canvas, 0, 0);

    this.stageCtx.fillStyle = 'rgba(244, 248, 249, 0.7)';
    for (const d of this.fogEngine.drips) {
      const dx = (d.x / this.fogEngine.gridWidth) * w;
      const dy = (d.y / this.fogEngine.gridHeight) * h;
      this.stageCtx.beginPath();
      this.stageCtx.arc(dx, dy, 3.2, 0, Math.PI * 2);
      this.stageCtx.fill();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.picnicApp = new PicnicPhotoboothApp();
});
