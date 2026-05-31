export type Challenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

const HOLD = 6;
const TOTAL_CHALLENGES = 2;

const EAR_THRESH = 0.20;
const MAR_THRESH = 0.45;
const YAW_THRESH = 0.08;

const ALL_CHALLENGES: Challenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];

function pickChallenges(): Challenge[] {
  const shuffled = [...ALL_CHALLENGES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, TOTAL_CHALLENGES);
}

function ear(landmarks: Landmark[], p1: number, p2: number, p3: number, p4: number, p5: number, p6: number): number {
  const A = dist(landmarks[p2], landmarks[p6]);
  const B = dist(landmarks[p3], landmarks[p5]);
  const C = dist(landmarks[p1], landmarks[p4]);
  if (C === 0) return 0;
  return (A + B) / (2 * C);
}

function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getEAR(landmarks: Landmark[]): number {
  const left = ear(landmarks, 362, 385, 387, 263, 373, 380);
  const right = ear(landmarks, 33, 160, 158, 133, 153, 144);
  return (left + right) / 2;
}

function getMAR(landmarks: Landmark[]): number {
  const A = dist(landmarks[13], landmarks[14]);
  const B = dist(landmarks[78], landmarks[308]);
  if (B === 0) return 0;
  return A / B;
}

function getYaw(landmarks: Landmark[]): number {
  const noseTip = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const faceWidth = dist(leftCheek, rightCheek);
  if (faceWidth === 0) return 0;
  const noseMidX = (leftCheek.x + rightCheek.x) / 2;
  return (noseTip.x - noseMidX) / faceWidth;
}

export class LivenessChecker {
  private challenges: Challenge[];
  private currentIdx = 0;
  private holdCount = 0;
  private completed = false;

  constructor() {
    this.challenges = pickChallenges();
  }

  get currentChallenge(): Challenge | null {
    if (this.completed) return null;
    return this.challenges[this.currentIdx] ?? null;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  get progress(): { done: number; total: number } {
    return { done: this.currentIdx, total: TOTAL_CHALLENGES };
  }

  reset(): void {
    this.challenges = pickChallenges();
    this.currentIdx = 0;
    this.holdCount = 0;
    this.completed = false;
  }

  processFrame(landmarks: Landmark[]): boolean {
    if (this.completed) return true;
    if (landmarks.length < 468) return false;

    const challenge = this.challenges[this.currentIdx];
    const passed = this.checkChallenge(challenge, landmarks);

    if (passed) {
      this.holdCount++;
      if (this.holdCount >= HOLD) {
        this.holdCount = 0;
        this.currentIdx++;
        if (this.currentIdx >= TOTAL_CHALLENGES) {
          this.completed = true;
          return true;
        }
      }
    } else {
      this.holdCount = 0;
    }
    return false;
  }

  private checkChallenge(challenge: Challenge, landmarks: Landmark[]): boolean {
    switch (challenge) {
      case 'BLINK':
        return getEAR(landmarks) < EAR_THRESH;
      case 'SMILE':
        return getMAR(landmarks) > MAR_THRESH;
      case 'TURN_LEFT':
        return getYaw(landmarks) < -YAW_THRESH;
      case 'TURN_RIGHT':
        return getYaw(landmarks) > YAW_THRESH;
    }
  }
}
