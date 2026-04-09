/**
 * SecurityModule
 * Implements security and access control features
 * 
 * Requirements:
 * - 6.6: Return error when accessing expired download links
 * - 9.2: Generate unique signed token using encryption algorithm
 * - 9.3: Validate signature token validity and expiration time
 * - 9.4: Reject access and return 403 error if token is invalid or expired
 * - 9.5: Validate path legality to prevent path traversal attacks
 * - 9.6: Sanitize sensitive information (file paths to relative paths only)
 */

const crypto = require('crypto');
const path = require('path');

class SecurityModule {
  constructor() {
    // Get secret key from environment or use default (should be configured in production)
    this.secret = process.env.KIRO_DOWNLOAD_SECRET || 'default-secret-key-change-in-production';
    
    // Token expiration time in milliseconds (24 hours)
    this.tokenExpirationMs = 24 * 60 * 60 * 1000;
  }

  /**
   * Generate HMAC-SHA256 signed download token
   * Requirement 9.2: Generate unique signed token using encryption algorithm
   * 
   * @param {string} sessionId - Session ID
   * @param {string} filename - ZIP filename
   * @param {Date} expiresAt - Expiration timestamp
   * @returns {string} HMAC-SHA256 signed token
   */
  generateDownloadToken(sessionId, filename, expiresAt) {
    // Create payload with session, filename, and expiration
    const payload = `${sessionId}:${filename}:${expiresAt.getTime()}`;
    
    // Generate HMAC-SHA256 signature
    // This creates a cryptographically secure hash that can only be generated
    // with knowledge of the secret key
    const token = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');

    return token;
  }

