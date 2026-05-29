/**
 * BiometricAuth.ts
 *
 * High-level orchestrator that sequences:
 *   1. Face detection (BlazeFace)
 *   2. Liveness detection (MediaPipe FaceMesh)
 *   3. Face recognition (MobileFaceNet)
 *
 * Exposes two main flows:
 *   - enroll(userId, frames[])  → stores encrypted embedding in SQLite
 *   - authenticate(userId)      → runs full pipeline, logs attendance
 */

import { LivenessChecker, Landmark } from './LivenessChecker';
import { FaceRecognizer }            from './FaceRecognizer';
import { db }                        from '../storage/db';

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
  phase: AuthPhase;
  message: string;
  similarity?: number;
  challenge?: string | null;
}

type AuthListener = (event: AuthEvent) => void;

export class BiometricAuth {
  private recognizer   = new FaceRecognizer();
  private liveness     = new LivenessChecker(2);
  private phase: AuthPhase = 'IDLE';
  private listeners: AuthListener[] = [];

  async initialize() {
    await db.open();
    await this.recognizer.initialize();
    this.emit({ phase: 'IDLE', message: 'Ready' });
  }

  on(listener: AuthListener) {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(event: AuthEvent) {
    this.phase = event.phase;
    this.listeners.forEach(l => l(event));
  }

  // ─── ENROLLMENT ────────────────────────────────────────────────────────
  /**
   * Enroll a user by averaging embeddings from multiple captured frames.
   * Recommended: pass 5 frames with slight head movement for robustness.
   */
  async enroll(
    userId: string,
    userName: string,
    frames: Array<{ rgba: Uint8Array; width: number; height: number }>
  ): Promise<void> {
    this.emit({ phase: 'ENROLLING', message: 'Processing enrollment frames...' });

    try {
      if (frames.length < 3) throw new Error('Minimum 3 frames required for enrollment');

      const embeddings = await Promise.all(
        frames.map(f => this.recognizer.getEmbedding(f.rgba, f.width, f.height))
      );

      const avgEmbed = this.recognizer.averageEmbeddings(embeddings);
      await db.enrollUser(userId, userName, avgEmbed);

      this.emit({ phase: 'ENROLLED', message: `${userName} enrolled successfully` });
    } catch (err: any) {
      this.emit({ phase: 'FAILED', message: `Enrollment failed: ${err.message}` });
      throw err;
    }
  }

  // ─── AUTHENTICATION ────────────────────────────────────────────────────
  /**
   * Called once per camera frame during authentication.
   * Pass FaceMesh landmarks from the frame processor and the raw RGBA crop.
   */
  async processAuthFrame(params: {
    userId:       string;
    landmarks:    Landmark[] | null;
    faceRGBA:     Uint8Array | null;
    faceWidth:    number;
    faceHeight:   number;
    gpsLocation?: string;
  }): Promise<AuthEvent> {
    const { userId, landmarks, faceRGBA, faceWidth, faceHeight, gpsLocation } = params;

    // Phase: detecting face
    if (!landmarks || !faceRGBA) {
      const event: AuthEvent = { phase: 'DETECTING_FACE', message: 'Position your face in the oval' };
      this.emit(event);
      return event;
    }

    // Phase: liveness check
    if (this.phase !== 'RECOGNIZING' && this.phase !== 'SUCCESS' && this.phase !== 'FAILED') {
      const result = this.liveness.processFrame(landmarks);
      const event: AuthEvent = {
        phase:     result.passed ? 'RECOGNIZING' : 'LIVENESS',
        message:   result.passed
          ? 'Liveness confirmed. Verifying identity...'
          : this.challengePrompt(result.currentChallenge),
        challenge: result.currentChallenge,
      };
      this.emit(event);

      if (!result.passed) return event;
    }

    // Phase: face recognition
    if (this.phase === 'RECOGNIZING') {
      try {
        const storedEmbed = await db.getEmbedding(userId);
        if (!storedEmbed) {
          const event: AuthEvent = { phase: 'FAILED', message: 'User not enrolled on this device' };
          this.emit(event);
          return event;
        }

        const queryEmbed = await this.recognizer.getEmbedding(faceRGBA, faceWidth, faceHeight);
        const match      = this.recognizer.isMatch(queryEmbed, storedEmbed);

        if (match.matched) {
          await db.logAttendance({
            id:        `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            userId,
            timestamp: Date.now(),
            location:  gpsLocation ?? 'unknown',
          });
          const event: AuthEvent = {
            phase:      'SUCCESS',
            message:    'Identity verified ✓',
            similarity: match.similarity,
          };
          this.emit(event);
          return event;
        } else {
          const event: AuthEvent = {
            phase:      'FAILED',
            message:    'Face not recognized',
            similarity: match.similarity,
          };
          this.emit(event);
          return event;
        }
      } catch (err: any) {
        const event: AuthEvent = { phase: 'FAILED', message: `Recognition error: ${err.message}` };
        this.emit(event);
        return event;
      }
    }

    return { phase: this.phase, message: '' };
  }

  /** Reset for a new authentication attempt */
  reset() {
    this.liveness.reset();
    this.emit({ phase: 'IDLE', message: 'Ready' });
  }

  private challengePrompt(challenge: string | null): string {
    const prompts: Record<string, string> = {
      BLINK:       'Please blink your eyes',
      SMILE:       'Please smile',
      TURN_LEFT:   'Turn your head slowly to the left',
      TURN_RIGHT:  'Turn your head slowly to the right',
    };
    return challenge ? prompts[challenge] ?? 'Follow the on-screen instruction' : 'Processing...';
  }
}

export const biometricAuth = new BiometricAuth();
