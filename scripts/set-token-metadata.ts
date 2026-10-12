// Attaches a name and symbol to the VCR mint via Metaplex Token Metadata
// (CreateMetadataAccountV3), or updates them if already set (UpdateMetadataAccountV2).
//
//   node scripts/set-token-metadata.ts
//
// Payer and update authority: keys/admin.json. Mint authority: keys/mint-authority.json.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const NAME = "Veleda Credit";
const SYMBOL = "VCR";
const URI = ""; // JSON with an image, once there's somewhere public to host it

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const load = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
const admin = load("keys/admin.json");
const mintAuthority = load("keys/mint-authority.json");
const mint = load("keys/token-mint.json").publicKey;
const conn = new Connection(RPC, "confirmed");

const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM);

const str = (s: string) => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
// DataV2 { name, symbol, uri, seller_fee_basis_points: u16, creators: None, collection: None, uses: None }
const dataV2 = Buffer.concat([str(NAME), str(SYMBOL), str(URI), Buffer.from([0, 0]), Buffer.from([0, 0, 0])]);

const exists = (await conn.getAccountInfo(metadata)) !== null;
const ix = exists
  ? new TransactionInstruction({
      // UpdateMetadataAccountV2 = 15: Some(data), update_authority: None, primary_sale_happened: None, is_mutable: Some(true)
      programId: METADATA_PROGRAM,
      keys: [
        { pubkey: metadata, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([15, 1]), dataV2, Buffer.from([0, 0, 1, 1])]),
    })
  : new TransactionInstruction({
      // CreateMetadataAccountV3 = 33: data, is_mutable: true, collection_details: None
      programId: METADATA_PROGRAM,
      keys: [
        { pubkey: metadata, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mintAuthority.publicKey, isSigner: true, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([33]), dataV2, Buffer.from([1, 0])]),
    });

const signers = exists ? [admin] : [admin, mintAuthority];
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), signers, { commitment: "confirmed" });
console.log(`${exists ? "updated" : "created"} metadata ${metadata.toBase58()}: ${sig}`);

// Read it back: key (1) + update authority (32) + mint (32), then name, symbol, uri (padded strings).
const acc = (await conn.getAccountInfo(metadata))!.data;
let o = 65;
const read = () => { const n = acc.readUInt32LE(o); const s = acc.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, ""); o += 4 + n; return s; };
console.log(`on-chain: name "${read()}", symbol "${read()}", uri "${read()}"`);
