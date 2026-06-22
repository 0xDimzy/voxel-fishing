// lib/humanize.js
// Random timing helpers to mimic human behavior and avoid ban detection

/**
 * Random integer between min and max (inclusive).
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float between min and max.
 */
export function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Sleep ms milliseconds.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random delay in ms, useful between rapid actions.
 * Default 800-2500ms — feels like a person clicking around.
 */
export async function shortPause() {
  const ms = randInt(800, 2500);
  await sleep(ms);
  return ms;
}

/**
 * Delay between "macro" actions like cast -> reel -> cast.
 * 3-7s default — slow enough to dodge anti-cheat.
 */
export async function actionPause(min = 3000, max = 7000) {
  const ms = randInt(min, max);
  await sleep(ms);
  return ms;
}

/**
 * Delay between account rotations.
 * 30-90s default — keeps switching pattern unpredictable.
 */
export async function accountPause(min = 30000, max = 90000) {
  const ms = randInt(min, max);
  await sleep(ms);
  return ms;
}

/**
 * Bell-curve jitter (Gaussian-ish) for a "natural" delay.
 * Most calls cluster around `center`, with rare outliers.
 */
export function gaussianDelay(center, spread, min, max) {
  // Box-Muller
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  let v = center + z * spread;
  if (min != null) v = Math.max(min, v);
  if (max != null) v = Math.min(max, v);
  return Math.round(v);
}

/**
 * Pick a random item from an array (with optional weights).
 */
export function pickWeighted(items, weights) {
  if (!weights) {
    return items[Math.floor(Math.random() * items.length)];
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Sometimes skip an action to add unpredictability.
 * `prob` = 0.0 (never skip) to 1.0 (always skip).
 */
export function maybeSkip(prob = 0.1) {
  return Math.random() < prob;
}

/**
 * Add micro-jitter to a number (e.g. fish weight, position).
 */
export function jitter(value, percent = 5) {
  const range = value * (percent / 100);
  return value + (Math.random() - 0.5) * 2 * range;
}
