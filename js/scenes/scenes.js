/**
 * Picnic scenes rendered behind the glass pane:
 * - 'meadow': Sunny Picnic Meadow (Golden sunlight + floating dandelion seeds)
 * - 'aquarium': Butterfly & Koi Pond (Fish & butterflies steer toward pointer in Play mode with stand-off distance)
 * - 'rain': Sunshower Dew (Sliding summer raindrops)
 * - 'fireflies': Twilight Picnic Fireflies (Gather near pointer in Play mode)
 */

export class SceneManager {
  constructor(width = 1280, height = 720) {
    this.width = width;
    this.height = height;
    this.currentScene = 'meadow';
    this.paused = false;

    this.critters = [];
    this.raindrops = [];
    this.fireflies = [];
    this.seeds = [];

    this.initEntities();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  setScene(sceneId) {
    this.currentScene = sceneId;
  }

  initEntities() {
    // 7 pond koi / picnic butterflies for Aquarium mode
    this.critters = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * 90,
      vy: (Math.random() - 0.5) * 60,
      angle: 0,
      wingPhase: Math.random() * Math.PI * 2,
      isButterfly: i % 2 === 0,
      color: i % 2 === 0 ? '#F2B544' : '#E63946'
    }));

    // 32 sunshower raindrops
    this.raindrops = Array.from({ length: 32 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vy: 140 + Math.random() * 120,
      r: 2.5 + Math.random() * 2.5
    }));

    // 22 twilight fireflies
    this.fireflies = Array.from({ length: 22 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * 45,
      vy: (Math.random() - 0.5) * 45,
      phase: Math.random() * Math.PI * 2
    }));

    // 16 meadow dandelion seeds
    this.seeds = Array.from({ length: 16 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: 18 + Math.random() * 20,
      vy: -10 - Math.random() * 15
    }));
  }

  /**
   * Renders picnic demo background when running without a live webcam.
   */
  renderDemoBackground(ctx) {
    const w = this.width;
    const h = this.height;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (this.currentScene === 'fireflies') {
      grad.addColorStop(0, '#16262E');
      grad.addColorStop(1, '#28433A');
    } else {
      grad.addColorStop(0, '#88D4CD');
      grad.addColorStop(0.65, '#CDEAC0');
      grad.addColorStop(1, '#7FB069');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Warm sunbeam
    ctx.fillStyle = 'rgba(242, 181, 68, 0.22)';
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.18, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // Subtle gingham picnic blanket strip at bottom of meadow
    const blanketTop = h * 0.76;
    ctx.fillStyle = 'rgba(230, 57, 70, 0.24)';
    ctx.fillRect(0, blanketTop, w, h - blanketTop);
    const checkSize = 36;
    ctx.fillStyle = 'rgba(244, 248, 249, 0.22)';
    for (let x = 0; x < w; x += checkSize * 2) {
      ctx.fillRect(x, blanketTop, checkSize, h - blanketTop);
    }
  }

  /**
   * Steps and renders the active behind-the-glass scene.
   * In Play mode, critters and fireflies smoothly steer toward targetPoint with a stand-off distance.
   */
  renderScene(ctx, dtSec, playTarget = null) {
    const dt = this.paused ? 0 : Math.min(0.1, Math.max(0, dtSec));
    const w = this.width;
    const h = this.height;

    if (this.currentScene === 'meadow') {
      // Warm picnic sunlight vignette
      const sunGrad = ctx.createRadialGradient(w * 0.8, h * 0.15, 10, w * 0.8, h * 0.15, w * 0.65);
      sunGrad.addColorStop(0, 'rgba(242, 181, 68, 0.24)');
      sunGrad.addColorStop(1, 'rgba(242, 181, 68, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(244, 248, 249, 0.75)';
      for (const s of this.seeds) {
        s.x = (s.x + s.vx * dt + w) % w;
        s.y = (s.y + s.vy * dt + h) % h;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.currentScene === 'aquarium') {
      const standOff = 68;
      for (const c of this.critters) {
        if (playTarget && dt > 0) {
          const dx = playTarget.x - c.x;
          const dy = playTarget.y - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist > standOff && dist < 420) {
            const desiredVx = (dx / dist) * 125;
            const desiredVy = (dy / dist) * 125;
            c.vx += (desiredVx - c.vx) * 3.2 * dt;
            c.vy += (desiredVy - c.vy) * 3.2 * dt;
          } else if (dist <= standOff && dist > 1) {
            // Orbit gently outside minimum stand-off distance
            c.vx += (-dy / dist) * 80 * dt;
            c.vy += (dx / dist) * 80 * dt;
          }
        }

        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.wingPhase += dt * 10;

        if (c.x < 30 || c.x > w - 30) c.vx *= -1;
        if (c.y < 30 || c.y > h - 30) c.vy *= -1;
        c.x = Math.max(20, Math.min(w - 20, c.x));
        c.y = Math.max(20, Math.min(h - 20, c.y));
        c.angle = Math.atan2(c.vy, c.vx);

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);

        if (c.isButterfly) {
          const wingSpread = 10 + Math.sin(c.wingPhase) * 6;
          ctx.fillStyle = c.color;
          ctx.beginPath();
          ctx.ellipse(0, -wingSpread * 0.6, 12, wingSpread, 0, 0, Math.PI * 2);
          ctx.ellipse(0, wingSpread * 0.6, 12, wingSpread, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1F3038';
          ctx.fillRect(-10, -2, 20, 4);
        } else {
          // Koi fish
          ctx.fillStyle = c.color;
          ctx.beginPath();
          ctx.ellipse(0, 0, 20, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-16, 0);
          ctx.lineTo(-28, -9 + Math.sin(c.wingPhase) * 3);
          ctx.lineTo(-28, 9 + Math.sin(c.wingPhase) * 3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    } else if (this.currentScene === 'rain') {
      ctx.strokeStyle = 'rgba(244, 248, 249, 0.55)';
      ctx.lineWidth = 2;
      for (const drop of this.raindrops) {
        drop.y += drop.vy * dt;
        if (drop.y > h) {
          drop.y = -10;
          drop.x = Math.random() * w;
        }
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - 2, drop.y + drop.r * 5);
        ctx.stroke();
      }
    } else if (this.currentScene === 'fireflies') {
      for (const f of this.fireflies) {
        if (playTarget && dt > 0) {
          const dx = playTarget.x - f.x;
          const dy = playTarget.y - f.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 45 && dist < 360) {
            f.vx += (dx / dist) * 90 * dt;
            f.vy += (dy / dist) * 90 * dt;
          }
        }
        f.vx = Math.max(-75, Math.min(75, f.vx));
        f.vy = Math.max(-75, Math.min(75, f.vy));
        f.x = (f.x + f.vx * dt + w) % w;
        f.y = (f.y + f.vy * dt + h) % h;
        f.phase += dt * 4;

        const glow = 0.45 + 0.55 * Math.sin(f.phase);
        const rad = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, 18);
        rad.addColorStop(0, `rgba(242, 181, 68, ${glow})`);
        rad.addColorStop(1, 'rgba(242, 181, 68, 0)');
        ctx.fillStyle = rad;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
