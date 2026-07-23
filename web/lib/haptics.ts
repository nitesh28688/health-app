/**
 * Haptics utility wrapper for `navigator.vibrate()`.
 * Fails silently on unsupported devices (e.g., iOS Safari or desktop).
 */

export function hapticTap() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(50);
  }
}

export function hapticSuccess() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    // A quick double tap
    navigator.vibrate([30, 50, 30]);
  }
}

export function hapticWarning() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    // A longer, more pronounced vibration
    navigator.vibrate(200);
  }
}
