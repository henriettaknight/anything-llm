const prisma = require("./prisma");
const { EventLogs } = require("../models/eventLogs");

/**
 * Provision or retrieve user from Keycloak token
 * This function handles automatic user creation for Keycloak-authenticated users.
 * It checks if a user exists by externalId, and creates a new user if not found.
 * 
 * @param {Object} keycloakUser - User info extracted from Keycloak token
 * @param {string} keycloakUser.id - Keycloak user ID (sub claim)
 * @param {string} keycloakUser.username - Username (preferred_username claim)
 * @param {string} keycloakUser.email - Email address
 * @param {string[]} keycloakUser.roles - User roles from Keycloak
 * @param {boolean} keycloakUser.isAdmin - Admin flag
 * @returns {Promise<Object>} Local user object
 * @throws {Error} If user provisioning fails
 */
async function provisionUser(keycloakUser) {
  try {
    // Validate input
    if (!keycloakUser || !keycloakUser.id) {
      throw new Error("Invalid Keycloak user: missing user ID");
    }
    if (!keycloakUser.username) {
      throw new Error("Invalid Keycloak user: missing username");
    }

    // Check if user already exists by externalId
    const existingUser = await prisma.users.findUnique({
      where: { externalId: keycloakUser.id },
    });

    if (existingUser) {
      console.log(
        `[Keycloak] User already exists: ${existingUser.username} (ID: ${existingUser.id})`
      );
      
      // Optionally sync roles if they've changed
      await syncUserRoles(existingUser.id, keycloakUser.roles);
      
      return existingUser;
    }

    // User doesn't exist, create new user
    console.log(
      `[Keycloak] Provisioning new user: ${keycloakUser.username} (External ID: ${keycloakUser.id})`
    );

    // Map Keycloak roles to local role
    const localRole = mapKeycloakRoleToLocal(keycloakUser.roles);

    // Handle potential username conflicts
    let username = keycloakUser.username;
    let usernameConflict = await checkUsernameExists(username);
    
    if (usernameConflict) {
      username = resolveUsernameConflict(keycloakUser.username, keycloakUser.id);
      console.log(
        `[Keycloak] Username conflict detected, using: ${username}`
      );
    }

    // Create new user with Keycloak authentication
    const newUser = await prisma.users.create({
      data: {
        username: username,
        password: null, // No local password for Keycloak users
        externalId: keycloakUser.id,
        authProvider: "keycloak",
        role: localRole,
        suspended: 0,
        bio: "",
      },
    });

    // Log provisioning event for audit
    await EventLogs.logEvent(
      "keycloak_user_provisioned",
      {
        username: newUser.username,
        externalId: keycloakUser.id,
        role: localRole,
        keycloakRoles: keycloakUser.roles,
      },
      newUser.id
    );

    console.log(
      `[Keycloak] User provisioned successfully: ${newUser.username} (ID: ${newUser.id})`
    );

    return newUser;
  } catch (error) {
    console.error("[Keycloak] User provisioning failed:", error.message);
    throw new Error(`User provisioning failed: ${error.message}`);
  }
}

/**
 * Update existing user's roles from Keycloak token
 * This ensures that role changes in Keycloak are reflected in the local database.
 * 
 * @param {number} userId - Local user ID
 * @param {string[]} keycloakRoles - Roles from Keycloak token
 * @returns {Promise<boolean>} True if updated successfully
 */
async function syncUserRoles(userId, keycloakRoles) {
  try {
    const currentUser = await prisma.users.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      console.warn(`[Keycloak] Cannot sync roles: user ${userId} not found`);
      return false;
    }

    // Only sync roles for Keycloak users
    if (currentUser.authProvider !== "keycloak") {
      return false;
    }

    const newRole = mapKeycloakRoleToLocal(keycloakRoles);

    // Only update if role has changed
    if (currentUser.role !== newRole) {
      await prisma.users.update({
        where: { id: userId },
        data: { role: newRole },
      });

      await EventLogs.logEvent(
        "keycloak_user_role_synced",
        {
          username: currentUser.username,
          oldRole: currentUser.role,
          newRole: newRole,
          keycloakRoles: keycloakRoles,
        },
        userId
      );

      console.log(
        `[Keycloak] User role synced: ${currentUser.username} (${currentUser.role} -> ${newRole})`
      );
    }

    return true;
  } catch (error) {
    console.error("[Keycloak] Role sync failed:", error.message);
    return false;
  }
}

/**
 * Map Keycloak roles to local role
 * Admin role in Keycloak maps to admin role locally.
 * All other users get the default role.
 * 
 * @param {string[]} keycloakRoles - Array of Keycloak roles
 * @returns {string} Local role ('admin' or 'default')
 */
function mapKeycloakRoleToLocal(keycloakRoles) {
  if (!keycloakRoles || !Array.isArray(keycloakRoles)) {
    return "default";
  }

  // If user has admin role in Keycloak, they get admin role locally
  if (keycloakRoles.includes("admin")) {
    return "admin";
  }

  // All other users get default role
  return "default";
}

/**
 * Check if a username already exists in the database
 * 
 * @param {string} username - Username to check
 * @returns {Promise<boolean>} True if username exists
 */
async function checkUsernameExists(username) {
  try {
    const existingUser = await prisma.users.findUnique({
      where: { username: username },
    });
    return !!existingUser;
  } catch (error) {
    console.error("[Keycloak] Error checking username:", error.message);
    return false;
  }
}

/**
 * Resolve username conflict by appending a suffix
 * Uses the first 8 characters of the external ID as a suffix.
 * 
 * @param {string} preferredUsername - Original username from Keycloak
 * @param {string} externalId - Keycloak user ID
 * @returns {string} Modified username with suffix
 */
function resolveUsernameConflict(preferredUsername, externalId) {
  // Use first 8 characters of external ID as suffix
  const suffix = externalId.substring(0, 8);
  return `${preferredUsername}_${suffix}`;
}

module.exports = {
  provisionUser,
  syncUserRoles,
  mapKeycloakRoleToLocal,
  checkUsernameExists,
  resolveUsernameConflict,
};
