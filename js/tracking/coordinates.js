/**
 * Coordinate mapping and normalization for mirrored cover video & stage.
 * Ensures coordinates are never mirrored twice.
 */

export function computeCoverTransform(videoWidth, videoHeight, stageWidth, stageHeight) {
  if (!videoWidth || !videoHeight || !stageWidth || !stageHeight) {
    return { scale: 1, offsetX: 0, offsetY: 0, croppedWidth: stageWidth, croppedHeight: stageHeight };
  }
  const videoAspect = videoWidth / videoHeight;
  const stageAspect = stageWidth / stageHeight;

  let scale, offsetX = 0, offsetY = 0;
  if (stageAspect > videoAspect) {
    scale = stageWidth / videoWidth;
    const scaledHeight = videoHeight * scale;
    offsetY = (stageHeight - scaledHeight) * 0.5;
  } else {
    scale = stageHeight / videoHeight;
    const scaledWidth = videoWidth * scale;
    offsetX = (stageWidth - scaledWidth) * 0.5;
  }

  return { scale, offsetX, offsetY };
}

/**
 * Maps normalized MediaPipe landmark [0..1] into mirrored stage pixel coordinates,
 * accounting for object-fit: cover cropping.
 */
export function mapNormalizedToStage(normX, normY, videoWidth, videoHeight, stageWidth, stageHeight, mirror = true) {
  const { scale, offsetX, offsetY } = computeCoverTransform(videoWidth, videoHeight, stageWidth, stageHeight);
  const effectiveNormX = mirror ? (1 - normX) : normX;
  const x = effectiveNormX * videoWidth * scale + offsetX;
  const y = normY * videoHeight * scale + offsetY;
  return {
    x: Math.max(0, Math.min(stageWidth, x)),
    y: Math.max(0, Math.min(stageHeight, y))
  };
}

/**
 * Exponential moving average landmark smoother that resets on tracking gaps.
 */
export class PointSmoother {
  constructor(alpha = 0.45, maxGapMs = 250) {
    this.alpha = alpha;
    this.maxGapMs = maxGapMs;
    this.lastX = null;
    this.lastY = null;
    this.lastTimestamp = 0;
  }

  update(x, y, timestampMs) {
    if (
      this.lastX === null ||
      timestampMs - this.lastTimestamp > this.maxGapMs ||
      Math.hypot(x - this.lastX, y - this.lastY) > 260
    ) {
      this.lastX = x;
      this.lastY = y;
    } else {
      this.lastX = this.lastX + this.alpha * (x - this.lastX);
      this.lastY = this.lastY + this.alpha * (y - this.lastY);
    }
    this.lastTimestamp = timestampMs;
    return { x: this.lastX, y: this.lastY };
  }

  reset() {
    this.lastX = null;
    this.lastY = null;
    this.lastTimestamp = 0;
  }
}
