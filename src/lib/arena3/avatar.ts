import { useEffect, useState } from "react";
import { getToken } from "./client";

type CacheEntry = { src: string; refs: number };
const cache = new Map<string, CacheEntry>();

/**
 * Hook to fetch and cache an avatar image blob URL with Bearer token authentication.
 *
 * Uses reference counting so identical avatar URLs share one object URL, and revokes
 * the object URL when all referencing components unmount.
 */
export function useAvatarSrc(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    const token = getToken();
    if (!token) {
      setSrc(null);
      return;
    }

    let active = true;
    let refCounted = false;
    const ac = new AbortController();

    const existing = cache.get(url);
    if (existing) {
      existing.refs += 1;
      refCounted = true;
      setSrc(existing.src);
    } else {
      (async () => {
        try {
          const res = await fetch(url, {
            headers: { authorization: `Bearer ${token}` },
            signal: ac.signal,
          });
          if (!res.ok) {
            if (active) setSrc(null);
            return;
          }
          const blob = await res.blob();
          if (!active) return;
          let entry = cache.get(url);
          if (!entry) {
            entry = { src: URL.createObjectURL(blob), refs: 0 };
            cache.set(url, entry);
          }
          entry.refs += 1;
          refCounted = true;
          setSrc(entry.src);
        } catch {
          if (active) setSrc(null);
        }
      })();
    }

    return () => {
      active = false;
      ac.abort();
      if (refCounted) {
        const entry = cache.get(url);
        if (entry) {
          entry.refs -= 1;
          if (entry.refs <= 0) {
            URL.revokeObjectURL(entry.src);
            cache.delete(url);
          }
        }
      }
    };
  }, [url]);

  return src;
}
