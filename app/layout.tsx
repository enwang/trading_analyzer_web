import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { VersionChecker } from "@/components/version-checker";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ScrollTapGuard } from "@/components/scroll-tap-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Journal",
  description: "Personal trading analytics dashboard",
  appleWebApp: {
    capable: true,
    title: "Trading Journal",
    statusBarStyle: "black-translucent",
  },
};

// Without a theme-color, iOS tints the status-bar area as a light surface and
// flips the clock to dark text. Pin it to the app's own colors (dark variant
// matches the manifest theme_color) so the status bar clock stays white like
// in other apps.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <VersionChecker />
          <ServiceWorkerRegister />
          <ScrollTapGuard />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
