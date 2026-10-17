import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { SPORT_LABEL } from "@/lib/arena3/labels";
import { locale } from "@/lib/i18n";
import { useSportPhoto } from "./media";

export type SportInfo = {
  code: string;
  name?: string;
  name_en: string;
  name_vi: string;
  color_key: string;
};

function enrichSports(items: SportInfo[]): SportInfo[] {
  const isVi = locale() === "vi";
  return items.map((s) => ({
    ...s,
    name: s.name ?? (isVi ? s.name_vi : s.name_en),
  }));
}

const DEFAULT_SPORTS: SportInfo[] = [
  { code: "badminton", name_en: "Badminton", name_vi: "Cầu lông", color_key: "badminton", name: "Badminton" },
  { code: "basketball", name_en: "Basketball", name_vi: "Bóng rổ", color_key: "basketball", name: "Basketball" },
  { code: "volleyball", name_en: "Volleyball", name_vi: "Bóng chuyền", color_key: "volleyball", name: "Volleyball" },
];

// Temporary sports list; will be replaced when AGENT-SPORTS-MEDIA adds GET /v1/sports.
let cachedSports: SportInfo[] | null = null;
let fetchAttempted = false;

export function useSports(): SportInfo[] {
  const [sports, setSports] = useState<SportInfo[]>(() => cachedSports ?? enrichSports(DEFAULT_SPORTS));

  useEffect(() => {
    if (fetchAttempted) {
      if (cachedSports) setSports(cachedSports);
      return;
    }
    fetchAttempted = true;
    let cancelled = false;

    fetch("/v1/sports")
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ items?: SportInfo[] }>;
      })
      .then((data) => {
        if (data && Array.isArray(data.items) && data.items.length > 0) {
          const enriched = enrichSports(data.items);
          cachedSports = enriched;
          if (!cancelled) setSports(enriched);
        }
      })
      .catch(() => {
        // Silent catch: endpoint does not exist yet (404/network error), no retry or logging
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return sports;
}

export function SportDot({
  sport,
  className,
}: {
  sport?: string | null;
  className?: string;
}) {
  const code = (sport || "badminton").toLowerCase();
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 rounded-full shrink-0", className)}
      style={{
        backgroundColor: `var(--color-sport-${code}, var(--color-accent))`,
      }}
    />
  );
}

export function SportBadge({
  sport,
  className,
  showDot = true,
}: {
  sport?: string | null;
  className?: string;
  showDot?: boolean;
}) {
  const code = (sport || "badminton").toLowerCase();
  const label = SPORT_LABEL[code] ?? code;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-line bg-surface/80 px-2 py-0.5 text-2xs font-medium text-fg shadow-[var(--shadow-border)]",
        className,
      )}
    >
      {showDot ? <SportDot sport={code} /> : null}
      <span>{label}</span>
    </span>
  );
}

export function SportThumbnail({
  sport,
  className,
  alt,
}: {
  sport?: string | null;
  className?: string;
  alt?: string;
}) {
  const code = (sport || "badminton").toLowerCase();
  const asset = useSportPhoto(code);
  const label = SPORT_LABEL[code] ?? code;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-wood/50",
        className,
      )}
    >
      {asset.enabled && asset.url ? (
        <img
          src={asset.url}
          alt={alt || label}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-bold text-2xs uppercase text-white"
          style={{
            backgroundColor: `var(--color-sport-${code}, var(--color-accent))`,
          }}
        >
          {code.slice(0, 2)}
        </div>
      )}
    </div>
  );
}
