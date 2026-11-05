import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, type SessionUser } from "@/lib/arena3/client";
import { t, useLang } from "@/lib/i18n";

type GoogleId = {
  initialize(opts: { client_id: string; callback: (r: { credential?: string }) => void }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** What `/register` needs to finish a Google sign-up: the token, and what Google told us. */
export type GoogleSignup = { credential: string; email: string; full_name: string };
const SIGNUP_KEY = "arena3.googleSignup";

// Session storage, not the URL: the token proves who someone is for an hour,
// and a URL ends up in history, logs and Referer headers.
export function stashGoogleSignup(s: GoogleSignup) {
  try {
    sessionStorage.setItem(SIGNUP_KEY, JSON.stringify(s));
  } catch {
    /* private mode: the register page falls back to the ordinary form */
  }
}
export function readGoogleSignup(): GoogleSignup | null {
  try {
    const raw = sessionStorage.getItem(SIGNUP_KEY);
    return raw ? (JSON.parse(raw) as GoogleSignup) : null;
  } catch {
    return null;
  }
}
export function clearGoogleSignup() {
  try {
    sessionStorage.removeItem(SIGNUP_KEY);
  } catch {
    /* nothing to clear */
  }
}
let gisLoad: Promise<void> | null = null;

/** Google Identity Services, loaded once per page and only where the button is shown. */
function loadGis(): Promise<void> {
  gisLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoad = null;
      reject(new Error("gis"));
    };
    document.head.appendChild(s);
  });
  return gisLoad;
}

/**
 * Google's own "Sign in with Google" button. It renders nothing until the
 * server says a client id is set, so the sign-in page looks the same as before
 * on a machine without one. The ID token goes to `/auth/google`: an existing
 * account signs in, and a new email comes back as `signup`, which is stashed
 * for `/register` to finish (see `handlers/google.ts`).
 */
export function GoogleSignIn({
  onSignedIn,
  onNeedsSignup,
  onError,
}: {
  onSignedIn: (res: { token: string; user: SessionUser }) => void;
  onNeedsSignup: (s: GoogleSignup) => void;
  onError: (err: unknown) => void;
}) {
  const lang = useLang();
  const box = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  // The latest handlers, so the one-time Google callback never calls a stale closure.
  const handlers = useRef({ onSignedIn, onNeedsSignup, onError });
  handlers.current = { onSignedIn, onNeedsSignup, onError };

  useEffect(() => {
    let live = true;
    apiGet<{ client_id: string | null }>("/auth/google", { background: true })
      .then((r) => live && setClientId(r.client_id))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    loadGis()
      .then(() => {
        const id = window.google?.accounts.id;
        if (!live || !id || !box.current) return;
        id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              const res = await apiPost<
                { token: string; user: SessionUser } | { signup: { email: string; full_name: string } }
              >("/auth/google", { credential });
              if ("signup" in res) {
                const s = { credential: credential!, ...res.signup };
                stashGoogleSignup(s);
                handlers.current.onNeedsSignup(s);
              } else {
                handlers.current.onSignedIn(res);
              }
            } catch (e) {
              handlers.current.onError(e);
            }
          },
        });
        box.current.replaceChildren();
        id.renderButton(box.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: box.current.clientWidth || 320,
          locale: lang,
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clientId, lang]);

  if (!clientId) return null;
  return (
    <div className="mt-4 grid gap-3">
      <div className="flex items-center gap-3 text-2xs text-muted">
        <span className="h-px flex-1 bg-line" />
        {t("or")}
        <span className="h-px flex-1 bg-line" />
      </div>
      <div ref={box} className="flex min-h-11 w-full justify-center" />
    </div>
  );
}
