export interface TwetchProfile {
  id: string;
  name: string;
  handle: string;
  picture?: string;
  publicKey?: string;
  email?: string;
}

export type TwetchExternalAlgorithm = "BTC_BIP322" | "ETH_PERSONAL" | "SOLANA_ED25519";

export interface TwetchChallenge {
  message: string;
  nonce?: string;
  ts?: number;
}

export interface TwetchAuthenticateInput {
  message: string;
  signature: string;
  address: string;
  algorithm?: string;
  nonce?: string;
  ts?: number;
}

export interface TwetchClient {
  getChallenge(): Promise<TwetchChallenge>;
  authenticate(input: TwetchAuthenticateInput): Promise<string>;
  me(token: string): Promise<TwetchProfile>;
  userById(id: string, token?: string): Promise<TwetchProfile | undefined>;
  userByPubkey(publicKey: string): Promise<TwetchProfile | undefined>;
}

export class TwetchAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TwetchAuthError";
  }
}
