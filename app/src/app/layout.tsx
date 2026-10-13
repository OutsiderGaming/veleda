import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const cinzel = localFont({ src: "../fonts/Cinzel-Variable.ttf", variable: "--font-cinzel", display: "swap" });
const manrope = localFont({ src: "../fonts/Manrope-Variable.ttf", variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Veleda · the market of seers",
  description: "Call when it happens. Buy any window of time in one swipe; cash out whenever you like.",
  appleWebApp: { capable: true, title: "Veleda", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0d0f0e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${manrope.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
