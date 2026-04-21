/**
 * @tenonhq/sincronia-sawmill — type definitions.
 *
 * Concrete request/response shapes land in US-004. This skeleton exists
 * so client.ts can import from a stable module path.
 */

export interface SawmillApiConfig {
  instance: string;
  username: string;
  password: string;
}
