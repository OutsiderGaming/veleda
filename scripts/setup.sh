#!/usr/bin/env bash
# One-command setup: npm run setup            (Node only; your own markets on the deployed program)
#                    npm run setup -- --own   (also builds and deploys your own copy of the program)
# Safe to re-run: every step skips what's already done, so after a faucet limit just run it again.
set -euo pipefail
cd "$(dirname "$0")/.."

OWN=""
case "${1:-}" in
  "") ;;
  --own) OWN="--own" ;;
  *) echo "usage: npm run setup [-- --own]"; exit 1 ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. $2"; exit 1; }; }
need node "Install Node.js 23.6 or later: https://nodejs.org"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 23 || (a === 23 && b >= 6) ? 0 : 1)' \
  || { echo "Node $(node -v) is too old: Veleda's scripts need 23.6 or later."; exit 1; }
if [ -n "$OWN" ]; then
  need cargo "Install Rust 1.99: https://rustup.rs"
  need solana "Install the Solana CLI 3.1 (Agave): https://solana.com/docs/intro/installation"
  need anchor "Install Anchor CLI 1.1 with avm: https://www.anchor-lang.com/docs/installation"
fi

echo "1. Installing dependencies"
npm install --no-audit --no-fund --loglevel=error
(cd app && npm install --no-audit --no-fund --loglevel=error)

echo "2. Keys and devnet SOL"
node scripts/setup.ts fund $OWN

if [ -n "$OWN" ]; then
  echo "3. Your own program"
  NEW=$(solana-keygen pubkey keys/veleda-program.json)
  OLD=$(sed -n 's/^export const PROGRAM_ID = new PublicKey("\([1-9A-HJ-NP-Za-km-z]*\)");/\1/p' scripts/lib/veleda.ts)
  if [ "$NEW" != "$OLD" ]; then
    for f in Anchor.toml programs/veleda/src/lib.rs scripts/lib/veleda.ts app/src/lib/veleda/program.ts; do
      sed -i.bak "s/$OLD/$NEW/g" "$f" && rm "$f.bak"
    done
    echo "  program address set to $NEW in Anchor.toml, lib.rs, scripts/lib/veleda.ts and app/src/lib/veleda/program.ts"
  fi
  URL="${SOLANA_RPC_URL:-devnet}"
  if solana program show "$NEW" -u "$URL" >/dev/null 2>&1; then
    echo "  already deployed at $NEW (run anchor build and solana program deploy yourself to upgrade it)"
  else
    anchor build
    solana program deploy target/deploy/veleda.so --program-id keys/veleda-program.json --keypair keys/admin.json -u "$URL"
  fi
fi

echo "$([ -n "$OWN" ] && echo 4 || echo 3). Test money, markets and bots"
node scripts/setup.ts chain
