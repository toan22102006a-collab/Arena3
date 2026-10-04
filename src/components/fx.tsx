import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Arena3's effect layer.
 *
 * The vocabulary is borrowed from React Bits, but every piece here is written
 * against our own stack and palette rather than pasted in: the hover and pointer
 * effects run on `motion`, the scroll-linked text effects run on GSAP
 * ScrollTrigger, and the WebGL backgrounds live in `./gl` behind a lazy import
 * so `ogl` never lands in the main bundle.
 *
 * Two rules hold everywhere in this file:
 *   1. `prefers-reduced-motion` collapses the effect to a plain element. Nothing
 *      here is load-bearing for content.
 *   2. Pointer effects check `pointerType === "mouse"`. A spotlight that chases
 *      a finger is just a smear, and most of Arena3's traffic is on a phone.
 */

/* ── plumbing ────────────────────────────────────────────────────── */

/** `useLayoutEffect` that stays quiet during SSR. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

let gsapReady = false;
/** Register ScrollTrigger once, on the client only. */
function useScrollTriggerPlugin() {
  useIsoLayoutEffect(() => {
    if (gsapReady) return;
    gsap.registerPlugin(ScrollTrigger);
    gsapReady = true;
  }, []);
}

/** True once the component has mounted in the browser. Gates client-only work. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** True while `ref` is anywhere near the viewport. Used to park idle canvases. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, margin = "200px") {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setNear(entries[0]?.isIntersecting ?? false), {
      rootMargin: margin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
}

/* ── pointer-reactive surfaces ───────────────────────────────────── */

/**
 * Card with a soft radial highlight that follows the cursor.
 *
 * The glow is a sibling layer rather than a background on the card itself, so it
 * composites over whatever the card already paints — photos, tables, gradients.
 */
