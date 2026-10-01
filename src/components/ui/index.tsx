import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate, statusLabel, statusTone } from "@/lib/arena3/labels";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_SMOOTH } from "../motion";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "ink";
  size?: "md" | "sm" | "lg";
}) {
  const base =
    "sweep inline-flex items-center justify-center gap-2 font-medium tracking-tight transition-[opacity,transform,background-color,box-shadow,color] duration-200 ease-[var(--ease-smooth)] disabled:opacity-50 disabled:pointer-events-none active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
  // Fully-rounded: a pill reads as "pressable" at a glance and is the one shape
  // that never fights the square data tables and court grids around it.
  const sizes = {
    lg: "min-h-13 rounded-[var(--radius-pill)] px-7 text-[0.95rem]",
    md: "min-h-11 rounded-[var(--radius-pill)] px-5 text-sm",
    sm: "min-h-9 rounded-[var(--radius-pill)] px-4 text-xs",
  };
  const styles = {
    primary:
      "bg-accent text-accent-fg shadow-[var(--shadow-accent)] hover:bg-accent-2 hover:shadow-[var(--shadow-accent-lg)] hover:-translate-y-px",
    ink: "bg-fg text-bg hover:opacity-90 hover:-translate-y-px",
    outline:
      "border border-line bg-surface text-fg shadow-[var(--shadow-border)] hover:bg-wood hover:border-line-strong",
    ghost: "text-fg hover:bg-wood",
    danger: "bg-danger text-bg hover:opacity-90",
  } as const;
  return <button className={cn(base, sizes[size], styles[variant], className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle outline-none transition-[box-shadow] duration-150 focus:ring-2 focus:ring-accent/30",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Native date picker with a readable "17 Sep 2026" overlay (Chromium ignores html lang).
 *
 * The input is transparent rather than hidden, which is what makes the overlay
 * possible — but it also means the only thing that opens the calendar natively
 * is the invisible icon glyph in its corner. Clicking anywhere else on the
 * field did nothing at all, which is exactly how the Reports "Custom from/to"
 * pair came to look broken. `showPicker()` on a click over the whole box is
 * what restores the obvious behaviour, with a real icon so there is something
 * to aim at.
 */
export function DateField({
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel = "Pick a date",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const open = () => {
    const el = ref.current;
    if (!el || disabled) return;
    el.focus();
    // Safari and older Firefox have no `showPicker`; there the focus above plus
    // the native field is all we can offer, and typing still works.
    try {
      el.showPicker?.();
    } catch {
      // Chrome throws if the call is not considered user-initiated. Focus stands.
    }
  };

  return (
    <div
      role="presentation"
      onClick={open}
      className={cn(
        "relative flex h-11 min-w-[11rem] items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-3 transition-[border-color,box-shadow] duration-150",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:border-line-strong focus-within:ring-2 focus-within:ring-accent/30",
        className,
      )}
    >
      <span className="pointer-events-none flex-1 truncate text-sm tabular-nums text-fg">
        {value ? formatDate(value) : <span className="text-subtle">Pick a date</span>}
      </span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none size-4 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
      <input
        ref={ref}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        // Still stretched over the whole field so keyboard focus lands on the
        // real control, but `opacity-0` means the overlay above is what shows.
        className="absolute inset-0 size-full cursor-pointer rounded-[var(--radius-sm)] opacity-0 disabled:cursor-not-allowed"
      />
    </div>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 w-full appearance-none rounded-[var(--radius-sm)] border border-line bg-surface bg-[length:12px] bg-[right_12px_center] bg-no-repeat px-3 pr-9 text-sm text-fg outline-none transition-[box-shadow] duration-150 focus:ring-2 focus:ring-accent/30",
        className,
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%235f6759' stroke-width='1.75' viewBox='0 0 24 24'><path d='m6 9 6 6 6-6'/></svg>")`,
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle outline-none focus:ring-2 focus:ring-accent/30",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("kicker text-2xs text-muted", className)} {...props} />;
}

export function Card({
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] bg-surface p-5 shadow-[var(--shadow-border)]",
        interactive &&
          "transition-[transform,box-shadow] duration-300 ease-[var(--ease-smooth)] hover:-translate-y-1 hover:shadow-[var(--shadow-soft)]",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "ink",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "ink" | "accent" | "hold" | "muted" | "danger" }) {
  const map = {
    ink: "bg-fg text-bg",
    accent: "bg-accent/12 text-accent-2",
    hold: "bg-hold/12 text-hold",
    muted: "bg-wood text-muted",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums",
        map[tone],
        className,
      )}
      {...props}
    />
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

export function Field({
  label,
  children,
  hint,
  tone = "danger",
}: {
  label: string;
  children: ReactNode;
  /** Validation message or helper text shown under the control. */
  hint?: string;
  tone?: "danger" | "muted";
}) {
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? (
        <span className={cn("text-xs", tone === "danger" ? "text-danger" : "text-muted")}>{hint}</span>
      ) : null}
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-md)] bg-wood", className)}>
      <div className="shimmer absolute inset-0" />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-[var(--radius-xl)] border border-dashed border-line-strong/70 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

export function Seg({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const group = useId();
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-wrap gap-1 rounded-[var(--radius-pill)] bg-wood p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value || "all"}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "relative min-h-9 rounded-[var(--radius-pill)] px-4 text-sm font-medium transition-colors duration-200",
              active ? "text-accent-fg" : "text-muted hover:text-fg",
            )}
          >
            {/* Sliding pill travels between options instead of blinking on. */}
            {active ? (
              reduced ? (
                <span className="absolute inset-0 rounded-[var(--radius-pill)] bg-accent" />
              ) : (
                <motion.span
                  layoutId={`seg-${group}`}
                  className="absolute inset-0 rounded-[var(--radius-pill)] bg-accent shadow-[var(--shadow-accent)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )
            ) : null}
            <span className="relative z-[1]">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Portals need a document, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes the dialog, and the page behind it stops scrolling while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  /*
   * Portalled to <body>, not rendered where it is written.
   *
   * A `position: fixed` element inside an ancestor that has a transform is
   * positioned against that ancestor instead of the viewport, and its stacking
   * is trapped there too. Every card on this app is inside an animated
   * wrapper, so a dialog opened from one was painted underneath the page
   * furniture around it — the payments filter row sat on top of the QR code a
   * customer was being asked to scan.
   *
   * `mounted` keeps this off the server render, where there is no document.
   */
  const body = mounted ? document.body : null;

  const dialog = (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <motion.button
            type="button"
            className="absolute inset-0 bg-fg/40 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className="relative mx-auto mt-[8vh] max-h-[84dvh] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-[var(--radius-xl)] bg-surface p-5 shadow-[var(--shadow-soft)]"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.28, ease: EASE_SMOOTH }}
          >
            <h2 id="modal-title" className="font-display text-2xl">
              {title}
            </h2>
            <div className="mt-4">{children}</div>
            {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  return body ? createPortal(dialog, body) : null;
}

/**
 * How a figure moved against the period before it.
 *
 * `good` is carried rather than derived from the sign, because whether "up" is
 * good news depends entirely on what is being counted. Revenue climbing is the
 * centre doing well; refunds climbing is the centre doing badly. Painting both
 * green for going up would tell a manager the opposite of what happened.
 */
export type Trend = {
  /** Percent change, or null when there was nothing to compare against. */
  pct: number | null;
  label: string;
  /** null when the figure did not move, or when the direction carries no verdict. */
  good: boolean | null;
};

export function Stat({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: Trend;
}) {
  const Arrow =
    trend?.pct == null || trend.pct === 0 ? Minus : trend.pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card>
      <p className="kicker text-2xs text-muted">{label}</p>
      <p className="figure mt-2.5 text-4xl">{value}</p>
      {trend ? (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1 text-sm font-medium",
            trend.good === true && "text-accent",
            trend.good === false && "text-danger",
            trend.good == null && "text-muted",
          )}
        >
          <Arrow className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          {trend.label}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-muted">{hint}</p>
      ) : null}
    </Card>
  );
}
