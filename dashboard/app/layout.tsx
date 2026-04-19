import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { SSEProvider } from "@/components/layout/sse-provider";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mink — Command Center",
  description: "Real-time dashboard for Mink token intelligence",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable}`} data-theme="dark" data-accent="green" data-density="compact" data-live="on" data-daemon="offline">
        <ThemeProvider
          attribute="data-theme"
          value={{ light: "light", dark: "dark" }}
          defaultTheme="dark"
          enableSystem
          storageKey="mink-theme"
        >
          <SSEProvider />
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