export function SpotlightCard({
  children,
  className,
  color = "var(--color-accent)",
  strength = 0.14,
  size = 320,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** Colour of the highlight. Any CSS colour `color-mix` accepts. */
  color?: string;
  /** Peak opacity of the highlight, 0–1. */
  strength?: number;
  /** Diameter of the highlight in px. */
  size?: number;
  as?: ElementType;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // Spring the position so a fast flick across the card trails rather than snaps.
  const sx = useSpring(x, { stiffness: 260, damping: 32, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 32, mass: 0.4 });
  const bg = useMotionTemplate`radial-gradient(${size}px circle at ${sx}px ${sy}px, color-mix(in oklab, ${color} 100%, transparent), transparent 68%)`;

  if (reduced) return <Tag className={className}>{children}</Tag>;

  return (
    <Tag
      ref={ref}
      className={cn("relative isolate", className)}
      onPointerMove={(e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      onPointerEnter={(e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        // Seed the position before fading in, or the glow springs across the
        // card from wherever the last visitor left it.
        const r = ref.current?.getBoundingClientRect();
        if (r) {
          x.jump(e.clientX - r.left);
          y.jump(e.clientY - r.top);
        }
        setOn(true);
      }}
      onPointerLeave={() => setOn(false)}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit]"
        style={{ background: bg }}
        animate={{ opacity: on ? strength : 0 }}
        transition={{ duration: 0.28 }}
      />
      {children}
    </Tag>
  );
}

/**
 * Diagonal band of light that sweeps across a surface once on hover.
 *
 * Distinct from the `.sweep` utility on buttons: this one is wide, slow and
 * angled, meant for photographs and large panels rather than pill controls.
 */
export function GlareHover({
  children,
  className,
  angle = 16,
  duration = 0.85,
  opacity = 0.35,
}: {
  children: ReactNode;
  className?: string;
  angle?: number;
  duration?: number;
  opacity?: number;
}) {
  const reduced = useReducedMotion();
  const [key, setKey] = useState(0);
  const [playing, setPlaying] = useState(false);

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <div
      className={cn("relative isolate overflow-hidden", className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        // Bump the key so a re-entry restarts the sweep instead of being
        // swallowed while the previous one is still running.
        setKey((k) => k + 1);
        setPlaying(true);
      }}
    >
      {children}
      <motion.span
        key={key}
        aria-hidden
        className="pointer-events-none absolute inset-y-[-40%] z-[3] w-1/3"
        style={{
          rotate: angle,
          background: `linear-gradient(90deg, transparent, rgba(255,248,238,${opacity}), transparent)`,
          filter: "blur(6px)",
        }}
        initial={{ left: "-40%" }}
        animate={playing ? { left: "130%" } : { left: "-40%" }}
        transition={{ duration, ease: [0.16, 1, 0.3, 1] }}
        onAnimationComplete={() => setPlaying(false)}
      />
    </div>
  );
}

/**
 * Pulls its child a little way toward the cursor while the cursor is within
 * `radius` px. Used sparingly on primary CTAs — it makes the target feel eager,
 * but on more than one or two elements a page starts to feel unstable.
 */
export function Magnet({
  children,
  className,
  radius = 130,
  pull = 0.32,
  wrapperClassName,
}: {
  children: ReactNode;
  className?: string;
  /** How close the pointer must get, in px, before the child reacts. */
  radius?: number;
  /** Fraction of the pointer offset the child travels. */
  pull?: number;
  wrapperClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.35 });

  useEffect(() => {
    if (reduced) return;
    // Tracked on the window, not the element: the point of a magnet is that it
    // reacts *before* the pointer arrives.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < radius) {
        x.set(dx * pull);
        y.set(dy * pull);
      } else {
        x.set(0);
        y.set(0);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [radius, pull, reduced, x, y]);

  if (reduced) return <span className={wrapperClassName}>{children}</span>;

  return (
    <span ref={ref} className={cn("inline-block", wrapperClassName)}>
      <motion.span className={cn("inline-block", className)} style={{ x: sx, y: sy }}>
        {children}
      </motion.span>
    </span>
  );
}

/* ── text ────────────────────────────────────────────────────────── */

/** A travelling sheen across text. Pure CSS, so it costs nothing to leave on. */
export function ShinyText({
  children,
  className,
  speed = 4.5,
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  /** Seconds per pass. */
  speed?: number;
  disabled?: boolean;
}) {
  if (disabled) return <span className={className}>{children}</span>;
  return (
    <span
      className={cn("shiny-text", className)}
      style={{ "--shiny-duration": `${speed}s` } as CSSProperties}
    >
      {children}
    </span>
  );
}

/**
 * Splits a headline into characters or words and rises them into place.
 *
 * The movement is a CSS animation, staggered by a per-unit `animation-delay`;
 * the only thing JavaScript decides is *when* to start it, via an
 * IntersectionObserver. See the `.split-unit` rules in `styles.css` for why the
 * animation itself is not a tween.
 *
 * The observer is what keeps this usable for the landing page's section
 * headings, which should hold still until they are scrolled to; anything
 * already on screen at mount intersects immediately and plays at once.
 */
export function SplitText({
  text,
  className,
  splitBy = "chars",
  stagger = 0.028,
  duration = 0.8,
  delay = 0,
  distance = 118,
  margin = "0px 0px -12% 0px",
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  splitBy?: "chars" | "words";
  stagger?: number;
  duration?: number;
  delay?: number;
  distance?: number;
  /** How far into the viewport the heading must come before it plays. */
  margin?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(false);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced || shown) return;

    // Measured rather than observed for the first answer. An
    // IntersectionObserver only delivers once the page is actually being
    // painted, so a heading that is plainly on screen would sit at opacity 0
    // for as long as the tab is not drawing — and a `getBoundingClientRect`
    // read costs nothing here, because layout has just happened anyway.
    // A viewport with no height is a page that is laid out but not being shown
    // — there is no scroll position to wait for, so there is nothing to reveal
    // on. Treat it as visible rather than leaving the text at opacity 0.
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const r = el.getBoundingClientRect();
    if (!vh || (r.bottom > 0 && r.top < vh * 0.88)) {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, shown, margin]);

  // Reduced motion (and the server render) get the plain string — no wrapper
  // spans at all, so screen readers and text selection behave normally.
  if (reduced) return <Tag className={className}>{text}</Tag>;

  // Graphemes, not code points, so a Vietnamese letter and its tone marks stay in one unit.
  const graphemes = (w: string): string[] =>
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(w), (g) => g.segment)
      : Array.from(w);
  const words = text.normalize("NFC").split(/(\s+)/);
  // Whitespace is not a unit, so it must not consume a stagger step — otherwise
  // a word-split headline pauses in its own gaps and arrives unevenly.
  let step = 0;
  const unit = (u: string, key: number | string) => (
    // The mask is `overflow-hidden` on an inline-block; spaces stay outside it or the gap collapses.
    <span key={key} aria-hidden className="inline-block overflow-hidden align-bottom py-[0.28em] -my-[0.28em]">
      <span className="split-unit" style={{ "--split-delay": `${delay + step++ * stagger}s` } as CSSProperties}>
        {u}
      </span>
    </span>
  );

  return (
    <Tag
      ref={ref}
      className={cn("inline-block", className)}
      data-split-shown={shown ? "true" : undefined}
      style={
        {
          "--split-distance": `${distance}%`,
          "--split-duration": `${duration}s`,
        } as CSSProperties
      }
    >
      {/* aria-label is not allowed on a generic span/p; the real string is read
          from this hidden copy while the animated units stay aria-hidden. */}
      <span className="sr-only">{text}</span>
      {words.map((w, i) =>
        /^\s+$/.test(w) ? (
          <span key={i} aria-hidden>
            {" "}
          </span>
        ) : splitBy === "words" ? (
          unit(w, i)
        ) : (
          // Each word is one unbreakable box, so a line can only wrap at a space — otherwise the
          // break can fall between two letter boxes and strand a space at the start of a line.
          <span key={i} aria-hidden className="inline-block whitespace-nowrap">
            {graphemes(w).map((g, j) => unit(g, j))}
          </span>
        ),
      )}
    </Tag>
  );
}

