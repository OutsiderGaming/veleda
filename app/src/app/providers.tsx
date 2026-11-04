"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { MarketsProvider } from "@/lib/client/markets";
import { PreviewProvider } from "@/lib/client/preview";
import { SessionProvider } from "@/lib/client/session";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethodsAndOrder: { primary: ["google", "email"] },
        appearance: { theme: "dark", accentColor: "#E9A867", walletChainType: "solana-only" },
        // Create a Solana wallet silently at sign-in, and sign without a confirmation pop-up.
        embeddedWallets: { solana: { createOnLogin: "all-users" }, ethereum: { createOnLogin: "off" }, showWalletUIs: false },
      }}
    >
      <SessionProvider>
        <PreviewProvider>
          <MarketsProvider>{children}</MarketsProvider>
        </PreviewProvider>
      </SessionProvider>
    </PrivyProvider>
  );
}
