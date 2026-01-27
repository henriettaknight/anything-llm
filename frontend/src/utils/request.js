import { AUTH_TOKEN, AUTH_USER } from "./constants";
import {
  isKeycloakEnabled,
  getToken,
  updateToken,
  logout as keycloakLogout,
} from "./keycloak";

// Sets up the base headers for all authenticated requests so that we are able to prevent
// basic spoofing since a valid token is required and that cannot be spoofed
export function userFromStorage() {
  try {
    const userString = window.localStorage.getItem(AUTH_USER);
    if (!userString) return null;
    return JSON.parse(userString);
  } catch {}
  return {};
}

export function baseHeaders(providedToken = null) {
  const token = providedToken || window.localStorage.getItem(AUTH_TOKEN);
  return {
    Authorization: token ? `Bearer ${token}` : null,
  };
}

export function safeJsonParse(jsonString, fallback = null) {
  try {
    return JSON.parse(jsonString);
  } catch {}
  return fallback;
}

/**
 * Get headers with Keycloak token if enabled, otherwise use existing auth
 * @param {string|null} providedToken - Optional token to use instead of stored token
 * @returns {Promise<Object>} Headers object with Authorization header
 */
export async function getAuthHeaders(providedToken = null) {
  // Check if Keycloak is enabled
  if (isKeycloakEnabled()) {
    try {
      // Refresh token if expiring soon (within 5 seconds)
      await updateToken();

      // Get the current access token
      const keycloakToken = getToken();

      if (keycloakToken) {
        return {
          Authorization: `Bearer ${keycloakToken}`,
        };
      } else {
        console.warn("Keycloak token not available");
        return {
          Authorization: null,
        };
      }
    } catch (error) {
      console.error("Failed to refresh Keycloak token:", error);
      // Token refresh failed - redirect to login
      handleTokenRefreshFailure();
      throw error;
    }
  }

  // Fall back to existing authentication
  return baseHeaders(providedToken);
}

/**
 * Handle token refresh failure by redirecting to Keycloak login
 */
function handleTokenRefreshFailure() {
  console.log("Token refresh failed, redirecting to login...");
  try {
    keycloakLogout();
  } catch (error) {
    console.error("Failed to logout:", error);
    // If logout fails, redirect to home page
    window.location.href = "/";
  }
}
