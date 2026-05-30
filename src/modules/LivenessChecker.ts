// MediaPipe FaceMesh landmark indices used for liveness detection
const IDX = {
  L_EYE_TOP: 159, L_EYE_BOT: 145, L_EYE_L: 33,  L_EYE_R: 133,
  R_EYE_TOP: 386, R_EYE_BOT: 374, R_EYE_L: 362, R_EYE_R: 263,
  MOUTH_TOP: 13,  MOUTH_BOT: 14,  MOUTH_L: 61,  MOUTH_R: 291,
  NOSE:      1,   CHEEK_L:   234, CHEEK_R: 454,
} as const;

export type Landmark  = [number, number, number];
export type Challenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface LivenessResult {
  passed:    boolean;
  challenge: Challenge | null;
  progress:  number; // 0–1 toward passing current challenge
}

const SEQUENCE: Challenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];
const HOLD     = 6; // consecutive frames needed to pass a challenge

export class LivenessChecker {
  private step  = 0;
  private count = 0;

  constructor(private readonly total = 2) {}

  reset() { this.step = 0; this.count = 0; }

  get challenge(): Challenge | null {
    return this.step >= this.total ? null : SEQUENCE[this.step % SEQUENCE.length];
  }

  processFrame(landmarks: Landmark[]): LivenessResult {
    // Already passed all challenges
    if (this.step >= this.total) return { passed: true, challenge: null, progress: 1 };

    // No landmarks — FaceMesh not available
    if (landmarks.length < 468) return { passed: false, challenge: this.challenge, progress: 0 };

    const ch  = SEQUENCE[this.step % SEQUENCE.length];
    const met = this.evaluate(landmarks, ch);

    if (met) {
      this.count++;
      if (this.count >= HOLD) { this.step++; this.count = 0; }
    } else {
      this.count = Math.max(0, this.count - 1);
    }

    const passed = this.step >= this.total;
    return {
      passed,
      challenge: passed ? null : SEQUENCE[this.step % SEQUENCE.length],
      progress:  Math.min(1, this.count / HOLD),
    };
  }

  private evaluate(lm: Landmark[], ch: Challenge): boolean {
    switch (ch) {
      case 'BLINK':      return this.ear(lm) < 0.22;
      case 'SMILE':      return this.mar(lm) > 0.40;
      case 'TURN_LEFT':  return this.yaw(lm) >  0.12;
      case 'TURN_RIGHT': return this.yaw(lm) < -0.12;
    }
  }

  // Eye Aspect Ratio — measures how open the eye is
  private ear(lm: Landmark[]): number {
    const l = d(lm[IDX.L_EYE_TOP], lm[IDX.L_EYE_BOT]) / (d(lm[IDX.L_EYE_L], lm[IDX.L_EYE_R]) + 1e-6);
    const r = d(lm[IDX.R_EYE_TOP], lm[IDX.R_EYE_BOT]) / (d(lm[IDX.R_EYE_L], lm[IDX.R_EYE_R]) + 1e-6);
    return (l + r) / 2;
  }

  // Mouth Aspect Ratio — measures how open the mouth is
  private mar(lm: Landmark[]): number {
    return d(lm[IDX.MOUTH_TOP], lm[IDX.MOUTH_BOT]) / (d(lm[IDX.MOUTH_L], lm[IDX.MOUTH_R]) + 1e-6);
  }

  // Yaw angle — positive = left turn, negative = right turn
  private yaw(lm: Landmark[]): number {
    const width = lm[IDX.CHEEK_R][0] - lm[IDX.CHEEK_L][0] + 1e-6;
    const mid   = (lm[IDX.CHEEK_L][0] + lm[IDX.CHEEK_R][0]) / 2;
    return (lm[IDX.NOSE][0] - mid) / width;
  }
}

function d(a: Landmark, b: Landmark): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}
