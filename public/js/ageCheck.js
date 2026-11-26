// VYRO face age check. Runs entirely on the device: camera frames are never uploaded or saved.
// Only the final estimated age (a number) is sent to the server.
//
// How a scan works:
//   1. Look at the camera   -> several age estimates are taken while you face forward
//   2. Turn your head left and right -> proves it's a real 3D face, not a photo held up to the camera
//   3. Look back at the camera -> a few more estimates
// The result is the middle (median) of all the estimates, which smooths out bad frames.
//
// The age model is an open-source estimator (face-api, MIT licence). The server decides the pass mark
// (VYRO_FACE_MIN_AGE, default 18).

const MODEL_URL = new URL('../vendor/face-api/model/', import.meta.url).href;
const LIB_URL = new URL('../vendor/face-api/face-api.esm.js', import.meta.url).href;

let faceapi = null;
let loading = null;

export function loadAgeModels() {
  if (faceapi) return Promise.resolve(faceapi);
  if (!loading) {
    loading = (async () => {
      const fa = await import(LIB_URL);
      try {
        await fa.tf.setBackend('webgl');
        await fa.tf.ready();
      } catch {
        await fa.tf.setBackend('cpu');
        await fa.tf.ready();
      }
      await Promise.all([
        fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        fa.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        fa.nets.ageGenderNet.loadFromUri(MODEL_URL)
      ]);
      faceapi = fa;
      return fa;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

// Where the nose sits between the outer eye corners: about 0.5 facing forward,
// lower or higher when the head turns. A flat photo tilted toward the camera keeps this
// ratio almost the same, because a photo has no nose sticking out.
export function yawRatio(points) {
  const leftEye = points[36];
  const rightEye = points[45];
  const nose = points[30];
  const span = rightEye.x - leftEye.x;
  if (!(span > 0)) return 0.5;
  return (nose.x - leftEye.x) / span;
}

export async function analyseFrame(video) {
  const fa = await loadAgeModels();
  if (!video || video.readyState < 2 || !video.videoWidth) return { faces: 0 };
  const opts = new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const found = await fa.detectAllFaces(video, opts).withFaceLandmarks(true).withAgeAndGender();
  if (!found.length) return { faces: 0 };
  found.sort((a, b) => b.detection.box.area - a.detection.box.area);
  const main = found[0];
  return {
    faces: found.length,
    age: main.age,
    yaw: yawRatio(main.landmarks.positions),
    size: main.detection.box.width / video.videoWidth,
    score: main.detection.score
  };
}

export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const FRONT_MIN = 0.4;
const FRONT_MAX = 0.6;
const TURN_LOW = 0.34;
const TURN_HIGH = 0.66;

// Pure step logic, kept separate from the camera so it can be tested on its own.
export class ScanTracker {
  constructor() {
    this.firstAges = [];
    this.lastAges = [];
    this.turnedLow = 0;
    this.turnedHigh = 0;
    this.extraFaces = false;
    this.sizes = [];
  }

  get step() {
    if (this.firstAges.length < 8) return 'look';
    if (this.turnedLow < 2 || this.turnedHigh < 2) return 'turn';
    if (this.lastAges.length < 4) return 'lookBack';
    return 'done';
  }

  get progress() {
    const parts = [
      Math.min(this.firstAges.length, 8) / 8,
      (Math.min(this.turnedLow, 2) + Math.min(this.turnedHigh, 2)) / 4,
      Math.min(this.lastAges.length, 4) / 4
    ];
    return (parts[0] + parts[1] + parts[2]) / 3;
  }

  push(frame) {
    if (!frame || !frame.faces) return 'noface';
    if (frame.faces > 1) {
      this.extraFaces = true;
      return 'many';
    }
    // The face must stay roughly the same size the whole time (stops swapping people mid-scan).
    if (this.sizes.length >= 3) {
      const typical = median(this.sizes);
      if (frame.size < typical * 0.55 || frame.size > typical * 1.8) return 'moved';
    }
    this.sizes.push(frame.size);
    if (this.sizes.length > 30) this.sizes.shift();

    const facingFront = frame.yaw >= FRONT_MIN && frame.yaw <= FRONT_MAX;
    const step = this.step;
    if (step === 'look' && facingFront) this.firstAges.push(frame.age);
    else if (step === 'turn') {
      if (frame.yaw <= TURN_LOW) this.turnedLow += 1;
      if (frame.yaw >= TURN_HIGH) this.turnedHigh += 1;
    } else if (step === 'lookBack' && facingFront) this.lastAges.push(frame.age);
    return 'ok';
  }

  result() {
    const ages = [...this.firstAges, ...this.lastAges];
    return {
      estimate: Math.round(median(ages) * 10) / 10,
      samples: ages.length,
      liveness: this.turnedLow >= 2 && this.turnedHigh >= 2
    };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs the full scan on a <video> showing the camera. Calls onUpdate({ step, progress, hint }).
export async function runAgeScan(video, { onUpdate, timeoutMs = 45000, isCancelled } = {}) {
  await loadAgeModels();
  const tracker = new ScanTracker();
  const started = Date.now();
  while (tracker.step !== 'done') {
    if (isCancelled && isCancelled()) throw Object.assign(new Error('Scan cancelled.'), { code: 'cancelled' });
    if (Date.now() - started > timeoutMs) {
      const msg =
        tracker.step === 'turn'
          ? "We didn't see your head turn. When asked, slowly turn your head left and right. (A photo can't pass this step.)"
          : "We couldn't get a clear look at your face. Try again in good, even light, facing the camera.";
      throw Object.assign(new Error(msg), { code: 'timeout', step: tracker.step });
    }
    const frame = await analyseFrame(typeof video === 'function' ? video() : video);
    const outcome = tracker.push(frame);
    const hint =
      outcome === 'noface'
        ? 'We can’t see your face. Move into good light.'
        : outcome === 'many'
          ? 'Only you should be in the frame.'
          : outcome === 'moved'
            ? 'Keep your face at the same distance.'
            : '';
    if (onUpdate) onUpdate({ step: tracker.step, progress: tracker.progress, hint });
    await sleep(120);
  }
  if (onUpdate) onUpdate({ step: 'done', progress: 1, hint: '' });
  return tracker.result();
}

// Quick, silent check used now and then during a live: up to `frames` estimates, median age.
export async function spotCheck(video, frames = 5) {
  const ages = [];
  for (let i = 0; i < frames * 2 && ages.length < frames; i++) {
    const f = await analyseFrame(typeof video === 'function' ? video() : video).catch(() => ({ faces: 0 }));
    if (f.faces === 1 && f.yaw >= FRONT_MIN - 0.05 && f.yaw <= FRONT_MAX + 0.05) ages.push(f.age);
    await sleep(250);
  }
  if (ages.length < 3) return null;
  return { estimate: Math.round(median(ages) * 10) / 10, samples: ages.length };
}
