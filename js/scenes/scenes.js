/**
 * Picnic scenes rendered behind the glass pane:
 * - 'meadow': Sunny Picnic Meadow (Golden sunbeams + floating dandelion fluff seeds)
 * - 'blossoms': Cherry Blossom Breeze (Floating pink petals + warm spring sunlight)
 * - 'butterflies': Butterfly & Wildflower Garden (Fluttering picnic butterflies + drifting daisies)
 * - 'gingham': Golden Hour Gingham (Honey-amber sunset glow + red/cream picnic gingham border + pollen motes)
 * - 'shade': Dappled Tree Shade (Swaying canopy sunbeams + dappled leaf bokeh + meadow fluff)
 */

import { CreatureRenderer } from './creature-renderer.js';

export class SceneManager {
  constructor(width = 1280, height = 720) {
    this.width = width;
    this.height = height;
    this.currentScene = 'meadow';
    this.paused = false;
    this.time = 0;

    this.initEntities();
    this.creatureRenderer = typeof CreatureRenderer !== 'undefined'
      ? new CreatureRenderer(typeof window !== 'undefined' ? window.THREE : null, width, height)
      : null;
  }

  resize(width, height) {
    const sx = this.width > 0 ? width / this.width : 1;
    const sy = this.height > 0 ? height / this.height : 1;
    this.width = width;
    this.height = height;
    for (const list of [this.seeds, this.petals, this.butterflies, this.daisies, this.dappledLeaves]) {
      if (!list) continue;
      for (const item of list) {
        item.x *= sx;
        item.y *= sy;
      }
    }
    this.creatureRenderer?.resize(width, height);
  }

  setScene(sceneId) {
    this.currentScene = sceneId;
    this.creatureRenderer?.onSceneChanged(sceneId);
  }

  initEntities() {
    const width = this.width;
    const height = this.height;

    this.seeds = Array.from({ length: 18 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 16 + Math.random() * 22,
      vy: -8 - Math.random() * 14,
      size: 2.8 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2
    }));