/**
 * A paragraph that resolves word by word as it scrolls through the viewport —
 * each word rises out of a blur. Scrubbed rather than triggered, so the reader
 * controls the pace with the scroll wheel.
 */
export function ScrollReveal({
  children,
  className,
  blur = 5,
  baseOpacity = 0.14,
}: {
  children: string;
  className?: string;
  blur?: number;
  baseOpacity?: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduced = useReducedMotion();
  useScrollTriggerPlugin();

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const words = el.querySelectorAll<HTMLElement>("[data-reveal-word]");
    if (!words.length) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        words,
        { opacity: baseOpacity, filter: `blur(${blur}px)`, y: 6 },
        {
          opacity: 1,
          filter: "blur(0px)",
          y: 0,
          ease: "none",
          stagger: 0.12,
          scrollTrigger: {
            trigger: el,
            // Finishes well before the text leaves, so the last words are
            // readable for a while rather than resolving as they exit.
            start: "top 82%",
            end: "bottom 62%",
            scrub: 0.6,
          },
        },
      );
    }, el);
    return () => ctx.revert();
  }, [children, reduced, blur, baseOpacity]);

  if (reduced) return <p className={className}>{children}</p>;

  return (
    <p ref={ref} className={className}>
      <span className="sr-only">{children}</span>
      {children.split(" ").map((w, i) => (
        <span key={i} data-reveal-word aria-hidden className="inline-block will-change-[filter,opacity]">
          {w}
          {" "}
        </span>
      ))}
    </p>
  );
}

/**
 * Scramble-in text: characters cycle through junk before settling.
 *
 * Only ever decorative — the real string is in `aria-label`, and the animation
 * runs once when the element scrolls in.
 */
export function DecryptedText({
  text,
  className,
  speed = 45,
  charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
}: {
  text: string;
  className?: string;
  /** ms between scramble frames. */
  speed?: number;
  charset?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        let frame = 0;
        timer = setInterval(() => {
          frame += 1;
          // One more character locks in per frame; everything to its right is junk.
          const locked = Math.floor(frame / 2);
          if (locked >= text.length) {
            setShown(text);
            clearInterval(timer);
            return;
          }
          setShown(
            text
              .split("")
              .map((c, i) =>
                i < locked || c === " " ? c : charset[Math.floor(Math.random() * charset.length)],
              )
              .join(""),
          );
        }, speed);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [text, speed, charset, reduced]);

  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{reduced ? text : shown}</span>
    </span>
  );
}

