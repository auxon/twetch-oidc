export interface TwetchUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
  passwordHash: string | null;
  signingAddress: string | null;
  signingPubkey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OAuthClientRecord {
  clientId: string;
  clientSecret: string | null;
  ownerId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TwetchClaims {
  sub: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  profile?: string;
  updated_at?: number;
  email?: string;
  email_verified?: boolean;
  twetch_pubkey?: string;
}