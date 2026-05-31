import { LivenessChecker, Landmark } from './LivenessChecker';
import { averageEmbeddings, isMatch } from './FaceRecognizer';
import { saveUser, getUser, logAttendance } from '../storage/db';

class SimpleEmitter {
  private handlers: Map<string, ((...args: any[]) => void)[]> = new Map();
  on(event: string, handler: (...args: any[]) => void): this {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
    return this;
  }
  off(event: string, handler: (...args: any[]) => void): this {
    const arr = this.handlers.get(event);
    if (arr) {
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    }
    return this;
  }
  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.forEach(h => h(...args));
  }
}

export type Phase =
  | 'IDLE'
  | 'DETECTING_FACE'
  | 'LIVENESS'
  | 'RECOGNIZING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ENROLLING'
  | 'ENROLLED';

export interface AuthState {
  phase: Phase;
  challenge: string | null;
  progress: { done: number; total: number } | null;
  message: string;
  userName: string | null;
}

export interface ProcessFrameInput {
  userId: string;
  landmarks: Landmark[];
  embedding: Float32Array | null;
}

const PHASE_MESSAGES: Record<Phase, string> = {
  IDLE: 'Position your face in the oval',
  DETECTING_FACE: 'Detecting face...',
  LIVENESS: 'Follow the challenge',
  RECOGNIZING: 'Verifying identity...',
  SUCCESS: 'Access granted',
  FAILED: 'Verification failed',
  ENROLLING: 'Enrolling...',
  ENROLLED: 'Enrolled successfully',
};

const CHALLENGE_LABELS: Record<string, string> = {
  BLINK: 'Blink your eyes',
  SMILE: 'Smile',
  TURN_LEFT: 'Turn head left',
  TURN_RIGHT: 'Turn head right',
};

class BiometricAuthEmitter extends SimpleEmitter {
  private liveness = new LivenessChecker();
  private frameCount = 0;
  private readonly FACE_FRAMES_NEEDED = 5;
  private _matchingInProgress = false;

  private state: AuthState = {
    phase: 'IDLE',
    challenge: null,
    progress: null,
    message: PHASE_MESSAGES.IDLE,
    userName: null,
  };

  getState(): AuthState {
    return { ...this.state };
  }

  reset(): void {
    this.liveness.reset();
    this.frameCount = 0;
    this._matchingInProgress = false;
    this.setState({ phase: 'IDLE', challenge: null, progress: null, message: PHASE_MESSAGES.IDLE, userName: null });
  }

  async enroll(userId: string, userName: string, embeddings: Float32Array[]): Promise<void> {
    this.setState({ phase: 'ENROLLING', challenge: null, progress: null, message: PHASE_MESSAGES.ENROLLING, userName });
    try {
      const avg = averageEmbeddings(embeddings);
      await saveUser(userId, userName, avg);
      this.setState({ phase: 'ENROLLED', challenge: null, progress: null, message: PHASE_MESSAGES.ENROLLED, userName });
    } catch (e) {
      this.setState({ phase: 'FAILED', challenge: null, progress: null, message: 'Enrollment failed', userName: null });
    }
  }

  async processAuthFrame({ userId, landmarks, embedding }: ProcessFrameInput): Promise<void> {
    const phase = this.state.phase;

    if (phase === 'IDLE' || phase === 'DETECTING_FACE') {
      if (!embedding) {
        this.setState({ ...this.state, phase: 'DETECTING_FACE', message: PHASE_MESSAGES.DETECTING_FACE });
        return;
      }
      this.frameCount++;
      if (this.frameCount >= this.FACE_FRAMES_NEEDED) {
        this.frameCount = 0;
        this.liveness.reset();
        const c = this.liveness.currentChallenge;
        this.setState({
          phase: 'LIVENESS',
          challenge: c ? CHALLENGE_LABELS[c] : null,
          progress: this.liveness.progress,
          message: PHASE_MESSAGES.LIVENESS,
          userName: null,
        });
      } else {
        this.setState({ ...this.state, phase: 'DETECTING_FACE', message: PHASE_MESSAGES.DETECTING_FACE });
      }
      return;
    }

    if (phase === 'LIVENESS') {
      const done = this.liveness.processFrame(landmarks);
      const c = this.liveness.currentChallenge;
      if (done) {
        this.setState({
          phase: 'RECOGNIZING',
          challenge: null,
          progress: this.liveness.progress,
          message: PHASE_MESSAGES.RECOGNIZING,
          userName: null,
        });
      } else {
        this.setState({
          ...this.state,
          challenge: c ? CHALLENGE_LABELS[c] : null,
          progress: this.liveness.progress,
        });
      }
      return;
    }

    if (phase === 'RECOGNIZING') {
      if (!embedding || this._matchingInProgress) return;
      this._matchingInProgress = true;
      try {
        const user = await getUser(userId);
        if (!user) {
          this.setState({ phase: 'FAILED', challenge: null, progress: null, message: 'User not enrolled', userName: null });
          return;
        }
        if (isMatch(embedding, user.embedding)) {
          await logAttendance(userId);
          this.setState({ phase: 'SUCCESS', challenge: null, progress: null, message: PHASE_MESSAGES.SUCCESS, userName: user.name });
        } else {
          this.setState({ phase: 'FAILED', challenge: null, progress: null, message: PHASE_MESSAGES.FAILED, userName: null });
        }
      } catch {
        this.setState({ phase: 'FAILED', challenge: null, progress: null, message: 'Error during recognition', userName: null });
      } finally {
        this._matchingInProgress = false;
      }
    }
  }

  private setState(next: AuthState): void {
    this.state = next;
    this.emit('stateChange', { ...next });
  }
}

export const biometricAuth = new BiometricAuthEmitter();
