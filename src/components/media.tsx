import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { media, sportPhoto } from "@/lib/arena3/media";
import { CourtBackdrop } from "./mark";

export { media, sportPhoto };

export function Cover({
  src,
  alt,
  className,
  imgClassName,
  scrim = "auto",
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  scrim?: "auto" | "media" | "hero" | "none";
  children?: ReactNode;
}) {
  const showScrim = scrim === "media" || scrim === "hero" || (scrim === "auto" && children != null);
  return (
    <div className={cn("relative overflow-hidden bg-wood", className)}>
      <img src={src} alt={alt} className={cn("absolute inset-0 z-0 size-full object-cover", imgClassName)} />
      {showScrim ? (
        <div
          className={cn("pointer-events-none absolute inset-0 z-[1]", scrim === "hero" ? "hero-scrim" : "media-scrim")}
        />
      ) : null}
      {children ? <div className="relative z-[2] size-full">{children}</div> : null}
    </div>
  );
}

/** Solid 82% ink bar — captions never sit on the photo itself (Stitch/WCAG). */
export function MediaCaption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("absolute inset-x-0 bottom-0 caption-bar px-4 py-3", className)}>{children}</div>;
}

export function PassCard({
  plan,
  sport,
  endOn,
  hours,
  code,
}: {
  plan: string;
  sport: string;
  endOn: string;
  hours: number;
  code?: string | null;
}) {
  return (
    <article className="group relative overflow-hidden rounded-[var(--radius-xl)] bg-pass p-6 text-pass-fg transition-transform duration-300 hover:-translate-y-0.5">
      <span className="sweep pointer-events-none absolute inset-0" aria-hidden />
      {/* Masked from the bottom-right corner outwards. The court is taller than
          the card, so without it the drawing is cropped top and bottom and its
          two long vertical lines run the full height of the pass — reading as
          a pair of stray rules through the card rather than as a watermark. */}
      <CourtBackdrop
        className="pointer-events-none absolute -right-10 -bottom-8 h-56 w-56 text-pass-fg opacity-[0.16] [mask-image:radial-gradient(120%_115%_at_100%_100%,#000_18%,transparent_70%)]"
      />
      <div className="relative flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-block rounded-[var(--radius-sm)] border border-pass-fg/20 bg-accent px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-accent-fg">
              Membership pass
            </span>
            <p className="mt-3 font-display text-2xl tracking-tight">{plan}</p>
          </div>
          {code ? (
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-pass-muted">Member code</p>
              <p className="font-mono text-sm font-semibold tracking-wider">{code}</p>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-pass-fg/15 pt-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-pass-muted">Sport</p>
            <p className="mt-0.5 text-sm font-semibold">{sport}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-pass-muted">Court hours</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{hours} left</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-pass-muted">Valid through</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{endOn}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * A muted, looping background video that only fetches once it is near the
 * viewport — and never before the page has painted.
 *
 * The landing page carries two of these, 8 MB of MP4 between them. With a plain
 * `<video src>` the browser starts both during the initial load, on the same
 * connection as the JS and CSS the page actually needs to become interactive;
 * on a slow link that is the whole "why is it still loading" feeling. Holding
 * `src` back until the element is observed costs nothing visually, because the
 * poster is the same frame the video opens on.
 *
 * `rootMargin` is generous so the hero — which is on screen from the start —
 * begins fetching immediately after hydration rather than after a scroll.
 */
export function HeroVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // Watch the wrapper, not the video. These sit `absolute inset-0` inside a
    // `Cover`, and a source-less `<video>` has no intrinsic size, so its own box
    // frequently measures zero on one axis — height, usually, since the width
    // comes from the wrapper. An element with no *area* never intersects
    // anything, so observing it directly means the video silently never loads.
    // Both axes have to be checked: testing width alone stops the walk on a
    // 313×0 box that can never fire. Climb to the first ancestor that really
    // occupies space, and if somehow nothing does, load rather than leave a
    // poster frozen on screen.
    const empty = (n: HTMLElement) => {
      const r = n.getBoundingClientRect();
      return r.width === 0 || r.height === 0;
    };
    let target: HTMLElement = el;
    while (empty(target) && target.parentElement) {
      target = target.parentElement;
    }
    if (empty(target)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [near]);

  return (
    <video
      ref={ref}
      className={cn("absolute inset-0 size-full object-cover", className)}
      // Attaching `src` is what starts the download, so it stays off until the
      // observer fires. The poster is painted either way.
      src={near ? src : undefined}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
    />
  );
}

function secsLeft(until: string) {
  return Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
}

/**
 * A hold, drawn as something running out.
 *
 * "We hold it for five minutes" is a promise the interface has to keep
 * visibly: a member who cannot see the time left does not know whether the
 * court is theirs, so they either rush a decision they should think about or
 * sit on an expired hold believing they are safe. The bar is the honest part —
 * a number counting down is read as a warning only once you are already
 * reading it, while a draining bar is seen without looking.
 *
 * The total is measured at mount rather than assumed to be five minutes, so
 * this stays right if the centre changes the hold window.
 */
export function HoldProgress({
  until,
  onExpire,
  className,
}: {
  until: string;
  onExpire?: () => void;
  className?: string;
}) {
  const [left, setLeft] = useState(() => secsLeft(until));
  const total = useRef(0);
  const fired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    fired.current = false;
    total.current = Math.max(1, secsLeft(until));
    const tick = () => {
      const n = secsLeft(until);
      setLeft(n);
      if (n <= 0 && !fired.current) {
        fired.current = true;
        expireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [until]);

  const pct = Math.max(0, Math.min(100, (left / (total.current || 1)) * 100));
  // The last minute is the one where a member needs to be told, not informed.
  const urgent = left <= 60;
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="kicker text-2xs text-muted">
          {urgent ? "Hold expiring" : "Holding your court"}
        </span>
        <span
          className={`font-display text-xl tabular-nums ${urgent ? "text-danger" : "text-accent-2"}`}
          role="timer"
          aria-live={urgent ? "polite" : "off"}
        >
          {m}:{s}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wood">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-linear ${
            urgent ? "bg-danger" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function HoldTimer({ until, onExpire }: { until: string; onExpire?: () => void }) {
  const [left, setLeft] = useState(() => secsLeft(until));
  const fired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  useEffect(() => {
    fired.current = false;
    const tick = () => {
      const n = secsLeft(until);
      setLeft(n);
      if (n <= 0 && !fired.current) {
        fired.current = true;
        expireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [until]);
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <span className="tabular-nums">
      {m}:{s}
    </span>
  );
}
