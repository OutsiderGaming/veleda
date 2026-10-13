Devnet keypairs live here and are gitignored. Expected files: `admin.json`, `fee-payer.json`, `mint-authority.json`, `bot-payer.json` (pays the trader bots' fees and rent; its key and the bot wallets in `bots/` are also GitHub Actions secrets, see `.github/workflows/bots.yml`).

Create one with `solana-keygen new -o keys/admin.json`, then fund it with `solana airdrop 2 $(solana-keygen pubkey keys/admin.json) --url devnet` or the web faucet.
