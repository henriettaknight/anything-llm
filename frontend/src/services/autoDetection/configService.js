/**
 * Frontend Configuration Management Service
 * Provides configuration management with localStorage persistence,
 * validation, and change notification capabilities
 */

import ConfigStorage from '@/utils/AutoDetectionEngine/storage/configStorage';

/**
 * Configuration change listeners
 */
const configChangeListeners = new Set();

/**
 * Configuration Service
 * Manages auto detection configuration with localStorage persistence
 */
class ConfigService {
  constructor() {
    this.currentConfig = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the service and load configuration
   * @returns {Promise<Object>} Loaded configuration
   */
  async initialize() {
    if (this.isInitialized) {
      return this.currentConfig;
    }

    try {
      this.currentConfig = ConfigStorage.load();
      this.isInitialized = true;
      return this.currentConfig;
    } catch (error) {
      console.error('Error initializing config service:', error);
      this.currentConfig = ConfigStorage.getDefault();
      this.isInitialized = true;
      return this.currentConfig;
    }
  }

  /**
   * Get current configuration
   * @returns {Promise<Object>} Current configuration
   */
  async getConfig() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return { ...this.currentConfig };
  }

  /**
   * Save configuration
   * @param {Object} config - Configuration to save
   * @returns {Promise<Object>} Result with success status
   */
  async saveConfig(config) {
    try {
      // Validate configuration
      if (!ConfigStorage.validate(config)) {
        return {
          success: false,
          error: 'Invalid configuration format'
        };
      }

      // Save to storage
      const saved = ConfigStorage.save(config);
      
      if (!saved) {
        return {
          success: false,
          error: 'Failed to save configuration'
        };
      }

      // Update current config
      const oldConfig = this.currentConfig;
      this.currentConfig = ConfigStorage.load();

      // Notify listeners
      this.notifyConfigChange(this.currentConfig, oldConfig);

      return {
        success: true,
        config: { ...this.currentConfig }
      };
    } catch (error) {
      console.error('Error saving configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update partial configuration
   * @param {Object} updates - Partial configuration updates
   * @returns {Promise<Object>} Result with success status
   */
  async updateConfig(updates) {
    try {
      const current = await this.getConfig();
      const updated = { ...current, ...updates };
      return await this.saveConfig(updated);
    } catch (error) {
      console.error('Error updating configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate configuration
   * @param {Object} config - Configuration to validate
   * @returns {Object} Validation result
   */
  validateConfig(config) {
    const isValid = ConfigStorage.validate(config);
    
    if (!isValid) {
      return {
        valid: false,
        errors: ['Configuration validation failed']
      };
    }

    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Reset configuration to defaults
   * @returns {Promise<Object>} Result with success status
   */
  async resetConfig() {
    try {
      ConfigStorage.reset();
      const oldConfig = this.currentConfig;
      this.currentConfig = ConfigStorage.getDefault();
      
      // Notify listeners
      this.notifyConfigChange(this.currentConfig, oldConfig);

      return {
        success: true,
        config: { ...this.currentConfig }
      };
    } catch (error) {
      console.error('Error resetting configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if configuration exists
   * @returns {boolean} Existence status
   */
  configExists() {
    return ConfigStorage.exists();
  }

  /**
   * Export configuration as JSON
   * @returns {string|null} JSON string or null
   */
  exportConfig() {
    return ConfigStorage.export();
  }

  /**
   * Import configuration from JSON
   * @param {string} jsonString - JSON string to import
   * @returns {Promise<Object>} Result with success status
   */
  async importConfig(jsonString) {
    try {
      const imported = ConfigStorage.import(jsonString);
      
      if (!imported) {
        return {
          success: false,
          error: 'Failed to import configuration'
        };
      }

      const oldConfig = this.currentConfig;
      this.currentConfig = ConfigStorage.load();
      
      // Notify listeners
      this.notifyConfigChange(this.currentConfig, oldConfig);

      return {
        success: true,
        config: { ...this.currentConfig }
      };
    } catch (error) {
      console.error('Error importing configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Subscribe to configuration changes
   * @param {Function} listener - Callback function (newConfig, oldConfig) => void
   * @returns {Function} Unsubscribe function
   */
  onConfigChange(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    configChangeListeners.add(listener);

    // Return unsubscribe function
    return () => {
      configChangeListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of configuration change
   * @param {Object} newConfig - New configuration
   * @param {Object} oldConfig - Old configuration
   */
  notifyConfigChange(newConfig, oldConfig) {
    configChangeListeners.forEach(listener => {
      try {
        listener(newConfig, oldConfig);
      } catch (error) {
        console.error('Error in config change listener:', error);
      }
    });
  }

  /**
   * Get configuration field value
   * @param {string} field - Field name
   * @param {*} defaultValue - Default value if field not found
   * @returns {*} Field value
   */
  async getConfigField(field, defaultValue = null) {
    const config = await this.getConfig();
    return config[field] !== undefined ? config[field] : defaultValue;
  }

  /**
   * Set configuration field value
   * @param {string} field - Field name
   * @param {*} value - Field value
   * @returns {Promise<Object>} Result with success status
   */
  async setConfigField(field, value) {
    return await this.updateConfig({ [field]: value });
  }

  /**
   * Enable auto detection
   * @returns {Promise<Object>} Result with success status
   */
  async enable() {
    return await this.setConfigField('enabled', true);
  }

  /**
   * Disable auto detection
   * @returns {Promise<Object>} Result with success status
   */
  async disable() {
    return await this.setConfigField('enabled', false);
  }

  /**
   * Check if auto detection is enabled
   * @returns {Promise<boolean>} Enabled status
   */
  async isEnabled() {
    return await this.getConfigField('enabled', false);
  }

  /**
   * Get target directory
   * @returns {Promise<string>} Target directory path
   */
  async getTargetDirectory() {
    return await this.getConfigField('targetDirectory', '');
  }

  /**
   * Set target directory
   * @param {string} directory - Directory path
   * @returns {Promise<Object>} Result with success status
   */
  async setTargetDirectory(directory) {
    return await this.setConfigField('targetDirectory', directory);
  }

  /**
   * Get detection time
   * @returns {Promise<string>} Detection time (HH:MM)
   */
  async getDetectionTime() {
    return await this.getConfigField('detectionTime', '09:00');
  }

  /**
   * Set detection time
   * @param {string} time - Detection time (HH:MM)
   * @returns {Promise<Object>} Result with success status
   */
  async setDetectionTime(time) {
    return await this.setConfigField('detectionTime', time);
  }

  /**
   * Get file types
   * @returns {Promise<Array>} File type extensions
   */
  async getFileTypes() {
    return await this.getConfigField('fileTypes', ['.h', '.cpp']);
  }

  /**
   * Set file types
   * @param {Array} fileTypes - File type extensions
   * @returns {Promise<Object>} Result with success status
   */
  async setFileTypes(fileTypes) {
    return await this.setConfigField('fileTypes', fileTypes);
  }

  /**
   * Get exclude patterns
   * @returns {Promise<Array>} Exclude patterns
   */
  async getExcludePatterns() {
    return await this.getConfigField('excludePatterns', []);
  }

  /**
   * Set exclude patterns
   * @param {Array} patterns - Exclude patterns
   * @returns {Promise<Object>} Result with success status
   */
  async setExcludePatterns(patterns) {
    return await this.setConfigField('excludePatterns', patterns);
  }

  /**
   * Get batch size
   * @returns {Promise<number>} Batch size
   */
  async getBatchSize() {
    return await this.getConfigField('batchSize', 10);
  }

  /**
   * Set batch size
   * @param {number} size - Batch size
   * @returns {Promise<Object>} Result with success status
   */
  async setBatchSize(size) {
    return await this.setConfigField('batchSize', size);
  }
}

// Create singleton instance
const configService = new ConfigService();

export default configService;
