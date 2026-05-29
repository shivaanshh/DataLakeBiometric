const LEFT_EYE_TOP     = 159;
const LEFT_EYE_BOTTOM  = 145;
const RIGHT_EYE_TOP    = 386;
const RIGHT_EYE_BOTTOM = 374;
const MOUTH_LEFT       = 61;
const MOUTH_RIGHT      = 291;
const MOUTH_TOP        = 13;
const MOUTH_BOTTOM     = 14;
const NOSE_TIP         = 1;
const LEFT_CHEEK       = 234;
const RIGHT_CHEEK      = 454;

export type Landmark = [number, number, number];
export type Challenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

const CHALLENGES: Challenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];
const HOLD_FRAMES = 8;

export interface LivenessResult {
  passed:           boolean;
  currentChallenge: Challenge | null;
  progress:         number;
}

export class LivenessChecker {
  private idx    = 0;
  private frames = 0;

  constructor(private readonly total = 2) {}

  reset() { this.idx = 0; this.frames = 0; }

  get currentChallenge(): Challenge | null {
    return this.idx >= this.total ? null : CHALLENGES[this.idx % CHALLENGES.length];
  }

  processFrame(landmarks: Landmark[]): LivenessResult {
    if (this.idx >= this.total) return { passed: true, currentChallenge: null, progress: 1 };
    if (landmarks.length < 468) return { passed: false, currentChallenge: this.currentChallenge, progress: 0 };

    const ch  = CHALLENGES[this.idx % CHALLENGES.length];
    const met = this.check(landmarks, ch);

    if (met) {
      this.frames++;
      if (this.frames >= HOLD_FRAMES) { this.idx++; this.frames = 0; }
    } else {
      this.frames = Math.max(0, this.frames - 1);
    }

    const passed = this.idx >= this.total;
    return {
      passed,
      currentChallenge: passed ? null : CHALLENGES[this.idx % CHALLENGES.length],
      progress: Math.min(1, this.frames / HOLD_FRAMES),
    };
  }

  private check(lm: Landmark[], ch: Challenge): boolean {
    switch (ch) {
      case 'BLINK':      return this.ear(lm) < 0.20;
      case 'SMILE':      return this.mar(lm) > 0.45;
      case 'TURN_LEFT':  return this.yaw(lm) > 0.15;
      case 'TURN_RIGHT': return this.yaw(lm) < -0.15;
    }
  }

  private ear(lm: Landmark[]): number {
    const l = d(lm[LEFT_EYE_TOP],  lm[LEFT_EYE_BOTTOM])  / (d(lm[33],  lm[133]) + 1e-6);
    const r = d(lm[RIGHT_EYE_TOP], lm[RIGHT_EYE_BOTTOM]) / (d(lm[362], lm[263]) + 1e-6);
    return (l + r) / 2;
  }

  private mar(lm: Landmark[]): number {
    return d(lm[MOUTH_TOP], lm[MOUTH_BOTTOM]) / (d(lm[MOUTH_LEFT], lm[MOUTH_RIGHT]) + 1e-6);
  }

  private yaw(lm: Landmark[]): number {
    const faceW = lm[RIGHT_CHEEK][0] - lm[LEFT_CHEEK][0] + 1e-6;
    return (lm[NOSE_TIP][0] - (lm[LEFT_CHEEK][0] + lm[RIGHT_CHEEK][0]) / 2) / faceW;
  }
}

function d(a: Landmark, b: Landmark): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2);
}