    const petalColors = ['#FFB7C5', '#FFC8D6', '#FFE4EC', '#F99DB0'];
    this.petals = Array.from({ length: 26 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 24 + Math.random() * 28,
      vy: 22 + Math.random() * 26,
      rx: 5 + Math.random() * 4.5,
      ry: 3.2 + Math.random() * 2.5,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2.4,
      swayPhase: Math.random() * Math.PI * 2,
      color: petalColors[i % petalColors.length]
    }));

    const butterflyColors = ['#F2B544', '#FF8FA3', '#7FC8C2', '#F7D070', '#E63946'];
    this.butterflies = Array.from({ length: 8 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 85,
      vy: (Math.random() - 0.5) * 65,
      wingPhase: Math.random() * Math.PI * 2,
      scale: 0.85 + (i % 3) * 0.18,
      color: butterflyColors[i % butterflyColors.length]
    }));

    this.daisies = Array.from({ length: 12 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 12 + Math.random() * 18,
      vy: 14 + Math.random() * 18,
      r: 5 + Math.random() * 3.5,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 1.2
    }));

    this.dappledLeaves = Array.from({ length: 14 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 28 + (i % 5) * 14,
      phase: Math.random() * Math.PI * 2
    }));
  }

  renderDemoBackground(ctx) {
    const w = this.width;
    const h = this.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (this.currentScene === 'blossoms') {
      grad.addColorStop(0, '#F7D1CD');
      grad.addColorStop(0.55, '#F9E5D8');
      grad.addColorStop(1, '#98C9A3');
    } else if (this.currentScene === 'butterflies') {
      grad.addColorStop(0, '#8ED8D2');
      grad.addColorStop(0.6, '#D9F0C7');
      grad.addColorStop(1, '#85B86C');
    } else if (this.currentScene === 'gingham') {
      grad.addColorStop(0, '#F5C37E');
      grad.addColorStop(0.58, '#F9DFB0');
      grad.addColorStop(1, '#A3BE7B');
    } else if (this.currentScene === 'shade') {
      grad.addColorStop(0, '#6CA98F');
      grad.addColorStop(0.6, '#A9D6AD');
      grad.addColorStop(1, '#5D9361');
    } else {
      grad.addColorStop(0, '#88D4CD');
      grad.addColorStop(0.65, '#CDEAC0');
      grad.addColorStop(1, '#7FB069');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  renderScene(ctx, dtSec, playTarget = null) {
    const dt = this.paused ? 0 : Math.min(0.1, Math.max(0, dtSec));
    this.time += dt;
    const w = this.width;
    const h = this.height;
    const targetPx = playTarget
      ? {
          x: playTarget.x <= 1.5 ? playTarget.x * w : playTarget.x,
          y: playTarget.y <= 1.5 ? playTarget.y * h : playTarget.y
        }
      : null;

    if (this.currentScene === 'meadow') {
      const sun = ctx.createRadialGradient(w * 0.84, h * 0.14, 8, w * 0.84, h * 0.14, Math.max(w, h) * 0.58);
      sun.addColorStop(0, 'rgba(255, 224, 130, 0.24)');
      sun.addColorStop(0.5, 'rgba(242, 181, 68, 0.09)');
      sun.addColorStop(1, 'rgba(242, 181, 68, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      for (const s of this.seeds) {
        s.phase += dt * 1.8;
        s.x = (s.x + (s.vx + Math.sin(s.phase) * 8) * dt + w) % w;
        s.y = (s.y + s.vy * dt + h) % h;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Math.sin(s.phase) * 0.25);
        ctx.strokeStyle = 'rgba(244, 248, 249, 0.72)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, s.size * 2.2);
        for (const a of [-0.6, -0.3, 0, 0.3, 0.6]) {
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.sin(a) * s.size * 1.9, -Math.cos(a) * s.size * 1.9);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 250, 235, 0.88)';
        ctx.beginPath();
        ctx.arc(0, 0, s.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (this.currentScene === 'blossoms') {
      const wash = ctx.createLinearGradient(0, 0, w, h);
      wash.addColorStop(0, 'rgba(255, 196, 212, 0.14)');
      wash.addColorStop(0.5, 'rgba(255, 235, 215, 0.06)');
      wash.addColorStop(1, 'rgba(242, 181, 68, 0.10)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      for (const p of this.petals) {
        p.swayPhase += dt * 2.2;
        p.angle += p.spin * dt;
        let vx = p.vx + Math.sin(p.swayPhase) * 18;
        let vy = p.vy + Math.cos(p.swayPhase * 0.8) * 6;
        if (targetPx && dt > 0) {
          const dx = p.x - targetPx.x;
          const dy = p.y - targetPx.y;
          const d = Math.hypot(dx, dy);
          if (d > 1 && d < 150) {
            vx += (dx / d) * 65;
            vy += (dy / d) * 45;
          }
        }
        p.x = (p.x + vx * dt + w) % w;
        p.y = (p.y + vy * dt + h) % h;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.beginPath();
        ctx.ellipse(-p.rx * 0.2, -p.ry * 0.2, p.rx * 0.45, p.ry * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (this.currentScene === 'butterflies') {
      const sun = ctx.createRadialGradient(w * 0.2, h * 0.15, 10, w * 0.2, h * 0.15, Math.max(w, h) * 0.55);
      sun.addColorStop(0, 'rgba(255, 228, 145, 0.22)');
      sun.addColorStop(1, 'rgba(255, 228, 145, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      for (const d of this.daisies) {
        d.x = (d.x + d.vx * dt + w) % w;
        d.y = (d.y + d.vy * dt + h) % h;
        d.rot += d.vrot * dt;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.fillStyle = 'rgba(255, 253, 245, 0.88)';
        for (let k = 0; k < 6; k++) {
          ctx.save();
          ctx.rotate((k * Math.PI) / 3);
          ctx.beginPath();
          ctx.ellipse(d.r * 0.85, 0, d.r * 0.65, d.r * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#F2B544';
        ctx.beginPath();
        ctx.arc(0, 0, d.r * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Diverse 3D / 2D picnic creatures (butterflies, bees, hummingbirds, birds with randomized personalities)
      if (this.creatureRenderer) {
        this.creatureRenderer.render(ctx, dt, playTarget);
      } else {
        for (const b of this.butterflies) {
          if (targetPx && dt > 0) {
            const dx = targetPx.x - b.x;
            const dy = targetPx.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 55 && dist < 440) {
              b.vx += ((dx / dist) * 115 - b.vx) * 2.8 * dt;
              b.vy += ((dy / dist) * 115 - b.vy) * 2.8 * dt;
            } else if (dist <= 55 && dist > 1) {
              b.vx += (-dy / dist) * 70 * dt;
              b.vy += (dx / dist) * 70 * dt;
            }
          }
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.wingPhase += dt * 11;
          if (b.x < 28 || b.x > w - 28) b.vx *= -1;
          if (b.y < 28 || b.y > h - 28) b.vy *= -1;
          b.x = Math.max(20, Math.min(w - 20, b.x));
          b.y = Math.max(20, Math.min(h - 20, b.y));
          const angle = Math.atan2(b.vy, b.vx);

          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(angle);
          ctx.scale(b.scale, b.scale);
          const spread = 8 + Math.sin(b.wingPhase) * 5.5;
          ctx.fillStyle = b.color;
          ctx.globalAlpha = 0.88;
          ctx.beginPath();
          ctx.ellipse(2, -spread * 0.58, 10, spread * 0.82, 0.2, 0, Math.PI * 2);
          ctx.ellipse(2, spread * 0.58, 10, spread * 0.82, -0.2, 0, Math.PI * 2);
          ctx.ellipse(-6, -spread * 0.42, 7, spread * 0.6, -0.15, 0, Math.PI * 2);
          ctx.ellipse(-6, spread * 0.42, 7, spread * 0.6, 0.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1F3038';
          ctx.beginPath();
          ctx.ellipse(0, 0, 8, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    } else if (this.currentScene === 'gingham') {
      const glow = ctx.createLinearGradient(0, 0, w, h);
      glow.addColorStop(0, 'rgba(242, 181, 68, 0.18)');
      glow.addColorStop(0.55, 'rgba(255, 210, 145, 0.08)');
      glow.addColorStop(1, 'rgba(230, 57, 70, 0.14)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const band = Math.max(18, Math.round(Math.min(w, h) * 0.042));
      const cell = Math.max(12, Math.round(band * 0.65));
      ctx.save();
      for (const yBase of [0, h - band]) {
        ctx.fillStyle = 'rgba(255, 248, 238, 0.52)';
        ctx.fillRect(0, yBase, w, band);
        for (let x = 0; x < w; x += cell) {
          const colEven = Math.floor(x / cell) % 2 === 0;
          if (colEven) {
            ctx.fillStyle = 'rgba(224, 72, 82, 0.34)';
            ctx.fillRect(x, yBase, cell, band);
          }
          ctx.fillStyle = 'rgba(224, 72, 82, 0.30)';
          ctx.fillRect(x, yBase, cell, Math.round(band * 0.5));
        }
      }
      ctx.restore();

      for (const s of this.seeds) {
        s.phase += dt * 2.2;
        s.x = (s.x + s.vx * 0.7 * dt + w) % w;
        s.y = (s.y + s.vy * 0.6 * dt + h) % h;
        const alpha = 0.35 + 0.35 * Math.sin(s.phase);
        const r = s.size * 4.5;
        const rad = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, r);
        rad.addColorStop(0, `rgba(255, 230, 150, ${alpha})`);
        rad.addColorStop(1, 'rgba(242, 181, 68, 0)');
        ctx.fillStyle = rad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.currentScene === 'shade') {
      ctx.save();
      const beamGrad = ctx.createLinearGradient(0, 0, w * 0.7, h);
      beamGrad.addColorStop(0, 'rgba(215, 245, 175, 0.18)');
      beamGrad.addColorStop(0.6, 'rgba(127, 200, 194, 0.06)');
      beamGrad.addColorStop(1, 'rgba(31, 48, 56, 0.12)');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(0, 0, w, h);

      for (const lf of this.dappledLeaves) {
        lf.phase += dt * 1.3;
        const lx = (lf.x + Math.sin(lf.phase) * 18 + w) % w;
        const ly = (lf.y + Math.cos(lf.phase * 0.8) * 10 + h) % h;
        const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, lf.r);
        g.addColorStop(0, 'rgba(235, 252, 195, 0.22)');
        g.addColorStop(1, 'rgba(235, 252, 195, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly, lf.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(244, 248, 249, 0.72)';
      for (const s of this.seeds) {
        s.x = (s.x + s.vx * 0.8 * dt + w) % w;
        s.y = (s.y + s.vy * 0.8 * dt + h) % h;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
