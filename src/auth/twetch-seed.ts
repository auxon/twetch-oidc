import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { p2pkhAddress } from "./bitcoin.ts";

/** Twetch identity key first, then documented import fallbacks and wallet nodes. */
export const TWETCH_ACCOUNT_PATHS = ["m/0/0", "m/0", "m", "m/44'/0'/0'/0/0", "m/44'/0'/0'/0"] as const;

export interface DerivedTwetchAccount {
  secretKey: Uint8Array;
  publicKeyHex: string;
  address: string;
  path: string;
}

export function normalizeMnemonic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function parseMnemonic(raw: string): string {
  const mnemonic = normalizeMnemonic(raw);
  const words = mnemonic.split(" ");
  if (words.length < 12 || words.length > 24 || words.length % 3 !== 0) {
    throw new Error("Enter a 12 to 24 word Twetch seed phrase.");
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error("That seed phrase is not a valid BIP-39 mnemonic.");
  }
  return mnemonic;
}

export function deriveTwetchAccount(raw: string, path: string = TWETCH_ACCOUNT_PATHS[0]): DerivedTwetchAccount {
  const mnemonic = parseMnemonic(raw);
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive(path);
  const secretKey = child.privateKey;
  const publicKey = child.publicKey;
  if (!secretKey || !publicKey) {
    throw new Error("Could not derive a key from that seed.");
  }
  return {
    secretKey,
    publicKeyHex: bytesToHex(publicKey),
    address: p2pkhAddress(publicKey),
    path,
  };
}

export function deriveTwetchAccounts(raw: string): DerivedTwetchAccount[] {
  const mnemonic = parseMnemonic(raw);
  return TWETCH_ACCOUNT_PATHS.map((path) => deriveTwetchAccount(mnemonic, path));
}

export function wipeBytes(bytes: Uint8Array) {
  bytes.fill(0);
}
