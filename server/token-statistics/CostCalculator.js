/**
 * CostCalculator
 * Calculates costs for different AI models based on token usage
 */

const fs = require('fs').promises;
const path = require('path');
const { ConfigError, ErrorCode } = require('./ErrorTypes');
const { createLogger } = require('./Logger');
const ErrorHandler = require('./ErrorHandler');

class CostCalculator {
  constructor() {
    this.pricingConfig = null;
    this.configPath = path.join(__dirname, 'config', 'pricing.json');
    this.logger = createLogger('CostCalculator');
  }

  /**
   * Load pricing configuration
   * @returns {Promise<Object>} Pricing configuration
   */
  async loadPricingConfig() {
    if (this.pricingConfig) {
      return this.pricingConfig;
    }

    try {
      this.logger.debug('Loading pricing configuration', { configPath: this.configPath });
      
      const configData = await fs.readFile(this.configPath, 'utf-8');
      this.pricingConfig = JSON.parse(configData);
      
      this.logger.info('Pricing configuration loaded', {
        version: this.pricingConfig.version,
        modelCount: Object.keys(this.pricingConfig.models).length,
      });
      
      return this.pricingConfig;
    } catch (error) {
      this.logger.warn('Failed to load pricing config, using defaults', { error: error.message });
      // Return default pricing
      this.pricingConfig = this._getDefaultPricing();
      return this.pricingConfig;
    }
  }

  /**
   * Update pricing configuration
   * @param {Object} config - New pricing configuration
   */
  async updatePricingConfig(config) {
    const writeOperation = async () => {
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      this.pricingConfig = config;
    };

    try {
      this.logger.info('Updating pricing configuration', { version: config.version });
      
      await ErrorHandler.handleFileWrite(writeOperation, this.configPath);
      
      this.logger.info('Pricing configuration updated successfully');
    } catch (error) {
      this.logger.error('Failed to update pricing config', error);
      throw new ConfigError(
        ErrorCode.CONFIG_SAVE_ERROR,
        'Failed to update pricing configuration',
        { configPath: this.configPath },
        error
      );
    }
  }

  /**
   * Calculate cost for a specific model
   * @param {number} inputTokens - Number of input tokens
   * @param {number} outputTokens - Number of output tokens
   * @param {Object} model - Pricing model configuration
   * @returns {Object} Cost result
   */
  calculateCost(inputTokens, outputTokens, model) {
    const inputCost = (inputTokens / 1000) * model.inputPricePerK;
    const outputCost = (outputTokens / 1000) * model.outputPricePerK;
    const totalCost = inputCost + outputCost;

    return {
      inputCost: parseFloat(inputCost.toFixed(6)),
      outputCost: parseFloat(outputCost.toFixed(6)),
      totalCost: parseFloat(totalCost.toFixed(6)),
      currency: model.currency || 'USD',
    };
  }

  /**
   * Compare costs across different models
   * @param {number} inputTokens - Number of input tokens
   * @param {number} outputTokens - Number of output tokens
   * @returns {Object} Cost comparison
   */
  compareCosts(inputTokens, outputTokens) {
    const pricing = this.pricingConfig || this._getDefaultPricing();

    const deepseekCost = this.calculateCost(
      inputTokens,
      outputTokens,
      pricing.models.deepseek
    );

    const claudeCost = this.calculateCost(
      inputTokens,
      outputTokens,
      pricing.models.claude_sonnet
    );

    const difference = claudeCost.totalCost - deepseekCost.totalCost;
    const percentageDiff = deepseekCost.totalCost > 0
      ? ((difference / deepseekCost.totalCost) * 100)
      : 0;

    return {
      deepseek: deepseekCost,
      claude: claudeCost,
      difference: parseFloat(difference.toFixed(6)),
      percentageDiff: parseFloat(percentageDiff.toFixed(2)),
    };
  }

  /**
   * Get default pricing configuration
   * @private
   */
  _getDefaultPricing() {
    return {
      version: '2026-04',
      updatedAt: new Date().toISOString(),
      models: {
        deepseek: {
          name: 'DeepSeek',
          inputPricePerK: 0.001,
          outputPricePerK: 0.002,
          currency: 'USD',
        },
        claude_sonnet: {
          name: 'Claude-3.5-Sonnet',
          inputPricePerK: 0.003,
          outputPricePerK: 0.015,
          currency: 'USD',
        },
        claude_opus: {
          name: 'Claude-3-Opus',
          inputPricePerK: 0.015,
          outputPricePerK: 0.075,
          currency: 'USD',
        },
        claude_haiku: {
          name: 'Claude-3-Haiku',
          inputPricePerK: 0.00025,
          outputPricePerK: 0.00125,
          currency: 'USD',
        },
      },
    };
  }
}

module.exports = CostCalculator;
