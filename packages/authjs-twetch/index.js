/**
 * Auth.js / NextAuth provider for Sign in with Twetch.
 *
 * @example
 * import Twetch from "@twetch/authjs-provider";
 * providers: [Twetch({ issuer, clientId, clientSecret })]
 */
export default function Twetch(options) {
  const issuer = options.issuer ?? "https://id.twetch.app";
  return {
    id: "twetch",
    name: "Twetch",
    type: "oidc",
    issuer,
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    authorization: {
      params: { scope: options.scope ?? "openid profile" },
    },
    style: {
      brandColor: "#F5A524",
    },
    checks: ["pkce", "state", "nonce"],
    ...options,
    issuer,
  };
}