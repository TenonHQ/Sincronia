import { OAuth2Client } from "google-auth-library";
import { GoogleAuthConfig, GoogleAuthResult } from "./types";
import { DEFAULT_REDIRECT_URI } from "./constants";

/**
 * @description Creates an authenticated Google OAuth2 client from a refresh token.
 * @param params - Object with auth config containing clientId, clientSecret, and refreshToken.
 * @returns Object with the authenticated OAuth2Client.
 */
export function createGoogleAuth(params: {
  config: GoogleAuthConfig;
}): GoogleAuthResult {
  var config = params.config;

  if (!config.clientId) {
    throw new Error(
      "GOOGLE_CLIENT_ID is required. Run the setup script to configure OAuth credentials."
    );
  }
  if (!config.clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_SECRET is required. Run the setup script to configure OAuth credentials."
    );
  }
  if (!config.refreshToken) {
    throw new Error(
      "GOOGLE_REFRESH_TOKEN is required. Run 'npm run setup' in the google-auth package to get one."
    );
  }

  var redirectUri = config.redirectUri || DEFAULT_REDIRECT_URI;

  var auth = new OAuth2Client(
    config.clientId,
    config.clientSecret,
    redirectUri
  );

  auth.setCredentials({
    refresh_token: config.refreshToken,
  });

  return { auth: auth };
}

/**
 * @description Creates a GoogleAuthConfig from environment variables.
 * @returns Config object populated from GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
 */
export function configFromEnv(): GoogleAuthConfig {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
  };
}

/**
 * @description Handles Google API errors with specific guidance for common error codes.
 * @param error - The caught error.
 * @param context - Description of what operation was being attempted.
 */
export function handleAuthError(error: unknown, context: string): never {
  if (error && typeof error === "object" && "response" in error) {
    var response = (error as Record<string, any>).response;
    if (response && response.status) {
      if (response.status === 401) {
        throw new Error(
          "Google authentication failed (" + context + "). " +
            "Your refresh token may be expired or revoked. " +
            "Run 'npm run setup' in the google-auth package to get a new token."
        );
      }
      if (response.status === 403) {
        throw new Error(
          "Google API access denied (" + context + "). " +
            "Check that the required API scopes are authorized and the API is enabled in Google Cloud Console."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Google API rate limit exceeded (" + context + "). " +
            "Wait a moment and try again."
        );
      }
      var message = response.data && response.data.error && response.data.error.message
        ? String(response.data.error.message)
        : "HTTP " + response.status;
      throw new Error("Google API error (" + context + "): " + message);
    }
  }
  if (error instanceof Error) {
    throw new Error("Google API error (" + context + "): " + error.message);
  }
  throw error;
}
