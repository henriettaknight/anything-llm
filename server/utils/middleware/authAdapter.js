const { userFromSession: legacyUserFromSession } = require("../http");
const { getUserFromToken, hasRole: keycloakHasRole } = require("./keycloakAuth");
const { provisionUser } = require("../keycloakUserProvisioning");

/**
 * Check if Keycloak authentication is enabled
 * @returns {boolean} True if Keycloak is enabled
 */
function isKeycloakEnabled() {
  return process.env.KEYCLOAK_ENABLED === "true";
}

/**
 * Unified user authentication middleware
 * Supports both Keycloak and existing JWT authentication based on KEYCLOAK_ENABLED environment variable.
 * When Keycloak is enabled, it tries Keycloak first, then falls back to local JWT if Keycloak fails.
 * When Keycloak is disabled, only existing JWT authentication is used.
 * 
 * @param {import('express').Request} request - Express request object
 * @param {import('express').Response} response - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
async function userFromSession(request, response, next) {
  try {
    // Check if user is already cached in response.locals
    if (response.locals?.user) {
      return next();
    }

    let user = null;

    if (isKeycloakEnabled()) {
      // Keycloak mode: Try Keycloak first, then fallback to local JWT
      user = await authenticateWithKeycloak(request);
      
      if (!user) {
        // Keycloak authentication failed, try local JWT authentication
        console.log("[AuthAdapter] Keycloak authentication failed, trying local JWT...");
        user = await legacyUserFromSession(request, response);
        
        if (!user) {
          // Both authentication methods failed
          return response.status(401).json({ 
            error: "Authentication required",
            message: "Valid Keycloak token or local credentials required"
          });
        }
      }
    } else {
      // Legacy mode: Use only existing JWT authentication
      user = await legacyUserFromSession(request, response);
      
      if (!user) {
        // Authentication failed in legacy mode
        return response.status(401).json({ 
          error: "Authentication required"
        });
      }
    }

    // Cache user in response.locals for downstream middleware
    response.locals.user = user;
    next();
  } catch (error) {
    console.error("[AuthAdapter] Authentication error:", error.message);
    return response.status(401).json({ 
      error: "Authentication failed",
      message: "An error occurred during authentication"
    });
  }
}

/**
 * Authenticate user using Keycloak token
 * Extracts user info from token and provisions local user if needed
 * 
 * @param {import('express').Request} request - Express request object
 * @returns {Promise<Object|null>} User object or null if authentication fails
 */
async function authenticateWithKeycloak(request) {
  try {
    // First, check if Keycloak has already validated the token (via protect middleware)
    let keycloakUser = getUserFromToken(request);
    
    // If not validated yet, we need to manually validate the token
    if (!keycloakUser) {
      // Extract token from Authorization header
      const auth = request.header("Authorization");
      const token = auth ? auth.split(" ")[1] : null;
      
      if (!token) {
        console.warn("[AuthAdapter] No Authorization header found");
        return null;
      }
      
      // Manually validate the token using Keycloak
      const validatedUser = await validateKeycloakToken(token, request);
      if (!validatedUser) {
        console.warn("[AuthAdapter] Token validation failed");
        return null;
      }
      
      keycloakUser = validatedUser;
    }

    // Provision or retrieve local user
    const localUser = await provisionUser(keycloakUser);
    
    if (!localUser) {
      console.error("[AuthAdapter] User provisioning failed");
      return null;
    }

    // Return user object in format compatible with existing code
    // This ensures consistent interface regardless of authentication provider
    return normalizeUserObject(localUser, keycloakUser);
  } catch (error) {
    console.error("[AuthAdapter] Keycloak authentication error:", error.message);
    return null;
  }
}

/**
 * Manually validate Keycloak token
 * This is used when the Keycloak protect middleware hasn't been applied
 * 
 * @param {string} token - JWT token from Authorization header
 * @param {import('express').Request} request - Express request object
 * @returns {Promise<Object|null>} User info from token or null if invalid
 */
async function validateKeycloakToken(token, request) {
  try {
    const jwt = require("jsonwebtoken");
    const jwksClient = require("jwks-rsa");
    
    // Decode token without verification to get kid (key ID)
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      console.warn("[AuthAdapter] Invalid token format");
      return null;
    }
    
    // Get JWKS URI from Keycloak
    const keycloakUrl = process.env.KEYCLOAK_AUTH_SERVER_URL;
    const realm = process.env.KEYCLOAK_REALM;
    const jwksUri = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;
    
    // Create JWKS client
    const client = jwksClient({
      jwksUri: jwksUri,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
    });
    
    // Get signing key
    const key = await client.getSigningKey(decoded.header.kid);
    const signingKey = key.getPublicKey();
    
    // Verify token
    const verified = jwt.verify(token, signingKey, {
      algorithms: ["RS256"],
      issuer: `${keycloakUrl}/realms/${realm}`,
    });
    
    // Extract user information from verified token
    return {
      id: verified.sub,
      username: verified.preferred_username,
      email: verified.email,
      roles: verified.realm_access?.roles || [],
      isAdmin: (verified.realm_access?.roles || []).includes("admin"),
    };
  } catch (error) {
    console.error("[AuthAdapter] Token validation error:", error.message);
    return null;
  }
}

