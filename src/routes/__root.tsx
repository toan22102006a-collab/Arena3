import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { ClickSpark } from "@/components/fx";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Arena3";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      // The same green the manifest and the palette use. It was a lighter one
      // here, so the phone chrome did not match the header it sat above.
      { name: "theme-color", content: "#1f5c43" },
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
        href: "https://fonts.googleapis.com/css2?family=Anton&family=Be+Vietnam+Pro:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700&display=swap",
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
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AuthProvider>
          {/* One shared canvas for click feedback across every route; it parks
              its rAF loop whenever there is nothing left to draw. */}
          <ClickSpark />
          <Outlet />
          <Toaster
            position="top-center"
            offset={72}
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
