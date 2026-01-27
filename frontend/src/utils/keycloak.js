import Keycloak from "keycloak-js";

let keycloakInstance = null;

/**
 * Initialize Keycloak client
 * @param {Function} onAuthenticatedCallback - Called when authentication succeeds
 * @returns {Promise<void>}
 */
export async function initKeycloak(onAuthenticatedCallback) {
  // Check if Keycloak is enabled via environment variable
  const keycloakEnabled = import.meta.env.VITE_KEYCLOAK_ENABLED === "true";

  if (!keycloakEnabled) {
    console.log("Keycloak is disabled, skipping initialization");
    if (onAuthenticatedCallback) {
      onAuthenticatedCallback();
    }
    return;
  }

  // Validate required environment variables
  const realm = import.meta.env.VITE_KEYCLOAK_REALM;
  const url = import.meta.env.VITE_KEYCLOAK_URL;
  const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

  if (!realm || !url || !clientId) {
    console.error(
      "Keycloak configuration missing. Required: VITE_KEYCLOAK_REALM, VITE_KEYCLOAK_URL, VITE_KEYCLOAK_CLIENT_ID"
    );
    throw new Error("Keycloak configuration incomplete");
  }

  // Initialize Keycloak instance
  keycloakInstance = new Keycloak({
    realm: realm,
    url: url,
    clientId: clientId,
  });

  try {
    // Initialize with login-required mode to force authentication
    const authenticated = await keycloakInstance.init({
      onLoad: "login-required",
      checkLoginIframe: false, // Disable iframe check for better compatibility
      pkceMethod: "S256", // Use PKCE for security
    });

    if (authenticated) {
      console.log("Keycloak authentication successful");
      if (onAuthenticatedCallback) {
        onAuthenticatedCallback();
      }
    } else {
      console.warn("Keycloak authentication failed");
      throw new Error("Authentication failed");
    }
  } catch (error) {
    console.error("Failed to initialize Keycloak:", error);
    throw error;
  }
}

/**
 * Get current access token
 * @returns {string|null} Access token or null if not authenticated
 */
export function getToken() {
  if (!keycloakInstance || !keycloakInstance.authenticated) {
    return null;
  }
  return keycloakInstance.token;
}

/**
 * Update token if expiring soon
 * @param {Function} successCallback - Called when token updated successfully
 * @returns {Promise<void>}
 */
export async function updateToken(successCallback) {
  if (!keycloakInstance) {
    throw new Error("Keycloak not initialized");
  }

  try {
    // Refresh token if it expires in 5 seconds or less
    const refreshed = await keycloakInstance.updateToken(5);
    if (refreshed) {
      console.log("Token refreshed successfully");
    }
    if (successCallback) {
      successCallback();
    }
  } catch (error) {
    console.error("Failed to refresh token:", error);
    throw error;
  }
}

/**
 * Logout user and redirect to Keycloak logout
 * @returns {Promise<void>}
 */
export async function logout() {
  if (!keycloakInstance) {
    console.warn("Keycloak not initialized, cannot logout");
    return;
  }

  try {
    await keycloakInstance.logout({
      redirectUri: window.location.origin,
    });
  } catch (error) {
    console.error("Failed to logout:", error);
    throw error;
  }
}

/**
 * Get current username from token
 * @returns {string|null} Username or null
 */
export function getUsername() {
  if (!keycloakInstance || !keycloakInstance.authenticated) {
    return null;
  }
  return keycloakInstance.tokenParsed?.preferred_username || null;
}

/**
 * Check if user has specific role
 * @param {string} role - Role to check
 * @returns {boolean} True if user has role
 */
export function hasRole(role) {
  if (!keycloakInstance || !keycloakInstance.authenticated) {
    return false;
  }

  const realmRoles = keycloakInstance.tokenParsed?.realm_access?.roles || [];
  return realmRoles.includes(role);
}

/**
 * Check if Keycloak is enabled
 * @returns {boolean} True if Keycloak is enabled
 */
export function isKeycloakEnabled() {
  return import.meta.env.VITE_KEYCLOAK_ENABLED === "true";
}

/**
 * Get Keycloak instance (for advanced usage)
 * @returns {Keycloak|null} Keycloak instance or null
 */
export function getKeycloakInstance() {
  return keycloakInstance;
}
