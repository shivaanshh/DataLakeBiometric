import { db } from '../storage/db';
import { LivenessChecker, Landmark } from './LivenessChecker';
import { cosineSim, isMatch, averageEmbeddings } from './FaceRecognizer';

export type AuthPhase =
  | 'IDLE'
  | 'DETECTING_FACE'
  | 'LIVENESS'
  | 'RECOGNIZING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ENROLLING'
  | 'ENROLLED';

export interface AuthEvent {
  phase:       AuthPhase;
  message:     string;
  challenge?:  string | null;
  similarity?: number;
}

type Listener = (e: AuthEvent) => void;

const CHALLENGE_PROMPT: Record<string, string> = {
  BLINK:      'Blink your eyes slowly',
  SMILE:      'Give a natural smile',
  TURN_LEFT:  'Turn your head to the left',
  TURN_RIGHT: 'Turn your head to the right',
};

class BiometricAuth {
  private liveness  = new LivenessChecker(2);
  private phase: AuthPhase = 'IDLE';
  private listeners: Listener[] = [];

  on(cb: Listener) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(e: AuthEvent) {
    this.phase = e.phase;
    this.listeners.forEach(l => l(e));
  }

  // ── Enrollment ──────────────────────────────────────────────────────────────
  async enroll(
    userId:   string,
    userName: string,
    embeddings: Float32Array[],
  ): Promise<void> {
    if (!embeddings.length) throw new Error('No face embeddings captured');
    this.emit({ phase: 'ENROLLING', message: 'Saving face template...' });
    try {
      const avg = averageEmbeddings(embeddings);
      await db.enrollUser(userId, userName, avg);
      this.emit({ phase: 'ENROLLED', message: `${userName} enrolled successfully` });
    } catch (err: any) {
      this.emit({ phase: 'FAILED', message: `Enrollment failed: ${err.message}` });
      throw err;
    }
  }

  // ── Authentication ──────────────────────────────────────────────────────────
  reset() {
    this.liveness.reset();
    this.phase = 'IDLE';
    this.emit({ phase: 'IDLE', message: 'Ready' });
  }

  async processAuthFrame(params: {
    userId:    string;
    landmarks: Landmark[] | null;
    embedding: Float32Array | null;
  }): Promise<void> {
    const { userId, landmarks, embedding } = params;

    // No face detected
    if (!landmarks || !embedding) {
      if (this.phase !== 'DETECTING_FACE') {
        this.emit({ phase: 'DETECTING_FACE', message: 'Position your face in the oval' });
      }
      return;
    }

    // Already finished
    if (this.phase === 'SUCCESS' || this.phase === 'FAILED') return;

    // Liveness phase
    if (this.phase !== 'RECOGNIZING') {
      const result = this.liveness.processFrame(landmarks);
      const prompt = result.currentChallenge
        ? (CHALLENGE_PROMPT[result.currentChallenge] ?? result.currentChallenge)
        : 'Checking liveness...';

      if (!result.passed) {
        this.emit({
          phase:     'LIVENESS',
          message:   prompt,
          challenge: result.currentChallenge,
        });
        return;
      }

      this.emit({ phase: 'RECOGNIZING', message: 'Liveness confirmed. Verifying identity...' });
    }

    // Recognition phase
    try {
      const stored = await db.getEmbedding(userId);
      if (!stored) {
        this.emit({ phase: 'FAILED', message: 'User not enrolled on this device' });
        return;
      }

      const sim   = cosineSim(embedding, stored);
      const match = isMatch(embedding, stored);

      if (match) {
        await db.logAttendance({
          id:        `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId,
          timestamp: Date.now(),
          location:  'on-device',
        });
        this.emit({ phase: 'SUCCESS', message: 'Identity verified', similarity: sim });
      } else {
        this.emit({ phase: 'FAILED', message: 'Face not recognized', similarity: sim });
      }
    } catch (err: any) {
      this.emit({ phase: 'FAILED', message: `Error: ${err.message}` });
    }
  }
}

export const biometricAuth = new BiometricAuth();
