const Keycloak = require("keycloak-connect");
const session = require("express-session");
const path = require("path");
const fs = require("fs");

let keycloakInstance = null;

/**
 * Initialize Keycloak instance and install middleware
 * @param {import('express').Application} app - Express application instance
 * @returns {Keycloak.Keycloak} Initialized Keycloak instance
 */
function initKeycloak(app) {
  // Validate required environment variables
  if (!process.env.KEYCLOAK_SESSION_SECRET) {
    throw new Error(
      "KEYCLOAK_SESSION_SECRET environment variable is required when Keycloak is enabled"
    );
  }

  // Load Keycloak configuration
  const keycloakConfig = loadKeycloakConfig();

  // Configure session middleware
  const memoryStore = new session.MemoryStore();
  const sessionConfig = {
    secret: process.env.KEYCLOAK_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: memoryStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" && !!process.env.ENABLE_HTTPS,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  };

  app.use(session(sessionConfig));

  // Initialize Keycloak
  keycloakInstance = new Keycloak({ store: memoryStore }, keycloakConfig);

  // Install Keycloak middleware
  app.use(keycloakInstance.middleware());

  console.log("[Keycloak] Middleware initialized successfully");
  return keycloakInstance;
}

/**
 * Load Keycloak configuration from keycloak.json or environment variables
 * @returns {Object} Keycloak configuration object
 */
function loadKeycloakConfig() {
  // Try to load from keycloak.json first
  const configPath = path.join(__dirname, "../../keycloak.json");
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      console.log("[Keycloak] Loaded configuration from keycloak.json");
    } catch (error) {
      console.warn(
        "[Keycloak] Failed to load keycloak.json, falling back to environment variables"
      );
    }
  }

  // Override with environment variables if provided
  if (process.env.KEYCLOAK_REALM) {
    config.realm = process.env.KEYCLOAK_REALM;
  }
  if (process.env.KEYCLOAK_AUTH_SERVER_URL) {
    config["auth-server-url"] = process.env.KEYCLOAK_AUTH_SERVER_URL;
  }
  if (process.env.KEYCLOAK_CLIENT_ID) {
    config.resource = process.env.KEYCLOAK_CLIENT_ID;
  }
  if (process.env.KEYCLOAK_CLIENT_SECRET) {
    config.credentials = {
      secret: process.env.KEYCLOAK_CLIENT_SECRET,
    };
  }

  // Validate required configuration
  if (!config.realm) {
    throw new Error(
      "KEYCLOAK_REALM is required when Keycloak is enabled"
    );
  }
  if (!config["auth-server-url"]) {
    throw new Error(
      "KEYCLOAK_AUTH_SERVER_URL is required when Keycloak is enabled"
    );
  }
  if (!config.resource) {
    throw new Error(
      "KEYCLOAK_CLIENT_ID is required when Keycloak is enabled"
    );
  }

  // Ensure bearer-only mode is set
  config["bearer-only"] = true;

  return config;
}

/**
 * Protect route with authentication and optional role requirement
 * @param {string} [role] - Optional role requirement (e.g., 'admin', 'user')
 * @returns {Function} Express middleware function
 */
function protect(role) {
  if (!keycloakInstance) {
    throw new Error("Keycloak not initialized. Call initKeycloak() first.");
  }

  return (req, res, next) => {
    // Use Keycloak's protect middleware
    const keycloakProtect = keycloakInstance.protect();

    keycloakProtect(req, res, (err) => {
      if (err) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // If role is specified, check if user has the role
      if (role && !hasRole(req, role)) {
        console.warn(
          `[Keycloak] User ${getUserFromToken(req)?.username || "unknown"} lacks required role: ${role}`
        );
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      next();
    });
  };
}

/**
 * Extract user information from validated Keycloak token
 * @param {import('express').Request} req - Express request object with kauth property
 * @returns {Object|null} User object or null if not authenticated
 * @returns {string} returns.id - Keycloak user ID (sub claim)
 * @returns {string} returns.username - Username (preferred_username claim)
 * @returns {string} returns.email - User email
 * @returns {string[]} returns.roles - Array of realm roles
 * @returns {boolean} returns.isAdmin - True if user has admin role
 */
function getUserFromToken(req) {
  if (!req.kauth || !req.kauth.grant) {
    return null;
  }

  try {
    const token = req.kauth.grant.access_token;
    const content = token.content;

    // Extract user information from token claims
    const userId = content.sub;
    const username = content.preferred_username;
    const email = content.email;
    const realmRoles = content.realm_access?.roles || [];

    // Check if user has admin role
    const isAdmin = realmRoles.includes("admin");

    return {
      id: userId,
      username: username,
      email: email,
      roles: realmRoles,
      isAdmin: isAdmin,
    };
  } catch (error) {
    console.error("[Keycloak] Error extracting user from token:", error);
    return null;
  }
}

/**
 * Check if user has a specific role
 * @param {import('express').Request} req - Express request object
 * @param {string} role - Role to check
 * @returns {boolean} True if user has the role
 */
function hasRole(req, role) {
  if (!req.kauth || !req.kauth.grant) {
    return false;
  }

  try {
    const token = req.kauth.grant.access_token;
    const realmRoles = token.content.realm_access?.roles || [];
    return realmRoles.includes(role);
  } catch (error) {
    console.error("[Keycloak] Error checking role:", error);
    return false;
  }
}

module.exports = {
  initKeycloak,
  protect,
  getUserFromToken,
  hasRole,
};