/**
 * Normalize user object to ensure consistent format
 * Combines local user data with Keycloak-specific information
 * 
 * @param {Object} localUser - User object from database
 * @param {Object} keycloakUser - User info from Keycloak token
 * @returns {Object} Normalized user object
 */
function normalizeUserObject(localUser, keycloakUser) {
  return {
    id: localUser.id,
    username: localUser.username,
    role: localUser.role,
    suspended: localUser.suspended,
    externalId: localUser.externalId,
    authProvider: localUser.authProvider,
    pfpFilename: localUser.pfpFilename || null,
    createdAt: localUser.createdAt,
    lastUpdatedAt: localUser.lastUpdatedAt,
    // Include Keycloak-specific info for role checking
    _keycloakRoles: keycloakUser?.roles || [],
    _isKeycloakAuth: true,
  };
}

/**
 * Check if request is authenticated via Keycloak
 * @param {import('express').Request} request - Express request object
 * @returns {boolean} True if Keycloak authenticated
 */
function isKeycloakAuth(request) {
  // Check if Keycloak is enabled and request has kauth property
  return isKeycloakEnabled() && !!request.kauth?.grant;
}

/**
 * Require specific role for endpoint access
 * Works with both Keycloak and existing role systems based on authentication mode
 * 
 * @param {string|string[]} requiredRoles - Required role(s) for access
 * @returns {Function} Express middleware function
 */
function requireRole(requiredRoles) {
  // Normalize to array
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  return async (request, response, next) => {
    try {
      // Get user from session (should be cached in response.locals by userFromSession middleware)
      const user = response.locals?.user;
      
      if (!user) {
        console.warn("[AuthAdapter] Role check failed: No authenticated user");
        return response.status(401).json({ 
          error: "Authentication required",
          message: "You must be authenticated to access this resource"
        });
      }

      // Check if user has required role
      const hasRequiredRole = await checkUserRole(user, roles, request);
      
      if (!hasRequiredRole) {
        console.warn(
          `[AuthAdapter] Role check failed: User ${user.username} lacks required role(s): ${roles.join(", ")}`
        );
        return response.status(403).json({ 
          error: "Insufficient permissions",
          message: `This resource requires one of the following roles: ${roles.join(", ")}`
        });
      }

      // User has required role, proceed
      next();
    } catch (error) {
      console.error("[AuthAdapter] Role check error:", error.message);
      return response.status(500).json({ 
        error: "Authorization check failed",
        message: "An error occurred while checking permissions"
      });
    }
  };
}

/**
 * Check if user has any of the required roles
 * Supports both Keycloak and local role systems
 * 
 * @param {Object} user - User object from authentication
 * @param {string[]} requiredRoles - Array of required roles
 * @param {import('express').Request} request - Express request object
 * @returns {Promise<boolean>} True if user has any required role
 */
async function checkUserRole(user, requiredRoles, request) {
  if (!user || !requiredRoles || requiredRoles.length === 0) {
    return false;
  }

  if (isKeycloakEnabled() && user._isKeycloakAuth) {
    // Keycloak mode: Check both Keycloak roles and local role
    return checkKeycloakUserRole(user, requiredRoles, request);
  } else {
    // Legacy mode: Check only local role
    return checkLocalUserRole(user, requiredRoles);
  }
}

/**
 * Check Keycloak user roles
 * Checks both realm roles from token and local role from database
 * 
 * @param {Object} user - User object with Keycloak info
 * @param {string[]} requiredRoles - Array of required roles
 * @param {import('express').Request} request - Express request object
 * @returns {boolean} True if user has any required role
 */
function checkKeycloakUserRole(user, requiredRoles, request) {
  // Check local role first (from database)
  if (requiredRoles.includes(user.role)) {
    return true;
  }

  // Check Keycloak realm roles (from token)
  const keycloakRoles = user._keycloakRoles || [];
  for (const requiredRole of requiredRoles) {
    if (keycloakRoles.includes(requiredRole)) {
      return true;
    }
  }

  // Also check using Keycloak's hasRole function if available
  if (request.kauth?.grant) {
    for (const requiredRole of requiredRoles) {
      if (keycloakHasRole(request, requiredRole)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check local user role
 * Only checks the role field from database
 * 
 * @param {Object} user - User object from database
 * @param {string[]} requiredRoles - Array of required roles
 * @returns {boolean} True if user has any required role
 */
function checkLocalUserRole(user, requiredRoles) {
  return requiredRoles.includes(user.role);
}

module.exports = {
  userFromSession,
  requireRole,
  isKeycloakAuth,
  isKeycloakEnabled,
};
