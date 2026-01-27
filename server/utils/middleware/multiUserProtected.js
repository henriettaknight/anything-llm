const { SystemSettings } = require("../../models/systemSettings");
const { userFromSession } = require("../http");
const { isKeycloakEnabled } = require("./authAdapter");
const ROLES = {
  all: "<all>",
  admin: "admin",
  manager: "manager",
  default: "default",
};
const DEFAULT_ROLES = [ROLES.admin, ROLES.admin];

/**
 * Check if user has any of the required roles
 * Supports both Keycloak and local role systems
 * @param {Object} user - User object
 * @param {string[]} allowedRoles - Array of allowed roles
 * @param {import('express').Request} request - Express request object
 * @returns {boolean} True if user has any allowed role
 */
function userHasRole(user, allowedRoles, request) {
  if (!user || !allowedRoles || allowedRoles.length === 0) {
    return false;
  }

  // Check local role first (from database)
  if (allowedRoles.includes(user.role)) {
    return true;
  }

  // If Keycloak is enabled and user is authenticated via Keycloak, check Keycloak roles
  if (isKeycloakEnabled() && user._isKeycloakAuth) {
    const keycloakRoles = user._keycloakRoles || [];
    for (const allowedRole of allowedRoles) {
      if (keycloakRoles.includes(allowedRole)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Explicitly check that multi user mode is enabled as well as that the
 * requesting user has the appropriate role to modify or call the URL.
 * @param {string[]} allowedRoles - The roles that are allowed to access the route
 * @returns {function}
 */
function strictMultiUserRoleValid(allowedRoles = DEFAULT_ROLES) {
  return async (request, response, next) => {
    // If the access-control is allowable for all - skip validations and continue;
    if (allowedRoles.includes(ROLES.all)) {
      next();
      return;
    }

    // When Keycloak is enabled, skip multi-user mode check
    // Keycloak handles authentication independently
    if (!isKeycloakEnabled()) {
      const multiUserMode =
        response.locals?.multiUserMode ??
        (await SystemSettings.isMultiUserMode());
      if (!multiUserMode) return response.sendStatus(401).end();
    }

    const user =
      response.locals?.user ?? (await userFromSession(request, response));
    
    if (userHasRole(user, allowedRoles, request)) {
      next();
      return;
    }
    return response.sendStatus(401).end();
  };
}

/**
 * Apply role permission checks IF the current system is in multi-user mode.
 * This is relevant for routes that are shared between MUM and single-user mode.
 * @param {string[]} allowedRoles - The roles that are allowed to access the route
 * @returns {function}
 */
function flexUserRoleValid(allowedRoles = DEFAULT_ROLES) {
  return async (request, response, next) => {
    // If the access-control is allowable for all - skip validations and continue;
    // It does not matter if multi-user or not.
    if (allowedRoles.includes(ROLES.all)) {
      next();
      return;
    }

    // When Keycloak is enabled, always check roles
    if (isKeycloakEnabled()) {
      const user =
        response.locals?.user ?? (await userFromSession(request, response));
      
      if (userHasRole(user, allowedRoles, request)) {
        next();
        return;
      }
      return response.sendStatus(401).end();
    }

    // Bypass if not in multi-user mode (legacy behavior)
    const multiUserMode =
      response.locals?.multiUserMode ??
      (await SystemSettings.isMultiUserMode());
    if (!multiUserMode) {
      next();
      return;
    }

    const user =
      response.locals?.user ?? (await userFromSession(request, response));
    if (userHasRole(user, allowedRoles, request)) {
      next();
      return;
    }
    return response.sendStatus(401).end();
  };
}

// Middleware check on a public route if the instance is in a valid
// multi-user set up.
async function isMultiUserSetup(_request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  if (!multiUserMode) {
    response.status(403).json({
      error: "Invalid request",
    });
    return;
  }

  next();
  return;
}

module.exports = {
  ROLES,
  strictMultiUserRoleValid,
  flexUserRoleValid,
  isMultiUserSetup,
};
