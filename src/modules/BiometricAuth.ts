import { db } from '../storage/db';
import { LivenessChecker, Landmark } from './LivenessChecker';
import { FaceRecognizer } from './FaceRecognizer';

export type AuthPhase =
  | 'IDLE' | 'DETECTING_FACE' | 'LIVENESS' | 'RECOGNIZING'
  | 'SUCCESS' | 'FAILED' | 'ENROLLING' | 'ENROLLED';

export interface AuthEvent {
  phase:      AuthPhase;
  message:    string;
  challenge?: string | null;
  similarity?: number;
}

type Listener = (e: AuthEvent) => void;

export class BiometricAuth {
  private recognizer = new FaceRecognizer();
  private liveness   = new LivenessChecker(2);
  private phase: AuthPhase = 'IDLE';
  private listeners: Listener[] = [];

  on(cb: Listener)  { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(l => l !== cb); }; }
  private emit(e: AuthEvent) { this.phase = e.phase; this.listeners.forEach(l => l(e)); }

  // ── Enrollment ──────────────────────────────────────────────────────────

  async enroll(
    userId:   string,
    userName: string,
    frames:   Array<{ rgba: Uint8Array; width: number; height: number }>,
  ): Promise<void> {
    if (frames.length < 1) throw new Error('At least 1 frame required');
    this.emit({ phase: 'ENROLLING', message: 'Processing enrollment...' });
    try {
      const embeddings = frames.map(f =>
        this.recognizer.getEmbedding(f.rgba, f.width, f.height),
      );
      const avg = this.recognizer.averageEmbeddings(embeddings);
      await db.enrollUser(userId, userName, avg);
      this.emit({ phase: 'ENROLLED', message: `${userName} enrolled successfully` });
    } catch (err: any) {
      this.emit({ phase: 'FAILED', message: `Enrollment failed: ${err.message}` });
      throw err;
    }
  }

  // ── Authentication ──────────────────────────────────────────────────────

  reset() {
    this.liveness.reset();
    this.emit({ phase: 'IDLE', message: 'Ready' });
  }

  async processAuthFrame(params: {
    userId:    string;
    landmarks: Landmark[] | null;
    faceRGBA:  Uint8Array | null;
    faceWidth: number;
    faceHeight:number;
  }): Promise<AuthEvent> {
    const { userId, landmarks, faceRGBA, faceWidth, faceHeight } = params;

    if (!landmarks || !faceRGBA) {
      const e: AuthEvent = { phase: 'DETECTING_FACE', message: 'Position your face in the oval' };
      this.emit(e);
      return e;
    }

    if (this.phase !== 'RECOGNIZING' && this.phase !== 'SUCCESS' && this.phase !== 'FAILED') {
      const result = this.liveness.processFrame(landmarks);
      const e: AuthEvent = {
        phase:     result.passed ? 'RECOGNIZING' : 'LIVENESS',
        message:   result.passed ? 'Liveness confirmed. Verifying identity...'
                                 : this.challengePrompt(result.currentChallenge),
        challenge: result.currentChallenge,
      };
      this.emit(e);
      if (!result.passed) return e;
    }

    if (this.phase === 'RECOGNIZING') {
      try {
        const stored = await db.getEmbedding(userId);
        if (!stored) {
          const e: AuthEvent = { phase: 'FAILED', message: 'User not enrolled on this device' };
          this.emit(e);
          return e;
        }
        const query = this.recognizer.getEmbedding(faceRGBA, faceWidth, faceHeight);
        const sim   = this.recognizer.cosineSim(query, stored);
        const match = this.recognizer.isMatch(query, stored);
        if (match) {
          await db.logAttendance({
            id:        `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            userId,
            timestamp: Date.now(),
            location:  'unknown',
          });
          const e: AuthEvent = { phase: 'SUCCESS', message: 'Identity verified', similarity: sim };
          this.emit(e);
          return e;
        } else {
          const e: AuthEvent = { phase: 'FAILED', message: 'Face not recognized', similarity: sim };
          this.emit(e);
          return e;
        }
      } catch (err: any) {
        const e: AuthEvent = { phase: 'FAILED', message: `Error: ${err.message}` };
        this.emit(e);
        return e;
      }
    }

    return { phase: this.phase, message: '' };
  }

  private challengePrompt(c: string | null): string {
    const map: Record<string, string> = {
      BLINK:      'Please blink your eyes',
      SMILE:      'Please smile',
      TURN_LEFT:  'Turn your head left',
      TURN_RIGHT: 'Turn your head right',
    };
    return c ? (map[c] ?? 'Follow the instruction') : 'Processing...';
  }
}

export const biometricAuth = new BiometricAuth();
