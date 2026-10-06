import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { setPaused, useCalmState } from "@/lib/calm";
import { t } from "@/lib/i18n";

/**
 * Stops everything that moves on its own, and starts it again (WCAG 2.2.2). The label says what the
 * next press does, like a video player's, so it never has to be decoded.
 *
 * It is not drawn when the device already asks for reduced motion: there is nothing left to pause.
 * `row` is the full-width version for a menu; the default is a round icon button for a header.
 */
export function CalmToggle({ row = false, className }: { row?: boolean; className?: string }) {
  const state = useCalmState();
  if (state === "system") return null;
  const paused = state === "paused";
  const label = paused ? t("Play animations") : t("Pause animations");
  const Icon = paused ? Play : Pause;
  if (row) {
    return (
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left text-sm transition-colors duration-150 hover:bg-wood",
          className,
        )}
      >
        <Icon aria-hidden="true" className="size-4 text-muted" strokeWidth={1.75} />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setPaused(!paused)}
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-full shadow-[var(--shadow-border)] transition-colors sm:size-9",
        paused ? "bg-accent text-white" : "bg-surface text-muted hover:text-fg",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
    </button>
  );
}