/* ── scroll-linked ───────────────────────────────────────────────── */

function wrap(min: number, max: number, v: number) {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
}

/**
 * Marquee whose speed and direction follow the scroll wheel: scrolling down
 * drives it faster, scrolling up flips it. Idle, it drifts at `baseVelocity`.
 *
 * Replaces the CSS-keyframe `.marquee` wherever the strip is worth noticing.
 */
export function ScrollVelocity({
  children,
  className,
  baseVelocity = 2.2,
  copies = 4,
}: {
  children: ReactNode;
  className?: string;
  /** Percent of the track travelled per second when the page is still. */
  baseVelocity?: number;
  copies?: number;
}) {
  const reduced = useReducedMotion();
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smooth = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
  // `clamp: false` lets a hard flick overshoot the mapped range, which is what
  // makes the strip feel physically connected to the wheel.
  const factor = useTransform(smooth, [0, 1000], [0, 4], { clamp: false });
  const x = useTransform(baseX, (v) => `${wrap(-50, 0, v)}%`);
  const direction = useRef(1);

  useAnimationFrame((_, delta) => {
    if (reduced) return;
    let moveBy = direction.current * baseVelocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) direction.current = -1;
    else if (f > 0) direction.current = 1;
    moveBy += direction.current * moveBy * Math.abs(f);
    baseX.set(baseX.get() + moveBy);
  });

  if (reduced) {
    return (
      <div className={cn("overflow-hidden", className)}>
        <div className="flex w-max">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("marquee", className)}>
      {/* Duplicated `copies` times and wrapped over half the track, so the seam
          is always off-screen no matter how wide the content is. */}
      <motion.div className="flex w-max will-change-transform" style={{ x }}>
        {Array.from({ length: copies }, (_, i) => (
          <div key={i} className="flex shrink-0 items-center" aria-hidden={i > 0}>
            {children}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Progressive blur at one edge of a scroll container — the content dissolves
 * instead of being chopped off by a hard mask.
 *
 * Built from a few stacked `backdrop-filter` layers, each masked to a narrower
 * band, because CSS has no gradient blur of its own.
 */
export function GradualBlur({
  side = "bottom",
  height = "6rem",
  strength = 2,
  position = "absolute",
  className,
}: {
  side?: "top" | "bottom";
  height?: string;
  /** Blur radius of the innermost layer, in px; layers step up from there. */
  strength?: number;
  /** `fixed` pins the veil to the viewport edge rather than the parent box. */
  position?: "absolute" | "fixed";
  className?: string;
}) {
  const layers = 5;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none inset-x-0 z-[4]",
        position === "fixed" ? "fixed" : "absolute",
        side === "bottom" ? "bottom-0" : "top-0",
        className,
      )}
      style={{ height }}
    >
      {Array.from({ length: layers }, (_, i) => {
        const from = (i / layers) * 100;
        const to = ((i + 1) / layers) * 100;
        const dir = side === "bottom" ? "to top" : "to bottom";
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${strength * (i + 1) ** 1.4}px)`,
              WebkitBackdropFilter: `blur(${strength * (i + 1) ** 1.4}px)`,
              maskImage: `linear-gradient(${dir}, rgba(0,0,0,1) ${from}%, rgba(0,0,0,0) ${to}%)`,
              WebkitMaskImage: `linear-gradient(${dir}, rgba(0,0,0,1) ${from}%, rgba(0,0,0,0) ${to}%)`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ── composite widgets ───────────────────────────────────────────── */

/**
 * A deck of cards where the front one cycles to the back on a timer, or when a
 * card behind is clicked. Good for showing three or four short things in the
 * space of one.
 */
export function CardSwap({
  items,
  className,
  interval = 4200,
  offset = 26,
  index,
  onIndexChange,
}: {
  items: { key: string; node: ReactNode }[];
  className?: string;
  /** ms between automatic swaps. Pass `0` for a deck that only moves on click. */
  interval?: number;
  /** px of x/y displacement between neighbouring cards in the stack. */
  offset?: number;
  /** Controlled front index. Omit to let the deck own it. */
  index?: number;
  onIndexChange?: (i: number) => void;
}) {
  const reduced = useReducedMotion();
  const [own, setOwn] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = items.length;
  const front = index ?? own;

  const goTo = (i: number) => {
    setOwn(i);
    onIndexChange?.(i);
  };

  useEffect(() => {
    // `interval <= 0` means the reader drives the deck. Text people are
    // actually reading — a quote, a testimonial — should not move under them.
    if (interval <= 0 || paused || reduced || n < 2) return;
    const id = setTimeout(() => {
      const next = (front + 1) % n;
      setOwn(next);
      onIndexChange?.(next);
    }, interval);
    return () => clearTimeout(id);
    // `onIndexChange` is intentionally out of the deps: callers routinely pass
    // an inline arrow, which would restart the timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front, paused, reduced, n, interval]);

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {items.map((it, i) => {
        // Depth measured forward from the front card, wrapping round the deck.
        const depth = (i - front + n) % n;
        const isFront = depth === 0;
        return (
          <motion.div
            key={it.key}
            className={cn("absolute inset-0", isFront ? "" : "cursor-pointer")}
            onClick={isFront ? undefined : () => goTo(i)}
            animate={{
              x: depth * offset,
              y: depth * -offset * 0.55,
              scale: 1 - depth * 0.055,
              rotate: depth * 1.6,
              opacity: depth > 2 ? 0 : 1,
            }}
            style={{ zIndex: n - depth }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", stiffness: 240, damping: 30, mass: 0.7 }
            }
            aria-hidden={!isFront}
          >
            {it.node}
          </motion.div>
        );
      })}
    </div>
  );
}

/**
 * macOS-style dock: icons swell as the cursor passes over them.
 *
 * Pointer-only by design — there is no cursor to magnify toward on a phone, so
 * on touch this renders as an ordinary row of targets at full tap size.
 */
export function Dock({
  items,
  className,
  size = 44,
  magnify = 22,
  radius = 120,
}: {
  items: { key: string; label: string; icon: ReactNode; active?: boolean; onSelect?: () => void }[];
  className?: string;
  /** Resting icon box size in px. */
  size?: number;
  /** Extra px at full magnification. */
  magnify?: number;
  /** Horizontal falloff distance in px. */
  radius?: number;
}) {
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY);
  return (
    <div
      className={cn("flex items-end gap-1.5", className)}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        mouseX.set(e.clientX);
      }}
      onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
    >
      {items.map(({ key, ...it }) => (
        <DockItem key={key} mouseX={mouseX} size={size} magnify={magnify} radius={radius} {...it} />
      ))}
    </div>
  );
}

function DockItem({
  mouseX,
  size,
  magnify,
  radius,
  label,
  icon,
  active,
  onSelect,
}: {
  mouseX: ReturnType<typeof useMotionValue<number>>;
  size: number;
  magnify: number;
  radius: number;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onSelect?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();

  const distance = useTransform(mouseX, (v) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return Number.POSITIVE_INFINITY;
    return Math.abs(v - (r.left + r.width / 2));
  });
  const target = useTransform(distance, [0, radius], [size + magnify, size], { clamp: true });
  const width = useSpring(target, { stiffness: 340, damping: 26, mass: 0.35 });

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-current={active}
      className="group relative grid shrink-0 place-items-center"
      style={{ height: size + magnify }}
    >
      <motion.span
        className={cn(
          "grid aspect-square place-items-center rounded-[var(--radius-pill)] transition-colors duration-200",
          active ? "bg-accent text-accent-fg shadow-[var(--shadow-accent)]" : "bg-wood text-muted group-hover:text-fg",
        )}
        style={reduced ? { width: size, height: size } : { width, height: width }}
      >
        {icon}
      </motion.span>
      <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--radius-pill)] bg-fg px-2 py-1 text-2xs text-bg opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

/**
 * Pill with a light travelling round its border. Reserved for the single most
 * important control on a screen — it stops meaning "look here" if it is used twice.
 */
export function StarBorder({
  children,
  className,
  innerClassName,
  speed = 5,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** Seconds per lap. */
  speed?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <span
      className={cn("star-border relative inline-block rounded-[var(--radius-pill)] p-px", className)}
      style={{ "--star-duration": `${speed}s`, "--star-id": id } as CSSProperties}
    >
      <span className={cn("relative z-[1] block rounded-[var(--radius-pill)]", innerClassName)}>
        {children}
      </span>
    </span>
  );
}

/**
 * Full-viewport click feedback: a short burst of lines radiating from the
 * pointer. Drawn on one shared canvas rather than per-element DOM nodes.
 *
 * Mounted once at the app root.
 */
export function ClickSpark({
  color = "#1f5c43",
  count = 8,
  length = 13,
  duration = 380,
}: {
  color?: string;
  count?: number;
  length?: number;
  duration?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const mounted = useMounted();

  useEffect(() => {
    if (reduced || !mounted) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let sparks: { x: number; y: number; angle: number; born: number }[] = [];
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const draw = (now: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      sparks = sparks.filter((s) => now - s.born < duration);
      for (const s of sparks) {
        const t = (now - s.born) / duration;
        // easeOutCubic on distance, linear fade — the burst reads as a pop.
        const eased = 1 - (1 - t) ** 3;
        const r0 = 6 + eased * length;
        const r1 = r0 + length * 0.55 * (1 - t);
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(s.angle) * r0, s.y + Math.sin(s.angle) * r0);
        ctx.lineTo(s.x + Math.cos(s.angle) * r1, s.y + Math.sin(s.angle) * r1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Park the loop entirely when nothing is on screen; this canvas covers the
      // whole viewport and must not cost a frame while the user is reading.
      raf = sparks.length ? requestAnimationFrame(draw) : 0;
    };

    const onClick = (e: MouseEvent) => {
      const now = performance.now();
      const jitter = Math.random() * Math.PI;
      for (let i = 0; i < count; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: jitter + (i / count) * Math.PI * 2, born: now });
      }
      if (!raf) raf = requestAnimationFrame(draw);
    };

    window.addEventListener("click", onClick);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [color, count, length, duration, reduced, mounted]);

  if (reduced || !mounted) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60]"
    />
  );
}

/* ── WebGL backgrounds ───────────────────────────────────────────── */

const Aurora = lazy(() => import("./gl").then((m) => ({ default: m.Aurora })));
const Silk = lazy(() => import("./gl").then((m) => ({ default: m.Silk })));
const Threads = lazy(() => import("./gl").then((m) => ({ default: m.Threads })));
const DotGrid = lazy(() => import("./gl").then((m) => ({ default: m.DotGrid })));

export type GLVariant = "aurora" | "silk" | "threads" | "dotgrid";

/**
 * Drops a live shader behind a section.
 *
 * The real work is deferred three ways, because a booking app cannot afford a
 * WebGL context on the critical path: `ogl` is a lazy chunk, the canvas only
 * mounts on the client, and it only renders while the section is near the
 * viewport. Reduced motion skips it entirely and falls back to `fallback`.
 */
export function GLBackground({
  variant,
  className,
  fallback,
  position = "absolute",
  ...props
}: {
  variant: GLVariant;
  className?: string;
  /** Static stand-in shown before load, off-screen, and under reduced motion. */
  fallback?: ReactNode;
  /** `fixed` pins the canvas to the viewport, for a whole-page field. */
  position?: "absolute" | "fixed";
  colors?: string[];
  color?: string;
  amplitude?: number;
  speed?: number;
  opacity?: number;
  scale?: number;
  gap?: number;
  dot?: number;
  radius?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const mounted = useMounted();
  const near = useNearViewport(ref);
  const live = mounted && near && !reduced;

  const Comp =
    variant === "aurora" ? Aurora : variant === "silk" ? Silk : variant === "threads" ? Threads : DotGrid;

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none inset-0 overflow-hidden",
        position === "fixed" ? "fixed" : "absolute",
        className,
      )}
    >
      {fallback}
      {live ? (
        <Suspense fallback={null}>
          <Comp {...props} />
        </Suspense>
      ) : null}
    </div>
  );
}
