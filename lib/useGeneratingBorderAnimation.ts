"use client";
import { useEffect, type RefObject } from "react";

// Maps a perimeter distance (px) on a rounded-rect to the CSS conic-gradient
// angle (degrees) that points toward that spot from the element's center.
// This ensures the spotlight advances at constant linear speed instead of
// constant angular speed, which looks faster on shorter edges.
function perimToAngle(dist: number, W: number, H: number, r: number): number {
  const halfSw = W / 2 - r;
  const sh = H - 2 * r;
  const sw = W - 2 * r;
  const arcLen = (Math.PI / 2) * r;
  const perim = 2 * halfSw + sw + 2 * sh + 4 * arcLen;

  let s = ((dist % perim) + perim) % perim;
  let x: number, y: number;

  // Traverse clockwise starting from top-center
  if (s < halfSw) {
    x = s; y = -H / 2;
  } else if ((s -= halfSw) < arcLen) {
    const a = -Math.PI / 2 + (s / arcLen) * (Math.PI / 2);
    x = W / 2 - r + r * Math.cos(a); y = -H / 2 + r + r * Math.sin(a);
  } else if ((s -= arcLen) < sh) {
    x = W / 2; y = -H / 2 + r + s;
  } else if ((s -= sh) < arcLen) {
    const a = (s / arcLen) * (Math.PI / 2);
    x = W / 2 - r + r * Math.cos(a); y = H / 2 - r + r * Math.sin(a);
  } else if ((s -= arcLen) < sw) {
    x = W / 2 - r - s; y = H / 2;
  } else if ((s -= sw) < arcLen) {
    const a = Math.PI / 2 + (s / arcLen) * (Math.PI / 2);
    x = -W / 2 + r + r * Math.cos(a); y = H / 2 - r + r * Math.sin(a);
  } else if ((s -= arcLen) < sh) {
    x = -W / 2; y = H / 2 - r - s;
  } else if ((s -= sh) < arcLen) {
    const a = Math.PI + (s / arcLen) * (Math.PI / 2);
    x = -W / 2 + r + r * Math.cos(a); y = -H / 2 + r + r * Math.sin(a);
  } else {
    s -= arcLen; x = -W / 2 + r + s; y = -H / 2;
  }

  // CSS conic angle: 0° = top, clockwise. Formula: atan2(x, -y).
  return (Math.atan2(x, -y) * (180 / Math.PI) + 360) % 360;
}

const PEAK_DEG = 345;   // gradient stop where var(--foreground) sits
const DURATION = 3000;  // ms per full revolution
const BORDER_RADIUS = 8;

export function useGeneratingBorderAnimation(
  cardRef: RefObject<HTMLDivElement | null>,
  busy: boolean,
) {
  useEffect(() => {
    if (!busy) return;
    const el = cardRef.current;
    if (!el) return;

    el.style.setProperty("border-color", "transparent", "important");
    el.style.setProperty("box-shadow", "none", "important");

    const { width: W, height: H } = el.getBoundingClientRect();
    const halfSw = W / 2 - BORDER_RADIUS;
    const sh = H - 2 * BORDER_RADIUS;
    const sw = W - 2 * BORDER_RADIUS;
    const arcLen = (Math.PI / 2) * BORDER_RADIUS;
    const perim = 2 * halfSw + sw + 2 * sh + 4 * arcLen;

    let rafId: number;
    const start = performance.now();
    const tick = (now: number) => {
      const s = ((now - start) / DURATION) * perim;
      const angle = perimToAngle(s, W, H, BORDER_RADIUS) - PEAK_DEG;
      el.style.setProperty("--border-angle", `${angle}deg`);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      el.style.removeProperty("--border-angle");
      el.style.removeProperty("border-color");
      el.style.removeProperty("box-shadow");
    };
  }, [busy, cardRef]);
}
