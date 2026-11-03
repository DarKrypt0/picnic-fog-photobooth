/**
 * Floating-point condensation density field, radial brushes, evaporation,
 * capped water drips, and intro title mask carving.
 */

export class FogEngine {
  constructor(gridWidth = 320, gridHeight = 180) {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.density = new Float32Array(gridWidth * gridHeight);
    this.noise = new Uint8Array(gridWidth * gridHeight);
    this.drips = [];
    this.maxDrips = 14;
    // Target ~120 seconds for full evaporation (1 / 120 per second)
    this.evaporationPerSec = 1 / 120;

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = gridWidth;
    this.maskCanvas.height = gridHeight;
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.imageData = this.maskCtx.createImageData(gridWidth, gridHeight);

    this.initNoise();
  }

  initNoise() {
    for (let i = 0; i < this.noise.length; i++) {
      this.noise[i] = 215 + ((i * 73) % 35);
    }
  }

  fillInitialIntroFog() {
    this.density.fill(0.86);
    this.carveIntroTitle();
  }

  carveIntroTitle() {
    const temp = document.createElement('canvas');
    temp.width = this.gridWidth;
    temp.height = this.gridHeight;
    const tctx = temp.getContext('2d');
    tctx.fillStyle = '#000';
    tctx.font = `bold ${Math.round(this.gridHeight * 0.22)}px Caveat, cursive`;
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    tctx.fillText('Picnic Glass', this.gridWidth * 0.5, this.gridHeight * 0.25);

    const data = tctx.getImageData(0, 0, this.gridWidth, this.gridHeight).data;
    for (let i = 0; i < this.density.length; i++) {
      const alpha = data[i * 4 + 3] / 255;
      if (alpha > 0.1) {
        this.density[i] = Math.max(0.05, this.density[i] * (1 - alpha * 0.92));
      }
    }
  }

  cloneDensity() {
    return new Float32Array(this.density);
  }

  restoreDensity(snapshot) {
    if (snapshot && snapshot.length === this.density.length) {
      this.density.set(snapshot);
    }
  }

  clearAll() {
    this.density.fill(0);
    this.drips.length = 0;
  }

  /**
   * Adds breath fog centered at normalized [0..1] coords with light ambient spread.
   */
  addBreath(normX, normY, dtSec, intensity = 1.15) {
    const cx = normX * this.gridWidth;
    const cy = normY * this.gridHeight;
    const radius = Math.max(this.gridWidth, this.gridHeight) * 0.22;
    const rSq = radius * radius;
    const ambientGain = 0.08 * dtSec * intensity;

    for (let y = 0; y < this.gridHeight; y++) {
      const dy = y - cy;
      const rowOffset = y * this.gridWidth;
      for (let x = 0; x < this.gridWidth; x++) {
        const dx = x - cx;
        const dSq = dx * dx + dy * dy;
        let add = ambientGain;
        if (dSq < rSq) {
          const falloff = 1 - Math.sqrt(dSq) / radius;
          add += falloff * falloff * 0.95 * dtSec * intensity;
        }
        const idx = rowOffset + x;
        const nextVal = Math.min(1, this.density[idx] + add);
        this.density[idx] = nextVal;

        if (nextVal > 0.92 && this.drips.length < this.maxDrips && Math.random() < 0.0005) {
          this.drips.push({ x, y, vy: 10 + Math.random() * 14, life: 2.5 });
        }
      }
    }
  }

  /**
   * Clears fog along a continuous segment between two normalized points [0..1].
   */
  clearSegment(normX0, normY0, normX1, normY1, normRadius = 0.035) {
    const x0 = normX0 * this.gridWidth;
    const y0 = normY0 * this.gridHeight;
    const x1 = normX1 * this.gridWidth;
    const y1 = normY1 * this.gridHeight;
    const r = Math.max(3, normRadius * this.gridWidth);

    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.35)));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      this.stampClearCircle(cx, cy, r);
    }

    // Spawn restrained water drip at stroke bottom when clearing heavy condensation
    if (this.drips.length < this.maxDrips && Math.random() < 0.12) {
      const gx = Math.round(x1);
      const gy = Math.round(y1);
      if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
        this.drips.push({ x: gx, y: gy, vy: 14, life: 1.8 });
      }
    }
  }

  stampClearCircle(cx, cy, r) {
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.gridWidth - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.gridHeight - 1, Math.ceil(cy + r));
    const rSq = r * r;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const row = y * this.gridWidth;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dSq = dx * dx + dy * dy;
        if (dSq <= rSq) {
          const distRatio = Math.sqrt(dSq) / r;
          const keep = distRatio > 0.7 ? (distRatio - 0.7) / 0.3 : 0;
          const idx = row + x;
          this.density[idx] = Math.min(this.density[idx], this.density[idx] * keep);
        }
      }
    }
  }

  /**
   * Advances evaporation and drip tracks. Clamps dtSec after tab suspension.
   */
  step(dtSec) {
    const clampedDt = Math.min(0.1, Math.max(0, dtSec));
    if (clampedDt === 0) return;

    const evap = this.evaporationPerSec * clampedDt;
    for (let i = 0; i < this.density.length; i++) {
      if (this.density[i] > 0) {
        this.density[i] = Math.max(0, this.density[i] - evap);
      }
    }

    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.y += d.vy * clampedDt;
      d.life -= clampedDt;
      this.stampClearCircle(d.x, d.y, 1.8);
      if (d.life <= 0 || d.y >= this.gridHeight) {
        this.drips.splice(i, 1);
      }
    }
  }

  /**
   * Quantizes floating-point density field into an offscreen RGBA mask canvas.
   */
  renderMaskCanvas() {
    const data = this.imageData.data;
    for (let i = 0; i < this.density.length; i++) {
      const d = this.density[i];
      const n = this.noise[i];
      const p = i * 4;
      data[p] = n;
      data[p + 1] = Math.min(255, n + 10);
      data[p + 2] = Math.min(255, n + 16);
      data[p + 3] = Math.round(Math.min(1, d) * 232);
    }
    this.maskCtx.putImageData(this.imageData, 0, 0);
    return this.maskCanvas;
  }

  /**
   * Resamples density field if aspect ratio changes drastically.
   */
  resample(newGridWidth, newGridHeight) {
    if (newGridWidth === this.gridWidth && newGridHeight === this.gridHeight) return;
    const nextDensity = new Float32Array(newGridWidth * newGridHeight);
    for (let y = 0; y < newGridHeight; y++) {
      const srcY = Math.min(this.gridHeight - 1, Math.floor((y / newGridHeight) * this.gridHeight));
      for (let x = 0; x < newGridWidth; x++) {
        const srcX = Math.min(this.gridWidth - 1, Math.floor((x / newGridWidth) * this.gridWidth));
        nextDensity[y * newGridWidth + x] = this.density[srcY * this.gridWidth + srcX];
      }
    }
    this.gridWidth = newGridWidth;
    this.gridHeight = newGridHeight;
    this.density = nextDensity;
    this.noise = new Uint8Array(newGridWidth * newGridHeight);
    this.initNoise();
    this.maskCanvas.width = newGridWidth;
    this.maskCanvas.height = newGridHeight;
    this.imageData = this.maskCtx.createImageData(newGridWidth, newGridHeight);
  }
}
