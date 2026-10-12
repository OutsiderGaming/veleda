import type { NextConfig } from "next";
import { loadRootEnv } from "./load-root-env";

loadRootEnv();

const config: NextConfig = {
  // Inline the public values from the root .env into the browser bundle.
  env: { NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "" },
};

export default config;
