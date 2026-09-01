export default function Twetch(options: {
  issuer?: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  [key: string]: unknown;
}): {
  id: string;
  name: string;
  type: "oidc";
  issuer: string;
  wellKnown: string;
  authorization: { params: { scope: string } };
  style: { brandColor: string };
  checks: string[];
  clientId: string;
  clientSecret?: string;
  [key: string]: unknown;
};