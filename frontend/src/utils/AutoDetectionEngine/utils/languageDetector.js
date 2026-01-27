/**
 * Language Detector
 * 
 * Detects user's language settings and determines if translation is needed.
 * Integrates with i18next to read current language configuration.
 */

import i18n from '@/i18n';

/**
 * Get current user language from i18next
 * @returns {string} Language code (e.g., 'zh', 'en', 'ja')
 */
export function detectUserLanguage() {
  try {
    // Get language from i18next
    const language = i18n.language || 'en';
    
    // Simplify language code (zh-CN → zh, en-US → en)
    const simplifiedLang = language.split('-')[0].toLowerCase();
    
    return simplifiedLang;
  } catch (error) {
    console.error('Error detecting user language:', error);
    return 'en'; // Default to English on error
  }
}

/**
 * Check if translation is needed based on current language
 * @returns {boolean} True if translation is needed (non-Chinese environment)
 */
export function needsTranslation() {
  try {
    const currentLang = detectUserLanguage();
    
    // Translation is needed if the language is not Chinese
    return currentLang !== 'zh';
  } catch (error) {
    console.error('Error checking translation need:', error);
    return false; // Default to no translation on error
  }
}

/**
 * Get full language code with region
 * @returns {string} Full language code (e.g., 'zh-CN', 'en-US')
 */
export function getFullLanguageCode() {
  try {
    // Get full language code from i18next
    const language = i18n.language || 'en-US';
    
    return language;
  } catch (error) {
    console.error('Error getting full language code:', error);
    return 'en-US'; // Default to en-US on error
  }
}
