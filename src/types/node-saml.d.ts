/**
 * Minimal type declarations for node-saml v3.x
 * Covers only the surface used by src/security/saml-provider.ts
 */

declare module 'node-saml' {
  export interface SamlConfig {
    entryPoint?: string;
    issuer?: string;
    /** IdP x509 cert (PEM body or array) */
    cert?: string | string[];
    callbackUrl?: string;
    signatureAlgorithm?: 'sha1' | 'sha256' | 'sha512';
    wantAssertionsSigned?: boolean;
    acceptedClockSkewMs?: number;
    privateKey?: string;
    decryptionPvk?: string;
    /** Log out URL for SLO */
    logoutUrl?: string;
    idpIssuer?: string;
    [key: string]: unknown;
  }

  export interface SamlProfile {
    nameID?: string;
    nameIDFormat?: string;
    sessionIndex?: string;
    [attribute: string]: unknown;
  }

  export interface AuthorizeOptions {
    additionalParams?: Record<string, string>;
    id?: string;
    [key: string]: unknown;
  }

  export interface ValidateInResponseTo {
    inResponseTo?: string;
    [key: string]: unknown;
  }

  export interface LogoutProfile {
    nameID?: string;
    sessionIndex?: string;
    [key: string]: unknown;
  }

  export class SAML {
    constructor(options: SamlConfig);

    /** Build AuthnRequest URL (redirect binding) */
    getAuthorizeUrlAsync(
      relayState: string | undefined,
      host: string | undefined,
      options: AuthorizeOptions
    ): Promise<string>;

    /** Validate POST binding assertion from IdP */
    validatePostResponseAsync(
      body: Record<string, string>
    ): Promise<{ profile: SamlProfile | null; loggedOut: boolean }>;

    /** Build SLO request URL */
    getLogoutUrlAsync(
      user: LogoutProfile,
      relayState: string | undefined,
      options: Record<string, unknown>
    ): Promise<string>;

    /** Generate SP metadata XML */
    generateServiceProviderMetadata(
      decryptionCert: string | null,
      signingCert: string | null
    ): string;
  }
}
