/**
 * Pure mouth and hand gesture classification, elapsed-time dwell stabilizers,
 * and conflict-free action arbitration.
 */

export const DEFAULT_MOUTH_CONFIG = {
  dwellMs: 400,
  maxActiveMs: 2500,
  rearmNeutralMs: 300,
  postDrawingCooldownMs: 300,
  activateScore: 0.52,
  releaseScore: 0.36
};

export const DEFAULT_HAND_CONFIG = {
  dwellMs: 90,
  releaseMs: 70
};

/**
 * Computes a rounded-mouth ("O" pose) score combining mouth aspect geometry
 * and MediaPipe face blendshapes (mouthPucker, mouthFunnel, jawOpen) when available.
 */
export function evaluateMouthPose(faceLandmarks, blendshapes = null, calibratedBaseline = 1.0) {
  if (!faceLandmarks || faceLandmarks.length < 300) {
    return { score: 0, mouthCenter: null };
  }

  // Upper/lower inner lip (13, 14) and left/right mouth corners (78, 308)
  const upperLip = faceLandmarks[13];
  const lowerLip = faceLandmarks[14];
  const leftCorner = faceLandmarks[78];
  const rightCorner = faceLandmarks[308];

  const mouthWidth = Math.hypot(rightCorner.x - leftCorner.x, rightCorner.y - leftCorner.y);
  const mouthHeight = Math.hypot(lowerLip.x - upperLip.x, lowerLip.y - upperLip.y);

  if (mouthWidth < 1e-4) {
    return { score: 0, mouthCenter: null };
  }

  const aspect = mouthHeight / mouthWidth;
  // An "O" shape has moderate vertical opening (aspect ~0.35 - 0.85) without overly wide smiling corners
  const geometryScore = aspect >= 0.26 && aspect <= 0.95
    ? Math.min(1, (aspect - 0.22) / (0.48 * calibratedBaseline))
    : 0;

  let blendScore = geometryScore;
  if (blendshapes && Array.isArray(blendshapes)) {
    const getCat = (name) => blendshapes.find((b) => b.categoryName === name)?.score || 0;
    const funnel = getCat('mouthFunnel');
    const pucker = getCat('mouthPucker');
    const jawOpen = getCat('jawOpen');
    const smile = (getCat('mouthSmileLeft') + getCat('mouthSmileRight')) * 0.5;
    const roundness = Math.max(funnel, pucker * 0.85, Math.min(jawOpen, 0.7) * 0.75) - smile * 0.6;
    blendScore = Math.max(0, Math.min(1, geometryScore * 0.55 + roundness * 0.65));
  }

  return {
    score: blendScore,
    mouthCenter: {
      x: (upperLip.x + lowerLip.x) * 0.5,
      y: (upperLip.y + lowerLip.y) * 0.5
    }
  };
}

/**
 * Classifies hand pose:
 * - 'point': Index extended, middle/ring/pinky curled -> applies tool
 * - 'fist': All fingers curled -> lifts tool
 * - 'neutral': Open hand or thumbs up -> ignored (does nothing)
 */
export function evaluateHandPose(handLandmarks) {
  if (!handLandmarks || handLandmarks.length < 21) {
    return { pose: 'none', indexTip: null, handScale: 0.1 };
  }

  const wrist = handLandmarks[0];
  const middleMcp = handLandmarks[9];
  const handScale = Math.max(0.04, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const indexExtended = dist(handLandmarks[8], wrist) > dist(handLandmarks[6], wrist) * 1.12;
  const middleExtended = dist(handLandmarks[12], wrist) > dist(handLandmarks[10], wrist) * 1.12;
  const ringExtended = dist(handLandmarks[16], wrist) > dist(handLandmarks[14], wrist) * 1.12;
  const pinkyExtended = dist(handLandmarks[20], wrist) > dist(handLandmarks[18], wrist) * 1.12;

  let pose = 'neutral';
  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    pose = 'point';
  } else if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    pose = 'fist';
  }

  return {
    pose,
    indexTip: { x: handLandmarks[8].x, y: handLandmarks[8].y },
    palmCenter: { x: middleMcp.x, y: middleMcp.y },
    handScale
  };
}

/**
 * Time-based stabilizer and conflict arbitrator between Mouth, Hand, and Pointer.
 */
