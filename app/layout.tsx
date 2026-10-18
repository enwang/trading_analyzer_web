import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { VersionChecker } from "@/components/version-checker";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
