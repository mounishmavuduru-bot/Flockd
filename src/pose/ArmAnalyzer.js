import { clamp, remap } from '../utils/math.js';

const LEFT_SHOULDER = 11;
const LEFT_WRIST = 15;
const RIGHT_SHOULDER = 12;
const RIGHT_WRIST = 16;
const NOSE = 0;

/**
 * Simple, robust gesture recognition based on hand-to-shoulder relationship.
 *
 * - Hands ABOVE shoulders → GLIDE (wings spread)
 * - Hands BELOW shoulders → DIVE (wings tucked)
 * - Alternating above/below (3+ times in 3s) → FLAP
 * - One hand higher than other → TURN
 */
export class ArmAnalyzer {
  constructor() {
    this.calibrated = false;
    this.restNoseY = 0.35;

    // Core state: are hands above or below shoulders?
    this._handsAbove = true;       // true = above, false = below
    this._stateChanges = [];       // timestamps of above↔below transitions
    this._lastFlapTime = 0;

    // Smoothed outputs
    this.flapStrength = 0;
    this.roll = 0;
    this.pitch = 0;
    this.wingSpread = 1;
    this.gesture = 'GLIDE';
    this._diveActive = false;

    // --- Vertical state machine: distinguishes GLIDE (hands above/neutral)
    //     from DIVE (hands below) with a deadband + temporal smoothing so a
    //     borderline arm position can't flip-flop between the two. ---
    // Separated thresholds on avgElev (positive = hands above shoulders):
    //   avgElev >= ABOVE_ENTER  → hands are clearly ABOVE  (glide / climb)
    //   avgElev <= BELOW_ENTER  → hands are clearly BELOW   (dive)
    //   between the two EXIT bands → "neutral", state is held.
    this.DIVE_ENTER = -0.06;   // must reach this (hands well below) to start diving
    this.DIVE_EXIT = -0.02;    // must rise above this to stop diving (deadband)
    this.ABOVE_ENTER = 0.04;   // hands clearly above shoulders
    this._verticalState = 'NEUTRAL'; // 'ABOVE' | 'NEUTRAL' | 'BELOW'

    // Dive hysteresis (consecutive-frame confirmation)
    this._diveCounter = 0;
    this._aboveCounter = 0;
    this.DIVE_ON_FRAMES = 6;   // N consistent frames below before DIVE engages
    this.DIVE_OFF_FRAMES = 2;  // frames at/above exit band before DIVE releases

    // Missing frames
    this._missingFrames = 0;

    // Gesture hold timer (anti-flicker)
    this._lastGesture = 'GLIDE';
    this._gestureHoldTime = 0;

    // Visibility
    this.leftVisible = false;
    this.rightVisible = false;
  }

  calibrate(landmarks) {
    if (!landmarks) return;
    const nose = landmarks[NOSE];
    if (nose) this.restNoseY = nose.y;
    this.calibrated = true;
  }

  _isVisible(lm) {
    if (!lm) return false;
    return (lm.visibility ?? 1) > 0.3 && lm.x > 0.02 && lm.x < 0.98;
  }