export class InteractionArbitrator {
  constructor(mouthConfig = DEFAULT_MOUTH_CONFIG, handConfig = DEFAULT_HAND_CONFIG) {
    this.mouthCfg = { ...DEFAULT_MOUTH_CONFIG, ...mouthConfig };
    this.handCfg = { ...DEFAULT_HAND_CONFIG, ...handConfig };
    this.reset();
  }

  reset() {
    this.mouthCandidateStart = null;
    this.mouthActiveStart = null;
    this.mouthNeutralStart = 0;
    this.mouthArmed = true;
    this.mouthActive = false;
    this.lastDrawingEndTime = -9999;

    this.handPointStart = null;
    this.handReleaseStart = null;
    this.handApplying = false;
    this.pointerApplying = false;
  }

  setPointerActive(isActive, nowMs) {
    if (this.pointerApplying && !isActive) {
      this.lastDrawingEndTime = nowMs;
    }
    this.pointerApplying = isActive;
    if (isActive) {
      this.stopMouth(nowMs, false);
      this.handApplying = false;
    }
  }

  stopMouth(nowMs, isNeutral = false) {
    this.mouthActive = false;
    this.mouthCandidateStart = null;
    this.mouthActiveStart = null;
    if (!isNeutral) {
      this.mouthArmed = false;
      this.mouthNeutralStart = null;
    }
  }

  update({ mouthScore, handPose, nowMs }) {
    // 1. Evaluate Hand State (only if pointer is not actively dragging)
    if (this.pointerApplying) {
      this.handApplying = false;
      this.handPointStart = null;
    } else if (handPose === 'point') {
      this.handReleaseStart = null;
      if (!this.handApplying) {
        if (this.handPointStart === null) this.handPointStart = nowMs;
        if (nowMs - this.handPointStart >= this.handCfg.dwellMs) {
          this.handApplying = true;
        }
      }
    } else {
      this.handPointStart = null;
      if (this.handApplying) {
        if (this.handReleaseStart === null) this.handReleaseStart = nowMs;
        if (nowMs - this.handReleaseStart >= this.handCfg.releaseMs || handPose === 'none' || handPose === 'fist') {
          this.handApplying = false;
          this.lastDrawingEndTime = nowMs;
        }
      }
    }

    const isDrawingActive = this.pointerApplying || this.handApplying;
    if (isDrawingActive) {
      this.lastDrawingEndTime = nowMs;
    }

    // 2. Evaluate Mouth State (paused during drawing + 300ms post-drawing cooldown)
    const inDrawingCooldown = isDrawingActive || (nowMs - this.lastDrawingEndTime < this.mouthCfg.postDrawingCooldownMs);

    if (inDrawingCooldown) {
      this.stopMouth(nowMs, false);
      return {
        mouthActive: false,
        mouthProgress: 0,
        handApplying: this.handApplying,
        isDrawingActive
      };
    }

    // Check neutral rearming if disarmed
    if (!this.mouthArmed) {
      if (mouthScore < this.mouthCfg.releaseScore) {
        if (this.mouthNeutralStart === null) this.mouthNeutralStart = nowMs;
        if (nowMs - this.mouthNeutralStart >= this.mouthCfg.rearmNeutralMs) {
          this.mouthArmed = true;
        }
      } else {
        this.mouthNeutralStart = null;
      }
    }

    let mouthProgress = 0;
    if (this.mouthActive) {
      if (mouthScore < this.mouthCfg.releaseScore) {
        // Released mouth pose
        this.stopMouth(nowMs, true);
        this.mouthArmed = false;
        this.mouthNeutralStart = nowMs;
      } else if (nowMs - this.mouthActiveStart >= this.mouthCfg.maxActiveMs) {
        // Reached 2.5s cap; require neutral mouth before rearming
        this.stopMouth(nowMs, false);
      } else {
        mouthProgress = 1;
      }
    } else if (this.mouthArmed && mouthScore >= this.mouthCfg.activateScore) {
      if (this.mouthCandidateStart === null) {
        this.mouthCandidateStart = nowMs;
      }
      const elapsed = nowMs - this.mouthCandidateStart;
      mouthProgress = Math.min(1, elapsed / this.mouthCfg.dwellMs);
      if (elapsed >= this.mouthCfg.dwellMs) {
        this.mouthActive = true;
        this.mouthActiveStart = nowMs;
        mouthProgress = 1;
      }
    } else {
      this.mouthCandidateStart = null;
    }

    return {
      mouthActive: this.mouthActive,
      mouthProgress,
      handApplying: this.handApplying,
      isDrawingActive
    };
  }
}
