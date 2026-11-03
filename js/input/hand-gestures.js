/**
 * Hand gesture classification + smoothing for the fog glass.
 *
 * Accuracy notes:
 * - Rejects knuckles / bent fingers: for "point", the index chain (MCP 5 → PIP 6 → DIP 7 → TIP 8)
 *   must be collinear (cos > 0.70 at the PIP knuckle), strictly increasing in distance from the
 *   wrist (d(8) > d(7) > d(6) and d(8) > d(6) * 1.12), span >= 65% of palm length from MCP 5 to TIP 8,
 *   and reach past the middle/ring/pinky PIP knuckles (10, 14, 18).
 * - "Palm" accepts both a splayed hand and a flat "window-wiper" open hand (4 fingers extended,
 *   palm facing camera within ~65°), so wiping sideways doesn't cut out.
 * - GestureGate bridges short misclassifications (grace period) so strokes don't break mid-word.
 * - OneEuroPointFilter: low lag when moving fast, strong jitter suppression when moving slowly.
 * No fist action; ambiguous poses stay neutral.
 */

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const sub2D = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: 0 });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => len(sub(a, b));
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cosBetween = (u, v) => {
  const d = len(u) * len(v);
  return d < 1e-9 ? 0 : (u.x * v.x + u.y * v.y + u.z * v.z) / d;
};
const valid = (pts) => pts && pts.length >= 21 && !pts.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y));

/** Per-finger straightness and outward wrist progression (reliable center-screen pointing while rejecting knuckles). */
function fingerMetrics(pts, tip, palmLen2D) {
  const mcp = tip - 3, pip = tip - 2, dip = tip - 1;
  const wrist = pts[0];

  const dMcp2D = dist2D(pts[mcp], wrist);
  const dPip2D = dist2D(pts[pip], wrist);
  const dDip2D = dist2D(pts[dip], wrist);
  const dTip2D = dist2D(pts[tip], wrist);
  const dMcpPip2D = dist2D(pts[pip], pts[mcp]);
  const dMcpDip2D = dist2D(pts[dip], pts[mcp]);
  const dMcpTip2D = dist2D(pts[tip], pts[mcp]);

  const wristCos2D = cosBetween(sub2D(pts[pip], wrist), sub2D(pts[tip], pts[pip]));
  const pipCos2D = cosBetween(sub2D(pts[pip], pts[mcp]), sub2D(pts[tip], pts[pip]));
  const tipToPip2D = dMcpTip2D / Math.max(1e-5, dMcpPip2D);
  const span2D = dMcpTip2D / Math.max(1e-5, palmLen2D);

  // Pointing index finger: permissive enough for natural pointing angles in the center zone,
  // while requiring TIP > DIP > PIP > MCP from the wrist so bent knuckles cannot pass.
  const outwardIndex = dTip2D > dDip2D * 0.98 && dTip2D > dPip2D * 1.03 && dTip2D > dMcp2D * 1.08;
  const straightIndex = dMcpTip2D > dMcpDip2D * 0.98 && tipToPip2D > 1.40 && pipCos2D > 0.46;
  const extendedIndex = outwardIndex && wristCos2D > 0.05 && straightIndex && span2D > 0.28;

  // Other fingers (middle/ring/pinky): only count as "extendedOther" when genuinely straight & held out,
  // so a loosely half-curled middle finger never blocks the pointing index finger in the center of the screen.
  const outwardOther = dTip2D > dDip2D && dTip2D > dPip2D * 1.07 && dTip2D > dMcp2D * 1.15;
  const extendedOther = outwardOther && wristCos2D > 0.30 && dMcpTip2D > dMcpDip2D && tipToPip2D > 1.60 && pipCos2D > 0.58 && span2D > 0.42;

  return {
    dTip2D,
    dMcpTip: span2D,
    extendedIndex,
    extendedOther
  };
}

