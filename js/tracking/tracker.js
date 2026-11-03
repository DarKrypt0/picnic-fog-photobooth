/**
 * On-device MediaPipe Face Landmarker and Hand Landmarker adapter.
 * Pins library and model versions, tries GPU then CPU fallback,
 * and allows either tracker to fail independently.
 */

const MEDIAPIPE_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MEDIAPIPE_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class VisionTracker {
  constructor() {
    this.faceLandmarker = null;
    this.handLandmarker = null;
    this.isReady = false;
    this.inFlight = false;
    this.lastVideoTime = -1;
    this.lastPalm = null;
    this.lastPalmTime = 0;
  }

  async init() {
    try {
      const visionModule = await import(MEDIAPIPE_VISION_CDN);
      const { FilesetResolver, FaceLandmarker, HandLandmarker } = visionModule;
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

      this.faceLandmarker = await this.createWithFallback(FaceLandmarker, vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true
      });

      this.handLandmarker = await this.createWithFallback(HandLandmarker, vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL },
        runningMode: 'VIDEO',
        numHands: 1
      });

      this.isReady = Boolean(this.faceLandmarker || this.handLandmarker);
      return {
        ready: this.isReady,
        faceReady: Boolean(this.faceLandmarker),
        handReady: Boolean(this.handLandmarker)
      };
    } catch (err) {
      console.warn('MediaPipe initialization unavailable; continuing with pointer controls.', err);
      this.isReady = false;
      return { ready: false, faceReady: false, handReady: false, error: err };
    }
  }

  async createWithFallback(TaskClass, vision, options) {
    try {
      return await TaskClass.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' }
      });
    } catch {
      try {
        return await TaskClass.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' }
        });
      } catch (cpuErr) {
        console.warn(`Failed to load ${TaskClass.name}:`, cpuErr);
        return null;
      }
    }
  }

  detect(videoEl, timestampMs) {
    if (!this.isReady || this.inFlight || !videoEl || videoEl.readyState < 2) {
      return null;
    }
    if (videoEl.currentTime === this.lastVideoTime) {
      return null;
    }

    this.inFlight = true;
    this.lastVideoTime = videoEl.currentTime;

    let faceLandmarks = null;
    let blendshapes = null;
    let handLandmarks = null;
    let handReacquired = false;

    try {
      if (this.faceLandmarker) {
        const faceResult = this.faceLandmarker.detectForVideo(videoEl, timestampMs);
        if (faceResult?.faceLandmarks?.length > 0) {
          faceLandmarks = faceResult.faceLandmarks[0];
          blendshapes = faceResult.faceBlendshapes?.[0]?.categories || null;
        }
      }

      if (this.handLandmarker) {
        const handResult = this.handLandmarker.detectForVideo(videoEl, timestampMs);
        if (handResult?.landmarks?.length > 0) {
          const candidate = handResult.landmarks[0];
          const palm = candidate[9];
          if (
            this.lastPalm &&
            timestampMs - this.lastPalmTime < 400 &&
            Math.hypot(palm.x - this.lastPalm.x, palm.y - this.lastPalm.y) < 0.28
          ) {
            handReacquired = false;
          } else {
            handReacquired = true;
          }
          this.lastPalm = { x: palm.x, y: palm.y };
          this.lastPalmTime = timestampMs;
          handLandmarks = candidate;
        } else {
          this.lastPalm = null;
        }
      }
    } catch (err) {
      console.warn('Detection frame skipped:', err);
    } finally {
      this.inFlight = false;
    }

    return { faceLandmarks, blendshapes, handLandmarks, handReacquired };
  }
}
