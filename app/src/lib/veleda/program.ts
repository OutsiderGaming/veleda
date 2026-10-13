// Veleda program instructions for @solana/kit. Account order and
// discriminators come from the program's IDL (target/idl/veleda.json).
import {
  AccountRole, address, getAddressEncoder, getProgramDerivedAddress,
  type AccountMeta, type AccountSignerMeta, type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export const PROGRAM_ID = address("7be7tgXwK46Yu9AWqes8g5FBvBjjBqvxJFVhP1io37hx");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const DISCRIMINATORS = {
  buy_range: [215, 161, 26, 221, 135, 18, 12, 208],
  sell_range: [197, 21, 116, 225, 52, 98, 182, 181],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  advance_time: [58, 85, 148, 20, 119, 39, 172, 79],
} as const;

const enc = getAddressEncoder();
const pda = async (...seeds: (string | Address)[]) =>
  (await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: seeds.map((s, i) => (i === 0 ? s : enc.encode(s as Address))),
  }))[0];

export const vaultPda = (market: Address) => pda("vault", market);
export const authorityPda = (market: Address) => pda("authority", market);
export async function positionPda(market: Address, owner: Address, nonce: bigint): Promise<Address> {
  const [p] = await getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: ["position", enc.encode(market), enc.encode(owner), u64(nonce)] });
  return p;
}

const w = (a: Address): AccountMeta => ({ address: a, role: AccountRole.WRITABLE });
const r = (a: Address): AccountMeta => ({ address: a, role: AccountRole.READONLY });
const signer = (s: TransactionSigner, writable = false): AccountSignerMeta => ({
  address: s.address, role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER, signer: s,
});

function ix(name: keyof typeof DISCRIMINATORS, accounts: (AccountMeta | AccountSignerMeta)[], ...args: Uint8Array[]): Instruction {
  const data = new Uint8Array([...DISCRIMINATORS[name], ...args.flatMap((a) => [...a])]);
  return { programAddress: PROGRAM_ID, accounts, data };
}

const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const u64 = (v: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };

export interface MarketRef { market: Address; mint: Address }

/** buy_range: `owner` signs as token owner; `feePayer` pays the position's rent. */
export async function buyRange(m: MarketRef, owner: TransactionSigner, feePayer: TransactionSigner, ownerToken: Address,
  a: { nonce: bigint; from: number; to: number; shares: number; maxCost: number }): Promise<Instruction> {
  return ix("buy_range", [
    signer(owner), signer(feePayer, true), w(m.market), w(await positionPda(m.market, owner.address, a.nonce)), r(m.mint),
    w(await vaultPda(m.market)), w(ownerToken), r(TOKEN_PROGRAM_ADDRESS), r(SYSTEM_PROGRAM),
  ], u64(a.nonce), u32(a.from), u32(a.to), u64(a.shares), u64(a.maxCost));
}

async function positionAccounts(m: MarketRef, owner: TransactionSigner, position: Address, rentPayer: Address, ownerToken: Address) {
  return [
    signer(owner), w(m.market), w(position), w(rentPayer), r(m.mint), w(await vaultPda(m.market)),
    r(await authorityPda(m.market)), w(ownerToken), r(TOKEN_PROGRAM_ADDRESS),
  ];
}

export async function sellRange(m: MarketRef, owner: TransactionSigner, position: Address, rentPayer: Address, ownerToken: Address,
  a: { shares: number; minProceeds: number }): Promise<Instruction> {
  return ix("sell_range", await positionAccounts(m, owner, position, rentPayer, ownerToken), u64(a.shares), u64(a.minProceeds));
}

export async function claim(m: MarketRef, owner: TransactionSigner, position: Address, rentPayer: Address, ownerToken: Address): Promise<Instruction> {
  return ix("claim", await positionAccounts(m, owner, position, rentPayer, ownerToken));
}

export const advanceTime = (market: Address): Instruction => ix("advance_time", [w(market)]);
