export interface TwetchProfile {
  id: string;
  name: string;
  handle: string;
  picture?: string;
  publicKey?: string;
  email?: string;
}

export interface TwetchAuthenticateInput {
  message: string;
  signature: string;
  address: string;
}

export interface TwetchClient {
  getChallenge(): Promise<string>;
  authenticate(input: TwetchAuthenticateInput): Promise<string>;
  me(token: string): Promise<TwetchProfile>;
  userById(id: string, token?: string): Promise<TwetchProfile | undefined>;
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