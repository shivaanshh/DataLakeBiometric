/**
 * LivenessChecker.ts
 *
 * Detects liveness using MediaPipe FaceMesh 478-landmark output.
 * Implements Eye Aspect Ratio (EAR), Mouth Aspect Ratio (MAR),
 * and head-yaw estimation for a randomized multi-challenge sequence.
 *
 * Challenge pool: BLINK | SMILE | TURN_LEFT | TURN_RIGHT
 * A random subset is drawn per session to defeat replay attacks.
 */

// ─── MediaPipe FaceMesh landmark indices ───────────────────────────────────
const LEFT_EYE_IDX  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_IDX = [33,  160, 158, 133, 153, 144];
const MOUTH_TOP      = 13;
const MOUTH_BOTTOM   = 14;
const MOUTH_LEFT     = 61;
const MOUTH_RIGHT    = 291;
const NOSE_TIP       = 1;
const LEFT_EAR_LM   = 234;
const RIGHT_EAR_LM  = 454;

// ─── Types ─────────────────────────────────────────────────────────────────
export type Challenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';
export type Landmark  = [number, number, number]; // x, y, z (normalized 0–1)

export interface LivenessResult {
  passed: boolean;
  currentChallenge: Challenge | null;
  completedChallenges: Challenge[];
  metrics: {
    ear: number;
    mar: number;
    yaw: number;
  };
}

// ─── Utility functions ─────────────────────────────────────────────────────
function dist2D(a: Landmark, b: Landmark): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

/**
 * Eye Aspect Ratio — drops below EAR_THRESHOLD during a blink.
 * Formula from Soukupová & Čech (2016).
 */
function computeEAR(lms: Landmark[], indices: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = indices.map(i => lms[i]);
  const A = dist2D(p2, p6);
  const B = dist2D(p3, p5);
  const C = dist2D(p1, p4);
  return (A + B) / (2.0 * C);
}

/**
 * Mouth Aspect Ratio — rises above MAR_THRESHOLD during a smile/open.
 */
function computeMAR(lms: Landmark[]): number {
  const vertical   = dist2D(lms[MOUTH_TOP], lms[MOUTH_BOTTOM]);
  const horizontal = dist2D(lms[MOUTH_LEFT], lms[MOUTH_RIGHT]);
  return vertical / (horizontal + 1e-6);
}

/**
 * Rough head yaw estimate from nose tip vs. ear midpoint.
 * Positive → turned right, Negative → turned left.
 */
function computeYaw(lms: Landmark[]): number {
  const nose   = lms[NOSE_TIP];
  const left   = lms[LEFT_EAR_LM];
  const right  = lms[RIGHT_EAR_LM];
  const midX   = (left[0] + right[0]) / 2;
  const spread = dist2D(left, right) + 1e-6;
  return (nose[0] - midX) / spread;
}

// ─── LivenessChecker class ──────────────────────────────────────────────────
export class LivenessChecker {
  // Detection thresholds (tuned for Indian demographics + outdoor lighting)
  static readonly EAR_BLINK_THRESHOLD = 0.21;
  static readonly MAR_SMILE_THRESHOLD = 0.15;
  static readonly YAW_TURN_THRESHOLD  = 0.12;

  // Require EAR below threshold for N consecutive frames to count as a blink
  static readonly MIN_BLINK_FRAMES = 3;

  private challenges: Challenge[];
  private currentIdx  = 0;
  private earFrames   = 0; // consecutive frames with low EAR
  private completed: Challenge[] = [];

  constructor(numChallenges: number = 2) {
    this.challenges = this.sample(numChallenges);
  }

  /** Random sample without replacement from the challenge pool */
  private sample(n: number): Challenge[] {
    const pool: Challenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(n, pool.length));
  }

  get currentChallenge(): Challenge | null {
    return this.challenges[this.currentIdx] ?? null;
  }

  get isComplete(): boolean {
    return this.currentIdx >= this.challenges.length;
  }

  get completedChallenges(): Challenge[] {
    return [...this.completed];
  }

  /** Reset for a new authentication attempt */
  reset() {
    this.currentIdx = 0;
    this.earFrames  = 0;
    this.completed  = [];
    this.challenges = this.sample(2);
  }

  /**
   * Feed one frame's worth of FaceMesh landmarks.
   * Returns LivenessResult with current status.
   */
  processFrame(landmarks: Landmark[]): LivenessResult {
    const ear = (computeEAR(landmarks, LEFT_EYE_IDX) +
                 computeEAR(landmarks, RIGHT_EYE_IDX)) / 2;
    const mar = computeMAR(landmarks);
    const yaw = computeYaw(landmarks);

    const metrics = { ear, mar, yaw };

    if (!this.isComplete) {
      const challenge = this.currentChallenge!;
      let detected    = false;

      switch (challenge) {
        case 'BLINK':
          if (ear < LivenessChecker.EAR_BLINK_THRESHOLD) {
            this.earFrames++;
          } else {
            if (this.earFrames >= LivenessChecker.MIN_BLINK_FRAMES) detected = true;
            this.earFrames = 0;
          }
          break;

        case 'SMILE':
          detected = mar > LivenessChecker.MAR_SMILE_THRESHOLD;
          break;

        case 'TURN_LEFT':
          detected = yaw < -LivenessChecker.YAW_TURN_THRESHOLD;
          break;

        case 'TURN_RIGHT':
          detected = yaw > LivenessChecker.YAW_TURN_THRESHOLD;
          break;
      }

      if (detected) {
        this.completed.push(challenge);
        this.currentIdx++;
        this.earFrames = 0;
      }
    }

    return {
      passed: this.isComplete,
      currentChallenge: this.currentChallenge,
      completedChallenges: this.completedChallenges,
      metrics,
    };
  }
}
