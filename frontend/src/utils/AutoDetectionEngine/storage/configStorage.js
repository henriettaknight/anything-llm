/**
 * Configuration Storage Service
 * Manages configuration persistence using localStorage
 * Provides save, load, validation, and migration capabilities
 */

const CONFIG_STORAGE_KEY = 'autoDetection_config';
const CONFIG_VERSION = '1.0.0';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  enabled: false,
  targetDirectory: '',
  detectionTime: '09:00',
  fileTypes: ['.h', '.cpp', '.c', '.hpp', '.cc'],
  excludePatterns: [
    '**/node_modules/**',
    '**/build/**',
    '**/dist/**',
    '**/.git/**',
    '**/temp/**',
    '**/tmp/**'
  ],
  batchSize: 10,
  retryAttempts: 3,
  aiProvider: null,
  notificationEnabled: true,
  createdAt: null,
  updatedAt: null
};

/**
 * Configuration Storage Service
 */
class ConfigStorage {
  /**
   * Load configuration from localStorage
   * @returns {Object} Configuration object
   */
  static load() {
    try {
      const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
      
      if (!stored) {
        return this.getDefault();
      }

      const config = JSON.parse(stored);
      
      // Perform migration if needed
      const migratedConfig = this.migrate(config);
      
      // Validate the configuration
      if (!this.validate(migratedConfig)) {
        console.warn('Invalid configuration found, using defaults');
        return this.getDefault();
      }

      return migratedConfig;
    } catch (error) {
      console.error('Error loading configuration:', error);
      return this.getDefault();
    }
  }

  /**
   * Save configuration to localStorage
   * @param {Object} config - Configuration object to save
   * @returns {boolean} Success status
   */
  static save(config) {
    try {
      // Validate before saving
      if (!this.validate(config)) {
        throw new Error('Invalid configuration');
      }

      // Add metadata
      const configToSave = {
        ...config,
        version: CONFIG_VERSION,
        updatedAt: new Date().toISOString()
      };

      // If this is a new config, set createdAt
      if (!config.createdAt) {
        configToSave.createdAt = new Date().toISOString();
      }

      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configToSave));
      return true;
    } catch (error) {
      console.error('Error saving configuration:', error);
      return false;
    }
  }

  /**
   * Validate configuration object
   * @param {Object} config - Configuration to validate
   * @returns {boolean} Validation result
   */
  static validate(config) {
    if (!config || typeof config !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = [
      'enabled',
      'targetDirectory',
      'detectionTime',
      'fileTypes',
      'excludePatterns',
      'batchSize',
      'retryAttempts',
      'notificationEnabled'
    ];

    for (const field of requiredFields) {
      if (!(field in config)) {
        console.warn(`Missing required field: ${field}`);
        return false;
      }
    }

    // Type validations
    if (typeof config.enabled !== 'boolean') {
      console.warn('enabled must be boolean');
      return false;
    }

    if (typeof config.targetDirectory !== 'string') {
      console.warn('targetDirectory must be string');
      return false;
    }

    if (typeof config.detectionTime !== 'string' || !this.validateTimeFormat(config.detectionTime)) {
      console.warn('detectionTime must be valid time string (HH:MM)');
      return false;
    }

    if (!Array.isArray(config.fileTypes) || config.fileTypes.length === 0) {
      console.warn('fileTypes must be non-empty array');
      return false;
    }

    if (!Array.isArray(config.excludePatterns)) {
      console.warn('excludePatterns must be array');
      return false;
    }

    if (typeof config.batchSize !== 'number' || config.batchSize < 1 || config.batchSize > 100) {
      console.warn('batchSize must be number between 1 and 100');
      return false;
    }

    if (typeof config.retryAttempts !== 'number' || config.retryAttempts < 0 || config.retryAttempts > 10) {
      console.warn('retryAttempts must be number between 0 and 10');
      return false;
    }

    if (typeof config.notificationEnabled !== 'boolean') {
      console.warn('notificationEnabled must be boolean');
      return false;
    }

    return true;
  }

  /**
   * Validate time format (HH:MM)
   * @param {string} time - Time string to validate
   * @returns {boolean} Validation result
   */
  static validateTimeFormat(time) {
    // Allow both H:MM and HH:MM formats
    const timeRegex = /^([0-9]|[0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    return timeRegex.test(time);
  }

  /**
   * Get default configuration
   * @returns {Object} Default configuration object
   */
  static getDefault() {
    return {
      ...DEFAULT_CONFIG,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Migrate configuration from older versions
   * @param {Object} config - Configuration to migrate
   * @returns {Object} Migrated configuration
   */
  static migrate(config) {
    const version = config.version || '0.0.0';
    
    // No migrations needed yet, but structure is in place
    if (version === CONFIG_VERSION) {
      return config;
    }

    // Future migrations would go here
    // Example:
    // if (version < '1.1.0') {
    //   config = this.migrateToV1_1_0(config);
    // }

    // Update version
    config.version = CONFIG_VERSION;
    
    return config;
  }

  /**
   * Reset configuration to defaults
   * @returns {boolean} Success status
   */
  static reset() {
    try {
      localStorage.removeItem(CONFIG_STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Error resetting configuration:', error);
      return false;
    }
  }

  /**
   * Check if configuration exists
   * @returns {boolean} Existence status
   */
  static exists() {
    return localStorage.getItem(CONFIG_STORAGE_KEY) !== null;
  }

  /**
   * Update partial configuration
   * @param {Object} updates - Partial configuration updates
   * @returns {boolean} Success status
   */
  static update(updates) {
    try {
      const current = this.load();
      const updated = { ...current, ...updates };
      return this.save(updated);
    } catch (error) {
      console.error('Error updating configuration:', error);
      return false;
    }
  }

  /**
   * Export configuration as JSON string
   * @returns {string|null} JSON string or null on error
   */
  static export() {
    try {
      const config = this.load();
      return JSON.stringify(config, null, 2);
    } catch (error) {
      console.error('Error exporting configuration:', error);
      return null;
    }
  }

  /**
   * Import configuration from JSON string
   * @param {string} jsonString - JSON string to import
   * @returns {boolean} Success status
   */
  static import(jsonString) {
    try {
      const config = JSON.parse(jsonString);
      
      if (!this.validate(config)) {
        throw new Error('Invalid configuration format');
      }

      return this.save(config);
    } catch (error) {
      console.error('Error importing configuration:', error);
      return false;
    }
  }
}

export default ConfigStorage;
