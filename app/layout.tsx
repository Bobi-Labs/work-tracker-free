import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import { ThemeProvider } from "./theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* "No network calls" is enforced, not promised: connect-src 'none'
            makes the BROWSER reject any fetch/XHR/WebSocket this page ever
            attempts, and anyone can read this tag in view-source. React 19
            hoists the meta into <head> at prerender time. Production only —
            dev needs the HMR websocket.

            This meta deliberately carries ONLY connect-src; the hosted
            deployment's response header (vercel.json) additionally locks
            img/font/media/object/frame down to the app itself, closing the
            `new Image().src` class of beacon. The split exists because the
            meta must be safe for EVERY host (file://, USB stick, someone's
            weird intranet), while the header can be strict for ours. Keep
            copy that describes the CSP scoped to what each layer does. */}
        {process.env.NODE_ENV === "production" && (
          <meta
            httpEquiv="Content-Security-Policy"
            content="connect-src 'none'"
          />
        )}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          // "dim" is the mid-tone third theme. Its class gets its own token
          // block in globals.css, and the `dark` Tailwind variant is widened
          // to match it — see the @custom-variant note there.
          themes={["light", "dim", "dark"]}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
