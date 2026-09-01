import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createBase58check } from "@scure/base";

const b58c = createBase58check(sha256);

const MESSAGE_PREFIX = "Bitcoin Signed Message:\n";

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function varInt(n: number): Uint8Array {
  if (n < 253) return Uint8Array.of(n);
  if (n < 0x10000) {
    const buf = new Uint8Array(3);
    buf[0] = 253;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  const buf = new Uint8Array(5);
  buf[0] = 254;
  const view = new DataView(buf.buffer);
  view.setUint32(1, n, true);
  return buf;
}

function magicHash(message: string): Uint8Array {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(MESSAGE_PREFIX);
  const msg = encoder.encode(message);
  const payload = concatBytes(varInt(prefix.length), prefix, varInt(msg.length), msg);
  return sha256(sha256(payload));
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

export function p2pkhAddress(publicKey: Uint8Array): string {
  const payload = concatBytes(Uint8Array.of(0x00), hash160(publicKey));
  return b58c.encode(payload);
}

export function compressedPublicKey(secretKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(secretKey, true);
}

export function publicKeyHex(secretKey: Uint8Array): string {
  return bytesToHex(compressedPublicKey(secretKey));
}

export function addressFromSecret(secretKey: Uint8Array): string {
  return p2pkhAddress(compressedPublicKey(secretKey));
}

export function generateWallet(): {
  secretKey: Uint8Array;
  secretKeyHex: string;
  publicKeyHex: string;
  address: string;
} {
  const { secretKey } = secp256k1.keygen();
  return {
    secretKey,
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: publicKeyHex(secretKey),
    address: addressFromSecret(secretKey),
  };
}

export function walletFromSecretHex(secretKeyHex: string): {
  secretKey: Uint8Array;
  publicKeyHex: string;
  address: string;
} {
  const secretKey = hexToBytes(secretKeyHex);
  return {
    secretKey,
    publicKeyHex: publicKeyHex(secretKey),
    address: addressFromSecret(secretKey),
  };
}

export function signMessage(message: string, secretKey: Uint8Array): string {
  const hash = magicHash(message);
  const recovered = secp256k1.sign(hash, secretKey, {
    prehash: false,
    format: "recovered",
  });
  const bitcoin = new Uint8Array(65);
  bitcoin[0] = 27 + recovered[0] + 4;
  bitcoin.set(recovered.subarray(1), 1);
  return Buffer.from(bitcoin).toString("base64");
}

export function recoverPublicKey(message: string, signatureB64: string): Uint8Array {
  const raw = Buffer.from(signatureB64, "base64");
  if (raw.length !== 65) {
    throw new Error("Bitcoin signature must be 65 bytes");
  }
  const header = raw[0];
  if (header < 27 || header > 34) {
    throw new Error("Invalid Bitcoin signature header");
  }
  const recId = (header - 27) & 3;
  const compressed = ((header - 27) & 4) !== 0;
  const recovered = new Uint8Array(65);
  recovered[0] = recId;
  recovered.set(raw.subarray(1), 1);
  const pub = secp256k1.recoverPublicKey(recovered, magicHash(message), { prehash: false });
  if (compressed) {
    return secp256k1.Point.fromBytes(pub).toBytes(true);
  }
  return pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
}

export function verifyMessage(message: string, address: string, signatureB64: string): boolean {
  try {
    const pub = recoverPublicKey(message, signatureB64);
    return p2pkhAddress(pub) === address;
  } catch {
    return false;
  }
}