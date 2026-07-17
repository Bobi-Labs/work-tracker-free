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
