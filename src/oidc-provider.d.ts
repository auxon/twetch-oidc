declare module "oidc-provider" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export class Provider {
    constructor(issuer: string, configuration?: Record<string, unknown>);
    callback(): (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => void;
    interactionDetails(req: IncomingMessage, res: ServerResponse): Promise<{
      uid: string;
      prompt: { name: string; details: Record<string, unknown> };
      params: Record<string, unknown>;
      session?: { accountId?: string };
      grantId?: string;
    }>;
    interactionFinished(
      req: IncomingMessage,
      res: ServerResponse,
      result: Record<string, unknown>,
      options?: { mergeWithLastSubmission?: boolean },
    ): Promise<void>;
    Client: { find(id: string): Promise<Record<string, unknown> | undefined> };
    Grant: {
      new (args: { accountId: string; clientId: string }): {
        addOIDCScope(scope: string): void;
        addOIDCClaims(claims: string[]): void;
        addResourceScope(indicator: string, scope: string): void;
        save(): Promise<string>;
      };
      find(id: string): Promise<{
        addOIDCScope(scope: string): void;
        addOIDCClaims(claims: string[]): void;
        addResourceScope(indicator: string, scope: string): void;
        save(): Promise<string>;
      } | undefined>;
    };
    proxy: boolean;
  }

  export { Provider as default };
}