import { useSyncExternalStore } from "react";

/**
 * "Calm" means nothing on screen moves by itself: no background video, no looping shimmer or
 * orbiting light, no drifting ticker, no smooth scrolling.
 *
 * It is on when the device asks for reduced motion, or when the person pressed "Pause animations".
 * The second half is a requirement, not a nicety: anything that starts on its own and keeps moving
 * for more than five seconds needs a way to stop it (WCAG 2.2.2, level A), and not everyone who
 * finds a looping video hard to look at has changed a system setting.
 *
 * Both halves reach CSS and JavaScript. CSS reads `@media (prefers-reduced-motion)` for the device
 * and `<html data-calm="1">` for the button. In JavaScript, `useCalm()` follows both, live, and is
 * for the things that loop on their own (the hero video, the shader backgrounds, the ticker) and for
 * `MotionConfig`. The structural effects in `motion.tsx` / `fx.tsx` keep using Motion's own
 * `useReducedMotion()` (the device only): they swap one element type for another, so flipping them
 * while someone is typing would remount the page and throw their input away.
 */
export type CalmState = "off" | "paused" | "system";

const KEY = "arena3.calm";
const QUERY = "(prefers-reduced-motion: reduce)";

let paused = false;
let system = false;
const subscribers = new Set<() => void>();

const emit = () => subscribers.forEach((f) => f());

function mirror() {
  const root = document.documentElement;
  if (paused) root.setAttribute("data-calm", "1");
  else root.removeAttribute("data-calm");
}

// Read once, on the client, before the first render that cares. The server and the first client
// render both see "off" (see the server snapshot below), so hydration agrees and the saved choice
// lands one render later.
if (typeof window !== "undefined") {
  try {
    paused = localStorage.getItem(KEY) === "1";
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  const mq = window.matchMedia?.(QUERY);
  system = mq?.matches === true;
  mq?.addEventListener?.("change", (e) => {
    system = e.matches;
    emit();
  });
  mirror();
}

const state = (): CalmState => (system ? "system" : paused ? "paused" : "off");

const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => void subscribers.delete(f);
};

/** The person's own choice from the pause button. */
export function setPaused(next: boolean) {
  if (next === paused) return;
  paused = next;
  try {
    if (next) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the choice just lasts until reload */
  }
  mirror();
  emit();
}

/** Why motion is off, if it is: the device asked ("system"), the person did ("paused"), or it is not ("off"). */
export const useCalmState = (): CalmState => useSyncExternalStore(subscribe, state, () => "off" as CalmState);

/** True when nothing should move by itself. */
export const useCalm = (): boolean => useCalmState() !== "off";

/** For event handlers, where a hook cannot be called. */
export const isCalm = (): boolean => system || paused;

/** `behavior` for `scrollIntoView` / `scrollTo`: instant when calm. */
export const scrollBehavior = (): ScrollBehavior => (isCalm() ? "auto" : "smooth");
