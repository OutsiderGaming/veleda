"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "google"],
        appearance: { theme: "dark", accentColor: "#E9A867", walletChainType: "solana-only" },
        // Create a Solana wallet silently at sign-in, and sign without a confirmation pop-up.
        embeddedWallets: { solana: { createOnLogin: "all-users" }, ethereum: { createOnLogin: "off" }, showWalletUIs: false },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