export function evaluateHandPose(points, worldPoints = null) {
  const empty = { pose: 'none', indexTip: null, palmCenter: null, beakCenter: null, handScale: .1, palmWidth: .08 };
  if (!valid(points)) return empty;
  const wrist = points[0], middle = points[9], width = dist(points[5], points[17]);
  const length = dist(wrist, middle);
  const palmLen2D = Math.max(dist2D(wrist, middle), dist2D(points[5], points[17]) * 0.85);
  if (width < .015 || length < .02 || palmLen2D < .015) return empty;

  const [idxF, midF, ringF, pinkyF] = [8, 12, 16, 20].map((t) => fingerMetrics(points, t, palmLen2D));

  // Palm centre = centroid of wrist + 4 knuckles (the visual middle of the palm).
  const palmIds = [0, 5, 9, 13, 17];
  const palmCenter = {
    x: palmIds.reduce((s, i) => s + points[i].x, 0) / 5,
    y: palmIds.reduce((s, i) => s + points[i].y, 0) / 5
  };

  // Exact MediaPipe index fingertip landmark so cursor placement matches the visible finger 1:1.
  const indexTip = { x: points[8].x, y: points[8].y };

  const tips = [4, 8, 12, 16, 20].map((i) => points[i]);
  const beakCenter = { x: tips.reduce((s, p) => s + p.x, 0) / 5, y: tips.reduce((s, p) => s + p.y, 0) / 5, z: tips.reduce((s, p) => s + (p.z || 0), 0) / 5 };
  const cluster = Math.max(...tips.map((p) => dist(p, beakCenter)));

  // Palm facing the camera (image-space normal of the wrist/index/pinky plane).
  const a = sub(points[5], wrist), b = sub(points[17], wrist);
  const normal = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const facing = Math.abs(normal.z) / Math.max(.00001, len(normal));
  const openSpan = dist(points[8], points[20]) > width * .56;
  // A fist also clusters fingertips, but its tips fold back toward the wrist.
  const distal = (beakCenter.x - middle.x) * (middle.x - wrist.x) + (beakCenter.y - middle.y) * (middle.y - wrist.y);

  // Because the middle finger is anatomically the longest finger, the ONLY time the index finger's
  // MCP-to-TIP span exceeds all 3 other fingers by >22% is when the user is genuinely pointing their
  // index finger — even if the middle finger is only half-curled due to tendon coupling.
  const maxOtherMcpTip = Math.max(midF.dMcpTip, ringF.dMcpTip, pinkyF.dMcpTip);
  const allFourExtended = idxF.extendedOther && midF.extendedOther && ringF.extendedOther && pinkyF.extendedOther;

  const isPointing = !allFourExtended
    && idxF.extendedIndex
    && idxF.dMcpTip > maxOtherMcpTip * 1.22;

  let pose = 'neutral';
  if (cluster < width * .36 && distal > length * length * .35 && dist(points[4], beakCenter) < width * .4) pose = 'beak';
  else if (allFourExtended && openSpan && facing > .44) pose = 'palm';
  else if (isPointing) pose = 'point';

  // Thumb (4) + Index (8) pinch detection (distinct from 5-finger beak and closed fist)
  const pinchDist = dist2D(points[4], points[8]);
  const dThumbMid = dist2D(points[4], points[12]);
  const dThumbRing = dist2D(points[4], points[16]);
  const dThumbPinky = dist2D(points[4], points[20]);
  const isPinch = pose !== 'beak' && pose !== 'palm'
    && pinchDist < Math.max(palmLen2D * 0.36, width * 0.42)
    && pinchDist <= dThumbMid * 1.25
    && pinchDist < dThumbRing * 0.82
    && pinchDist < dThumbPinky * 0.75;

  return { pose, isPinch, pinchDist, indexTip, palmCenter, beakCenter, handScale: length, palmWidth: width };
}

const DWELL = { point: 40, palm: 120, beak: 250 };
// How long an active pose survives brief "neutral"/lost frames before releasing.
const GRACE = { point: 280, palm: 220, beak: 120 };

/**
 * Dwell prevents one-frame erases; grace bridges one-frame dropouts so strokes stay continuous.
 * Switching straight to a different gesture releases the old one immediately.
 */
export class GestureGate {
  constructor() { this.reset(); }
  reset() { this.candidate = 'none'; this.since = 0; this.active = 'none'; this.lastActiveSeen = 0; this.fed = false; this.releaseSince = null; }
  update(raw, now) {
    if (raw !== this.candidate) { this.candidate = raw; this.since = now; }
    if (raw !== 'beak') {
      if (this.releaseSince === null) this.releaseSince = now;
      if (now - this.releaseSince >= 300) this.fed = false;
    } else this.releaseSince = null;

    const actionable = raw in DWELL;
    if (raw === this.active) {
      this.lastActiveSeen = now;
    } else if (actionable && now - this.since >= DWELL[raw]) {
      this.active = raw; this.lastActiveSeen = now;
    } else if (this.active !== 'none') {
      const otherGesture = actionable; // a different, deliberate gesture -> release now
      if (otherGesture || now - this.lastActiveSeen > GRACE[this.active]) this.active = 'none';
    }

    const pose = this.active;
    const feed = pose === 'beak' && !this.fed;
    if (feed) this.fed = true;
    return { pose, feed };
  }
}

/**
 * One Euro filter for a 2D point (Casiez et al. 2012).
 * update(x, y, timestampMs, scale): speed is measured in `scale` units per second
 * (pass the stage width so tuning is resolution-independent).
 */
export class OneEuroPointFilter {
  constructor({ minCutoff = 1.4, beta = 6, dCutoff = 1.0, maxGapMs = 250 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.maxGapMs = maxGapMs;
    this.reset();
  }
  configure(opts = {}) { Object.assign(this, opts); }
  reset() { this.x = null; this.y = null; this.dx = 0; this.dy = 0; this.t = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  update(x, y, t, scale = 1) {
    if (this.x === null || t - this.t > this.maxGapMs) {
      this.x = x; this.y = y; this.dx = 0; this.dy = 0; this.t = t;
      return { x, y };
    }
    const dt = (t - this.t) / 1000;
    if (dt <= 0) return { x: this.x, y: this.y };
    this.t = t;
    const s = scale || 1;
    const ad = OneEuroPointFilter.alpha(this.dCutoff, dt);
    this.dx += ad * ((x - this.x) / s / dt - this.dx);
    this.dy += ad * ((y - this.y) / s / dt - this.dy);
    const a = OneEuroPointFilter.alpha(this.minCutoff + this.beta * Math.hypot(this.dx, this.dy), dt);
    this.x += a * (x - this.x);
    this.y += a * (y - this.y);
    return { x: this.x, y: this.y };
  }
}
