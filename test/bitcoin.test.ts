import { describe, expect, it } from "vitest";
import {
  addressFromSecret,
  generateWallet,
  signMessage,
  verifyMessage,
  walletFromSecretHex,
} from "../src/auth/bitcoin.ts";
import { DEMO_WALLET_SECRET_HEX, demoWallet } from "../src/seed.ts";

describe("Bitcoin signed messages", () => {
  it("round-trips a challenge signature", () => {
    const wallet = generateWallet();
    const message = "http://localhost:3000 wants you to sign in with your Bitcoin identity.";
    const signature = signMessage(message, wallet.secretKey);
    expect(verifyMessage(message, wallet.address, signature)).toBe(true);
    expect(verifyMessage("different", wallet.address, signature)).toBe(false);
  });

  it("uses the seeded demo wallet address", () => {
    const wallet = demoWallet();
    const again = walletFromSecretHex(DEMO_WALLET_SECRET_HEX);
    expect(wallet.address).toBe(again.address);
    expect(addressFromSecret(wallet.secretKey)).toBe(wallet.address);
  });
});