  /**
   * Validate download token
   * Requirement 9.3: Validate signature token validity and expiration time
   * Requirement 9.4: Reject access and return 403 error if token is invalid or expired
   * Requirement 6.6: Return error when accessing expired download links
   * 
   * @param {string} sessionId - Session ID
   * @param {string} token - Download token to validate
   * @param {string} filename - ZIP filename
   * @param {Date} expiresAt - Expiration timestamp
   * @returns {Object} Validation result with valid flag and error details
   */
  validateDownloadToken(sessionId, token, filename, expiresAt) {
    try {
      // Check if token format is valid (64 hex characters for SHA256)
      if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        return {
          valid: false,
          statusCode: 403,
          error: 'INVALID_TOKEN',
          message: 'Invalid token format',
        };
      }

      // Check if token is expired
      // Requirement 9.3: Validate expiration time
      const now = Date.now();
      const expirationTime = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
      
      if (now > expirationTime) {
        return {
          valid: false,
          statusCode: 403,
          error: 'TOKEN_EXPIRED',
          message: 'Download link has expired (24 hour limit)',
        };
      }

      // Regenerate token with the same parameters to verify signature
      const expectedToken = this.generateDownloadToken(sessionId, filename, new Date(expirationTime));
      
      // Use timing-safe comparison to prevent timing attacks
      const tokenBuffer = Buffer.from(token, 'hex');
      const expectedBuffer = Buffer.from(expectedToken, 'hex');
      
      if (tokenBuffer.length !== expectedBuffer.length) {
        return {
          valid: false,
          statusCode: 403,
          error: 'INVALID_TOKEN',
          message: 'Token signature is invalid',
        };
      }

      // Timing-safe comparison
      const isValid = crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
      
      if (!isValid) {
        return {
          valid: false,
          statusCode: 403,
          error: 'INVALID_TOKEN',
          message: 'Token signature is invalid',
        };
      }

      // Token is valid
      return {
        valid: true,
        sessionId,
        filename,
        expiresAt: new Date(expirationTime),
      };
    } catch (error) {
      console.error(`Error validating download token: ${error.message}`);
      return {
        valid: false,
        statusCode: 403,
        error: 'VALIDATION_ERROR',
        message: 'Token validation failed',
      };
    }
  }

  /**
   * Validate file path to prevent directory traversal attacks
   * Requirement 9.5: Validate path legality to prevent path traversal attacks
   * 
   * @param {string} filePath - File path to validate
   * @param {string} basePath - Base directory path that file must be within
   * @returns {Object} Validation result
   */
  validateFilePath(filePath, basePath) {
    try {
      // Normalize paths to handle different separators and resolve .. sequences
      const normalizedPath = path.normalize(filePath);
      const normalizedBase = path.normalize(basePath);
      
      // Resolve to absolute paths
      const resolvedPath = path.resolve(normalizedPath);
      const resolvedBase = path.resolve(normalizedBase);
      
      // Check if the resolved path starts with the base path
      // This prevents directory traversal attacks like ../../etc/passwd
      const isWithinBase = resolvedPath.startsWith(resolvedBase);
      
      if (!isWithinBase) {
        return {
          valid: false,
          statusCode: 403,
          error: 'PATH_TRAVERSAL_DETECTED',
          message: 'Access denied: Path traversal attempt detected',
        };
      }

      // Additional check: ensure path doesn't contain suspicious patterns
      // Note: We check the original filePath, not the resolved one
      const suspiciousPatterns = [
        /\.\.[\/\\]/,  // Parent directory references in the path
        /[<>"|?*]/,    // Invalid filename characters (excluding : for Windows drive letters)
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(filePath)) {
          return {
            valid: false,
            statusCode: 403,
            error: 'INVALID_PATH',
            message: 'Access denied: Invalid path format',
          };
        }
      }

      return {
        valid: true,
        resolvedPath,
        normalizedPath,
      };
    } catch (error) {
      console.error(`Error validating file path: ${error.message}`);
      return {
        valid: false,
        statusCode: 403,
        error: 'PATH_VALIDATION_ERROR',
        message: 'Path validation failed',
      };
    }
  }

  /**
   * Sanitize file path to show only relative path
   * Requirement 9.6: Sanitize sensitive information (file paths to relative paths only)
   * 
   * @param {string} filePath - Full file path
   * @param {string} projectRoot - Project root directory
   * @returns {string} Sanitized relative path
   */
  sanitizeFilePath(filePath, projectRoot) {
    try {
      // If no file path provided, return empty string
      if (!filePath) {
        return '';
      }

      // Normalize paths
      const normalizedPath = path.normalize(filePath);
      const normalizedRoot = path.normalize(projectRoot || process.cwd());

      // Try to make path relative to project root
      let relativePath = path.relative(normalizedRoot, normalizedPath);

      // If path is outside project root, just return the basename
      if (relativePath.startsWith('..')) {
        relativePath = path.basename(normalizedPath);
      }

      // Convert backslashes to forward slashes for consistency
      relativePath = relativePath.replace(/\\/g, '/');

      return relativePath;
    } catch (error) {
      console.error(`Error sanitizing file path: ${error.message}`);
      // On error, return just the filename as fallback
      return path.basename(filePath);
    }
  }

  /**
   * Sanitize multiple file paths in a data object
   * @param {Object} data - Data object containing file paths
   * @param {string} projectRoot - Project root directory
   * @param {Array<string>} pathFields - Field names that contain file paths
   * @returns {Object} Data object with sanitized paths
   */
  sanitizeDataPaths(data, projectRoot, pathFields = ['filePath', 'file_path']) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = { ...data };

    for (const field of pathFields) {
      if (sanitized[field]) {
        sanitized[field] = this.sanitizeFilePath(sanitized[field], projectRoot);
      }
    }

    return sanitized;
  }

  /**
   * Create 403 Forbidden error response
   * Requirement 9.4: Return 403 error response for invalid/expired tokens
   * 
   * @param {string} error - Error code
   * @param {string} message - Error message
   * @returns {Object} Error response object
   */
  create403Error(error, message) {
    return {
      statusCode: 403,
      error,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Send 403 error response via Express
   * @param {Object} res - Express response object
   * @param {string} error - Error code
   * @param {string} message - Error message
   */
  send403Response(res, error, message) {
    const errorResponse = this.create403Error(error, message);
    res.status(403).json(errorResponse);
  }

  /**
   * Generate secure random session ID
   * @returns {string} Secure random session ID
   */
  generateSecureSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Hash sensitive data (for logging purposes)
   * @param {string} data - Data to hash
   * @returns {string} SHA256 hash of data
   */
  hashSensitiveData(data) {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16); // Return first 16 characters for brevity
  }

  /**
   * Validate session ID format
   * @param {string} sessionId - Session ID to validate
   * @returns {boolean} Whether session ID format is valid
   */
  validateSessionIdFormat(sessionId) {
    // Session IDs should be UUID v4 format or hex strings
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const hexPattern = /^[0-9a-f]{32}$/i;
    
    return uuidPattern.test(sessionId) || hexPattern.test(sessionId);
  }

  /**
   * Get security configuration
   * @returns {Object} Security configuration
   */
  getSecurityConfig() {
    return {
      tokenExpirationHours: this.tokenExpirationMs / (60 * 60 * 1000),
      hasCustomSecret: this.secret !== 'default-secret-key-change-in-production',
      hashAlgorithm: 'HMAC-SHA256',
    };
  }
}

module.exports = SecurityModule;
