import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "Veleda", description: "The market of seers" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
