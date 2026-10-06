import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { useRetryKey } from "@/lib/connection";
import { LangProvider, t } from "@/lib/i18n";
import { ClickSpark } from "@/components/fx";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Arena3";

// Its own component so `t()` runs when the language remounts it, not once in the root render.
function SkipLink() {
  return (
    <a href="#main-content" className="skip-link">
      {t("Skip to main content")}
    </a>
  );
}

// "Reload page" on the connection banner bumps this key, which remounts whatever page is showing so
// it asks for its data again. Without it a page whose first request failed keeps its grey blocks.
function RetryOutlet() {
  return <Outlet key={useRetryKey()} />;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      // The same green the manifest and the palette use. It was a lighter one
      // here, so the phone chrome did not match the header it sat above.
      { name: "theme-color", content: "#1e4fd8" },
      {
        name: "description",
        content:
          "Arena3 — one sports centre, one schedule: memberships, classes, court hire and the front desk.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      // The stylesheet and the font files come from two different hosts, so
      // without these the browser opens the second connection only after it has
      // parsed the first response. That delay is the flash of fallback type
      // every heading does on a cold load — the page is not badly set, it is
      // briefly set in the wrong faces.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap",
      },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          {/* One shared canvas for click feedback across every route; it parks
              its rAF loop whenever there is nothing left to draw. */}
          <LangProvider>
            <SkipLink />
            <ClickSpark />
            <RetryOutlet />
          </LangProvider>
          {/* Below the 56px header on both sizes: sonner's phone default of 16px sat on top of it, and
              six seconds rather than four, because a refused payment is a line to read twice. */}
          <Toaster
            position="top-center"
            offset={72}
            mobileOffset={{ top: 68, left: 16, right: 16 }}
            duration={6000}
            visibleToasts={3}
            toastOptions={{
              className: "font-sans",
              style: {
                background: "var(--color-surface)",
                color: "var(--color-fg)",
                border: "1px solid var(--color-line)",
              },
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
