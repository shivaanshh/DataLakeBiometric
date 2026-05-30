// MediaPipe FaceMesh landmark indices
const L_EYE_TOP    = 159;
const L_EYE_BOT    = 145;
const R_EYE_TOP    = 386;
const R_EYE_BOT    = 374;
const L_EYE_L      = 33;
const L_EYE_R      = 133;
const R_EYE_L      = 362;
const R_EYE_R      = 263;
const MOUTH_TOP    = 13;
const MOUTH_BOT    = 14;
const MOUTH_L      = 61;
const MOUTH_R      = 291;
const NOSE_TIP     = 1;
const CHEEK_L      = 234;
const CHEEK_R      = 454;

export type Landmark = [number, number, number];
export type Challenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface LivenessResult {
  passed:           boolean;
  currentChallenge: Challenge | null;
  progress:         number; // 0–1 toward completing current challenge
}

const CHALLENGES: Challenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];
const HOLD_FRAMES = 6; // consecutive frames meeting threshold to pass a challenge

export class LivenessChecker {
  private challengeIdx = 0;
  private holdCount    = 0;

  constructor(private readonly total = 2) {}

  reset() { this.challengeIdx = 0; this.holdCount = 0; }

  get currentChallenge(): Challenge | null {
    return this.challengeIdx >= this.total
      ? null
      : CHALLENGES[this.challengeIdx % CHALLENGES.length];
  }

  /**
   * processFrame with real landmarks (468 FaceMesh points).
   * Returns passed=true immediately if no landmarks (FaceMesh unavailable).
   */
  processFrame(landmarks: Landmark[]): LivenessResult {
    if (this.challengeIdx >= this.total) {
      return { passed: true, currentChallenge: null, progress: 1 };
    }

    // FaceMesh unavailable — skip liveness (fail safe for demo)
    if (landmarks.length < 468) {
      return { passed: false, currentChallenge: this.currentChallenge, progress: 0 };
    }

    const ch  = CHALLENGES[this.challengeIdx % CHALLENGES.length];
    const met = this.check(landmarks, ch);

    if (met) {
      this.holdCount++;
      if (this.holdCount >= HOLD_FRAMES) {
        this.challengeIdx++;
        this.holdCount = 0;
      }
    } else {
      this.holdCount = Math.max(0, this.holdCount - 1);
    }

    const passed = this.challengeIdx >= this.total;
    return {
      passed,
      currentChallenge: passed ? null : CHALLENGES[this.challengeIdx % CHALLENGES.length],
      progress: Math.min(1, this.holdCount / HOLD_FRAMES),
    };
  }

  private check(lm: Landmark[], ch: Challenge): boolean {
    switch (ch) {
      case 'BLINK':      return this.ear(lm) < 0.20;
      case 'SMILE':      return this.mar(lm) > 0.40;
      case 'TURN_LEFT':  return this.yaw(lm) >  0.12;
      case 'TURN_RIGHT': return this.yaw(lm) < -0.12;
    }
  }

  private ear(lm: Landmark[]): number {
    const l = dist(lm[L_EYE_TOP], lm[L_EYE_BOT]) / (dist(lm[L_EYE_L], lm[L_EYE_R]) + 1e-6);
    const r = dist(lm[R_EYE_TOP], lm[R_EYE_BOT]) / (dist(lm[R_EYE_L], lm[R_EYE_R]) + 1e-6);
    return (l + r) / 2;
  }

  private mar(lm: Landmark[]): number {
    return dist(lm[MOUTH_TOP], lm[MOUTH_BOT]) / (dist(lm[MOUTH_L], lm[MOUTH_R]) + 1e-6);
  }

  private yaw(lm: Landmark[]): number {
    const faceW = lm[CHEEK_R][0] - lm[CHEEK_L][0] + 1e-6;
    return (lm[NOSE_TIP][0] - (lm[CHEEK_L][0] + lm[CHEEK_R][0]) / 2) / faceW;
  }
}

function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2);
}
