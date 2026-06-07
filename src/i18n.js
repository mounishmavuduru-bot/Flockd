/**
 * i18n: English-only. The German locale was removed; the public API is
 * preserved so existing importers keep working without changes.
 * Usage: import { t, lang, toggleLang } from './i18n.js';
 *        t('start.hint')  → "Tilt: Steer · Shake: Flap"
 */

const strings = {
  'start.subtitle': 'Tilt your device to steer.\nShake = Flap wings!',
  'start.hint': 'Tilt: Steer · Shake: Flap',
  'start.landscape': 'Please rotate your device\nto <b>landscape</b>',
  'start.fsTitle': 'Fullscreen Setup',
  'start.fsDesc': 'For the best experience: add to home screen — runs in true fullscreen!',
  'start.fsStep1': 'Tap the <b>Share</b> button in Safari',
  'start.fsStep2': 'Scroll down and tap <b>"Add to Home Screen"</b>',
  'start.fsStep3': 'Tap <b>"Add"</b> — an icon appears on your home screen',
  'start.fsStep4': 'Open from home screen — runs in <b>true fullscreen!</b>',
  'start.fsOnce': 'You only need to do this once.',
  'start.fsOk': 'Got it!',
  'start.fsBtn': 'Fullscreen Setup (recommended)',
  'start.fsStepLabel': 'Step',
  'calib.profileFound': 'Calibration found',
  'calib.profileQuestion': 'Use previous calibration\nor recalibrate?',
  'calib.useProfile': 'Play now',
  'calib.redo': 'Recalibrate',
  'calib.step': 'STEP',
  'calib.rest.title': 'Glide Position',
  'calib.rest.text': 'Hold your phone steady in\nthe position you want to fly.',
  'calib.left.title': 'Turn Left',
  'calib.left.text': 'Tilt for a\ngentle left turn.',
  'calib.right.title': 'Sharp Right Turn',
  'calib.right.text': 'Tilt for a\nsharp right turn!',
  'calib.climb.title': 'Climb',
  'calib.climb.text': 'Tilt to\nclimb upward.',
  'calib.dive.title': 'Dive',
  'calib.dive.text': 'Tilt to\ndive downward.',
  'calib.shake.title': 'Flap Wings!',
  'calib.shake.text': 'Shake your phone\nvigorously!',
  'calib.skipShake': 'Skip',
  'calib.detected': 'Detected!',
  'calib.live.label': 'Live sensor',
  'calib.live.delta': 'Δ from rest',
  'calib.live.waiting': 'Waiting for sensor…',
  'calib.test.title': 'Quick test flight',
  'calib.test.text': 'Tilt your phone in every direction.\nDoes the bird respond the way you expect?',
  'calib.test.confirm': '✓ Looks right — continue',
  'calib.test.redo': '↻ Recalibrate',
  'calib.done': 'Calibration complete!',
  'calib.enjoy': 'Enjoy flying!',
  'controls.tilt': 'Tilt: Steer',
  'controls.shake': 'Shake: Flap',
  'controls.doubletap': '2× Tap: Reset center',
  'controls.recalib': 'Calibrate',
  'orient.msg': 'Please rotate your device\nto <b>landscape</b>',
  'hud.flying': 'FLYING',
  'hud.landing': 'LANDING...',
  'hud.walking': 'WALKING',
  'hud.takeoff': 'TAKING OFF...',
  'fish.catch1': 'Fish caught!',
  'fish.catch2': 'Nice catch!',
  'fish.catch3': 'Bullseye!',
  'fish.catch4': 'What a dive!',
  'perm.denied': 'Gyroscope permission denied — cannot play without it.',
};

export function t(key) {
  return strings[key] ?? key;
}

export function lang() {
  return 'en';
}

export function toggleLang() {
  // No-op: FLOCKD is English-only.
}

export function onLangChange() {
  // No-op: language never changes (English-only).
}