  analyze(landmarks) {
    const now = performance.now();

    // Missing landmarks → fade to glide
    if (!landmarks || landmarks.length < 17) {
      this._missingFrames++;
      if (this._missingFrames > 5) {
        this.flapStrength *= 0.85;
        this.roll *= 0.9;
        this.pitch *= 0.9;
        this.wingSpread += (1.0 - this.wingSpread) * 0.1;
        this._diveActive = false;
        this._diveCounter = 0;
        this._aboveCounter = 0;
        this._verticalState = 'NEUTRAL';
        this.gesture = 'NO TRACKING';
      }
      return this._output();
    }
    this._missingFrames = 0;

    const ls = landmarks[LEFT_SHOULDER];
    const lw = landmarks[LEFT_WRIST];
    const rs = landmarks[RIGHT_SHOULDER];
    const rw = landmarks[RIGHT_WRIST];

    this.leftVisible = this._isVisible(lw) && this._isVisible(ls);
    this.rightVisible = this._isVisible(rw) && this._isVisible(rs);

    if (!this.leftVisible && !this.rightVisible) {
      this.wingSpread += (1.0 - this.wingSpread) * 0.1;
      this._diveActive = false;
      this._diveCounter = 0;
      this._aboveCounter = 0;
      this._verticalState = 'NEUTRAL';
      this.gesture = 'GLIDE';
      return this._output();
    }

    // === CORE: Hand position relative to shoulder (MediaPipe Y: 0=top, 1=bottom) ===
    // hand.y < shoulder.y means hand is ABOVE shoulder
    let leftAbove = false, rightAbove = false;
    let leftElev = 0, rightElev = 0;

    if (this.leftVisible) {
      leftElev = ls.y - lw.y; // positive = hand above shoulder
      leftAbove = leftElev > 0.02; // small deadzone
    }
    if (this.rightVisible) {
      rightElev = rs.y - rw.y;
      rightAbove = rightElev > 0.02;
    }

    // Mirror if only one arm visible
    if (this.leftVisible && !this.rightVisible) {
      rightAbove = leftAbove;
      rightElev = leftElev;
    } else if (this.rightVisible && !this.leftVisible) {
      leftAbove = rightAbove;
      leftElev = rightElev;
    }

    const bothAbove = leftAbove && rightAbove;
    const bothBelow = !leftAbove && !rightAbove;
    const avgElev = (leftElev + rightElev) / 2;

    // === DETECT STATE TRANSITIONS (above ↔ below) ===
    const wasAbove = this._handsAbove;
    this._handsAbove = bothAbove;

    if (bothAbove !== wasAbove) {
      this._stateChanges.push(now);
    }

    // Keep only recent transitions (3 seconds)
    this._stateChanges = this._stateChanges.filter(t => now - t < 3000);

    // === FLAP: need 3 CONSECUTIVE fast transitions (each < 1.5s apart) ===
    let consecutiveFast = 0;
    for (let i = 1; i < this._stateChanges.length; i++) {
      if (this._stateChanges[i] - this._stateChanges[i - 1] < 1500) {
        consecutiveFast++;
      } else {
        consecutiveFast = 0; // reset if gap too long
      }
    }

    if (consecutiveFast >= 3) {
      this.flapStrength = clamp(this._stateChanges.length / 6, 0.5, 1.0);
      this._lastFlapTime = now;
    } else if (now - this._lastFlapTime < 400) {
      // Hysteresis: hold flap 400ms
      this.flapStrength = Math.max(this.flapStrength * 0.9, 0.3);
    } else {
      this.flapStrength *= 0.85;
      if (this.flapStrength < 0.05) this.flapStrength = 0;
    }

    const isFlapping = this.flapStrength > 0.1;

    // === VERTICAL STATE MACHINE: GLIDE (above/neutral) vs DIVE (below) ===
    // Use the continuous avgElev signal with a deadband between the BELOW and
    // ABOVE bands so a hand hovering near shoulder height stays in whatever
    // state it last latched into instead of oscillating GLIDE↔DIVE.
    // bothBelow / bothAbove are kept as a sign sanity check.
    const clearlyBelow = bothBelow && avgElev <= this.DIVE_ENTER;
    const clearlyAbove = bothAbove && avgElev >= this.ABOVE_ENTER;

    if (clearlyBelow) {
      this._verticalState = 'BELOW';
    } else if (clearlyAbove) {
      this._verticalState = 'ABOVE';
    } else if (avgElev > this.DIVE_EXIT && avgElev < this.ABOVE_ENTER) {
      // Hands risen clear of the dive exit band (and not yet clearly above):
      // relax to NEUTRAL. This is the only way to leave a latched BELOW.
      this._verticalState = 'NEUTRAL';
    }
    // In the BELOW exit band (DIVE_ENTER < avgElev <= DIVE_EXIT) the previous
    // state is held — that gap is the positional hysteresis deadband, so hands
    // hovering near shoulder height don't oscillate between GLIDE and DIVE.

    // === DIVE: consecutive-frame confirmation on the BELOW state ===
    const wantDive = this._verticalState === 'BELOW' && !isFlapping;
    if (wantDive) {
      this._diveCounter = Math.min(this._diveCounter + 1, 20);
      this._aboveCounter = 0;
    } else {
      this._diveCounter = Math.max(this._diveCounter - 1, 0);
      if (this._verticalState === 'ABOVE') {
        this._aboveCounter = Math.min(this._aboveCounter + 1, 20);
      } else {
        this._aboveCounter = 0;
      }
    }
    // Engage only after DIVE_ON_FRAMES consistent frames; release only after
    // the counter decays past DIVE_OFF_FRAMES. Separate enter/exit bands give
    // temporal hysteresis on top of the positional deadband above.
    if (this._diveCounter >= this.DIVE_ON_FRAMES) this._diveActive = true;
    if (this._diveCounter <= this.DIVE_OFF_FRAMES) this._diveActive = false;

    // === ROLL: elevation difference ===
    const elevDiff = rightElev - leftElev;
    const targetRoll = clamp(elevDiff * 2.5, -1, 1);
    this.roll += (targetRoll - this.roll) * 0.04;

    // === PITCH: fully continuous, no deadzone, no steps ===
    // Linear mapping: avgElev directly maps to pitch
    let targetPitch;
    if (isFlapping) {
      targetPitch = 0.1;
    } else {
      targetPitch = clamp(avgElev * 3.0, -0.7, 0.7); // smooth linear scaling
    }
    this.pitch += (targetPitch - this.pitch) * 0.04; // ultra smooth

    // === WING SPREAD: fully continuous ===
    const recentlyFlapped = (now - this._lastFlapTime < 600);
    let targetSpread;
    if (recentlyFlapped) {
      targetSpread = 1.0;
    } else {
      targetSpread = clamp(remap(avgElev, -0.12, 0.06, 0, 1), 0, 1);
    }
    this.wingSpread += (targetSpread - this.wingSpread) * 0.05;

    // === GESTURE LABEL (with 300ms hold) ===
    // DIVE is driven ONLY by the hysteretic _diveActive state (single source of
    // truth) — the old raw `pitch < -0.15` trigger had no hysteresis and caused
    // GLIDE↔DIVE flicker, so it is removed. CLIMB requires hands to be in the
    // confirmed ABOVE state, so neutral pitch noise can't read as CLIMB.
    let newGesture;
    if (this._diveActive) newGesture = 'DIVE';
    else if (isFlapping) newGesture = 'FLAP!';
    else if (this._verticalState === 'ABOVE' && this.pitch > 0.15) newGesture = 'CLIMB';
    else if (Math.abs(this.roll) > 0.12) newGesture = this.roll > 0 ? 'TURN LEFT' : 'TURN RIGHT';
    else newGesture = 'GLIDE';

    if (newGesture !== this._lastGesture) {
      if (now - this._gestureHoldTime > 300) {
        this.gesture = newGesture;
        this._lastGesture = newGesture;
        this._gestureHoldTime = now;
      }
    } else {
      this.gesture = newGesture;
      this._gestureHoldTime = now;
    }

    // No deadzone — fully continuous control
    // No pitch deadzone — continuous

    return this._output();
  }

  _output() {
    return {
      flapStrength: this.flapStrength,
      roll: this.roll,
      pitch: this.pitch,
      wingSpread: this.wingSpread,
      diveActive: this._diveActive,
    };
  }
}
