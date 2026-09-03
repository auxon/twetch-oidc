import { describe, expect, it } from "vitest";
import { signMessage } from "../src/auth/bitcoin.ts";
import { deriveTwetchAccount, deriveTwetchAccounts, parseMnemonic } from "../src/auth/twetch-seed.ts";

const ABANDON =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("Twetch seed derivation", () => {
  it("normalizes and rejects invalid phrases", () => {
    expect(parseMnemonic(`  ${ABANDON.toUpperCase()}  `)).toBe(ABANDON);
    expect(() => parseMnemonic("not a seed")).toThrow(/12 to 24/);
    expect(() => parseMnemonic("abandon ".repeat(12).trim())).toThrow(/BIP-39/);
  });

  it("derives the Twetch account key at m/0/0", () => {
    const account = deriveTwetchAccount(ABANDON);
    expect(account.path).toBe("m/0/0");
    expect(account.publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(account.address).toMatch(/^[13]/);
    const again = deriveTwetchAccount(ABANDON, "m/0/0");
    expect(again.publicKeyHex).toBe(account.publicKeyHex);
    const paths = deriveTwetchAccounts(ABANDON).map((item) => item.path);
    expect(paths).toContain("m/0");
    expect(paths).toContain("m");
  });

  it("signs a local challenge with the derived key", () => {
    const account = deriveTwetchAccount(ABANDON);
    const message = "https://id.example wants you to sign in with your Bitcoin identity.";
    const signature = signMessage(message, account.secretKey);
    expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
