/**
 * Type declarations for keytar (optional dependency)
 * keytar provides cross-platform credential storage
 */
declare module 'keytar' {
  /**
   * Get a password from the keychain
   * @param service - Service name (e.g., 'servalsheets')
   * @param account - Account name (e.g., 'oauth-tokens')
   * @returns The password if found, null otherwise
   */
  export function getPassword(service: string, account: string): Promise<string | null>;

  /**
   * Set a password in the keychain
   * @param service - Service name
   * @param account - Account name
   * @param password - Password to store
   */
  export function setPassword(service: string, account: string, password: string): Promise<void>;

  /**
   * Delete a password from the keychain
   * @param service - Service name
   * @param account - Account name
   * @returns true if deleted, false if not found
   */
  export function deletePassword(service: string, account: string): Promise<boolean>;

  /**
   * Find all credentials for a service
   * @param service - Service name
   * @returns Array of credentials
   */
  export function findCredentials(
    service: string
  ): Promise<Array<{ account: string; password: string }>>;

  /**
   * Find a password for a service
   * @param service - Service name
   * @returns The password if found, null otherwise
   */
  export function findPassword(service: string): Promise<string | null>;
}
