/**
 * @tenonhq/sincronia-google-auth
 *
 * Google OAuth2 authentication for Sincronia Google integrations.
 * Provides auth client factory, env config helper, and error handling.
 */

// Client and auth functions
export {
  createGoogleAuth,
  configFromEnv,
  handleAuthError,
} from "./client";

// Type definitions
export type {
  GoogleAuthConfig,
  GoogleAuthResult,
  SetupConfig,
  SetupResult,
  GoogleAuthError,
} from "./types";
