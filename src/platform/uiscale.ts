// Touch adaptation. The desktop layout is never changed: this module only
// decides *how big* the same window is drawn, and flags that a coarse pointer
// is driving it. Mouse browsers and the Electron app fall straight through.
//
// The magnification goes through the viewport meta rather than a CSS transform
// so every CSS pixel the app measures — layout, scroll offsets, pointer
// coordinates — keeps its usual meaning and no coordinate math has to change.
// The browser magnifies the finished page, exactly like resizing a desktop
// window down to phone size and then leaning in.

import { isElectron } from './bridge';

/** `?touch=1` forces the touch layout on a mouse browser, to look it over. */
const forced = /[?&]touch=1(&|$)/.test(location.search);

/** True when the primary pointer is a finger (phones, tablets). */
export const isTouchUI: boolean =
  !isElectron &&
  (forced || (typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches));

/** Page magnification. 1 = the untouched desktop layout. */
export let uiScale = 1;

/** devicePixelRatio as it read *before* the viewport was rescaled. */
let baselineDpr = 1;
/** Page scale to fold into canvas backing stores, if the engine hasn't. */
let dprBoost = 1;

/**
 * Orientation-independent so that rotating the device never resizes the
 * chrome. At 1.5 the 25px tool buttons land near 40pt — the size they occupy
 * on a real desktop monitor, and a comfortable touch target.
 */
function pickScale(): number {
  const short = Math.min(screen.width, screen.height);
  if (short <= 480) return 1.5;    // phones
  if (short <= 900) return 1.25;   // tablets
  return 1;                        // large touch displays already have room
}

function applyViewport(): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  // Deliberately no `width`: with only an initial scale the layout viewport
  // becomes (device width / scale), which is the whole point — the same window,
  // shrunk to fit. maximum-scale stops iOS zooming in when a text field takes
  // focus; pinching *out* to see more of the window is still allowed.
  meta.content = `initial-scale=${uiScale}, maximum-scale=${uiScale}, user-scalable=yes`;
}

/**
 * Some engines fold the page scale into devicePixelRatio and some don't, and
 * getting it wrong means a soft canvas in an app whose whole point is hard
 * pixel edges. Measure it once the new viewport has taken effect.
 */
function measureBoost(): void {
  const now = window.devicePixelRatio || 1;
  dprBoost = now >= baselineDpr * uiScale * 0.95 ? 1 : uiScale;
}

/** Device pixels per CSS pixel, page scale included. */
export function deviceScale(): number {
  return (window.devicePixelRatio || 1) * dprBoost;
}

export function initTouchUI(): void {
  if (!isTouchUI) return;
  document.documentElement.classList.add('touch-ui');
  baselineDpr = window.devicePixelRatio || 1;
  uiScale = pickScale();
  applyViewport();
  const settle = () => {
    measureBoost();
    // Canvas backing stores are sized from deviceScale(); a changed boost has
    // to reach them, and the app repaints the view on resize.
    window.dispatchEvent(new Event('resize'));
  };
  requestAnimationFrame(settle);
  window.addEventListener('orientationchange', () => {
    applyViewport();
    requestAnimationFrame(settle);
  });
}
