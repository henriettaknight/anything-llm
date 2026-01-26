/**
 * AI Mode Configuration
 * Manages switching between direct AI mode (172.16.100.61) and LLM mode
 * 
 * Direct mode: Only enabled in development environment with explicit configuration
 * LLM mode: Default mode, used in production and when direct mode is not configured
 */

export const AI_MODES = {
  DIRECT: 'direct',
  LLM: 'llm'
};

/**
 * Get the current AI mode
 * 
 * Safety checks:
 * 1. Must be development environment (import.meta.env.DEV)
 * 2. Must explicitly set VITE_AI_MODE=direct
 * 3. Otherwise defaults to LLM mode
 * 
 * @returns {string} AI mode ('direct' or 'llm')
 */
export const getAIMode = () => {
  const isDev = import.meta.env.DEV;
  const requestedMode = import.meta.env.VITE_AI_MODE;
  
  // Only enable direct mode in development with explicit configuration
  if (isDev && requestedMode === AI_MODES.DIRECT) {
    console.warn('⚠️ Using direct AI mode (172.16.100.61:8000)');
    return AI_MODES.DIRECT;
  }
  
  // Default to LLM mode (production or not explicitly configured)
  return AI_MODES.LLM;
};

/**
 * Get AI configuration based on current mode
 * 
 * @returns {Object} AI configuration object
 */
export const getAIConfig = () => {
  const mode = getAIMode();
  
  if (mode === AI_MODES.DIRECT) {
    return {
      mode: 'direct',
      url: import.meta.env.VITE_DIRECT_AI_URL || 'http://172.16.100.61:8000',
      model: import.meta.env.VITE_DIRECT_AI_MODEL || 'gpt-oss-20b',
      apiKey: null,
      temperature: 0  // 确定性输出，确保检测结果的一致性（与SnailAI保持一致）
    };
  } else {
    return {
      mode: 'llm',
      workspace: import.meta.env.VITE_LLM_WORKSPACE || 'auto-detection',
      apiKey: null,
      temperature: 0  // 确定性输出，确保检测结果的一致性（与SnailAI保持一致）
    };
  }
};

/**
 * Check if direct mode is available
 * 
 * @returns {boolean} True if direct mode can be used
 */
export const isDirectModeAvailable = () => {
  return import.meta.env.DEV;
};

/**
 * Get AI mode info for logging/debugging
 * 
 * @returns {Object} Mode information
 */
export const getAIModeInfo = () => {
  const mode = getAIMode();
  const config = getAIConfig();
  
  return {
    mode,
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
    config,
    timestamp: new Date().toISOString()
  };
};
