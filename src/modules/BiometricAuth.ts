import { db } from '../storage/db';
import { LivenessChecker, Landmark } from './LivenessChecker';
import { cosineSimilarity, isMatch, averageEmbeddings } from './FaceRecognizer';

export type Phase =
  | 'IDLE'
  | 'DETECTING_FACE'
  | 'LIVENESS'
  | 'RECOGNIZING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ENROLLING'
  | 'ENROLLED';

// Keep AuthPhase as an alias for backward-compat imports
export type AuthPhase = Phase;

export interface AuthEvent {
  phase:       Phase;
  message:     string;
  challenge?:  string | null;
  similarity?: number;
}

type Listener = (e: AuthEvent) => void;

const CHALLENGE_LABEL: Record<string, string> = {
  BLINK:      'Please blink your eyes',
  SMILE:      'Please give a natural smile',
  TURN_LEFT:  'Turn your head to the left',
  TURN_RIGHT: 'Turn your head to the right',
};

class BiometricAuth {
  private liveness = new LivenessChecker(2); // 2 challenges per session
  private phase: Phase = 'IDLE';
  private listeners: Set<Listener> = new Set();

  // ── Event bus ─────────────────────────────────────────────────────────────
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AuthEvent): void {
    this.phase = event.phase;
    this.listeners.forEach(l => l(event));
  }

  // ── Enrollment ─────────────────────────────────────────────────────────────
  async enroll(
    userId:    string,
    userName:  string,
    embeddings: Float32Array[],
  ): Promise<void> {
    if (!embeddings.length) throw new Error('No face data captured');
    this.emit({ phase: 'ENROLLING', message: 'Processing face template...' });
    try {
      const template = averageEmbeddings(embeddings);
      await db.enrollUser(userId, userName, template);
      this.emit({ phase: 'ENROLLED', message: `${userName} enrolled successfully` });
    } catch (err: any) {
      this.emit({ phase: 'FAILED', message: `Enrollment failed: ${err.message}` });
      throw err;
    }
  }

  // ── Authentication ─────────────────────────────────────────────────────────
  reset(): void {
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

    // Terminal states — stop processing
    if (this.phase === 'SUCCESS' || this.phase === 'FAILED') return;

    // No face in frame
    if (!landmarks || !embedding) {
      if (this.phase !== 'DETECTING_FACE') {
        this.emit({ phase: 'DETECTING_FACE', message: 'Position your face in the oval' });
      }
      return;
    }

    // Liveness phase
    if (this.phase !== 'RECOGNIZING') {
      const result = this.liveness.processFrame(landmarks);
      if (!result.passed) {
        const label = result.challenge ? (CHALLENGE_LABEL[result.challenge] ?? result.challenge) : '...';
        this.emit({ phase: 'LIVENESS', message: label, challenge: result.challenge });
        return;
      }
      this.emit({ phase: 'RECOGNIZING', message: 'Liveness confirmed — verifying identity...' });
    }

    // Recognition phase
    try {
      const stored = await db.getEmbedding(userId);
      if (!stored) {
        this.emit({ phase: 'FAILED', message: 'User not enrolled on this device.\nPlease enroll first.' });
        return;
      }

      const sim   = cosineSimilarity(embedding, stored);
      const match = isMatch(embedding, stored);

      if (match) {
        await db.logAttendance({
          id:        `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId,
          timestamp: Date.now(),
          location:  'on-device',
        });
        this.emit({ phase: 'SUCCESS', message: 'Identity verified ✓', similarity: sim });
      } else {
        this.emit({ phase: 'FAILED', message: 'Face not recognized', similarity: sim });
      }
    } catch (err: any) {
      this.emit({ phase: 'FAILED', message: `Error: ${err.message}` });
    }
  }
}

export const biometricAuth = new BiometricAuth();
