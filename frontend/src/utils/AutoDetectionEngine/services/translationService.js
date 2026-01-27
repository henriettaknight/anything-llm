/**
 * Hybrid Translation Service
 * 
 * Core translation service implementing hybrid translation strategy:
 * 1. Static mapping lookup (fastest)
 * 2. Memory cache
 * 3. Persistent cache
 * 4. AI translation fallback
 */

import { createDualModeAIAdapter } from '../utils/dualModeAIAdapter.js';
import {
  CATEGORY_TERMS,
  RISK_LEVELS,
  CONFIDENCE_LEVELS,
  TECH_TERMS,
  COMMON_PHRASES
} from '../i18n/termMapping.js';
import { detectUserLanguage } from '../utils/languageDetector.js';

/**
 * Hybrid Translation Service
 * Combines static term mapping with AI translation fallback
 */
export class HybridTranslationService {
  constructor() {
    // Initialize AI adapter
    this.aiAdapter = createDualModeAIAdapter();
    
    // Initialize memory cache
    this.cache = new Map();
    
    // Initialize static mappings
    this.staticMappings = {
      categories: CATEGORY_TERMS,
      risks: RISK_LEVELS,
      confidence: CONFIDENCE_LEVELS,
      terms: TECH_TERMS,
      phrases: COMMON_PHRASES
    };
    
    console.log('✅ HybridTranslationService initialized', {
      categoriesCount: Object.keys(CATEGORY_TERMS).length,
      termsCount: Object.keys(TECH_TERMS).length,
      phrasesCount: Object.keys(COMMON_PHRASES).length
    });
  }

  /**
   * Translate a list of defects
   * @param {Array} defects - Array of defect objects
   * @param {string} targetLang - Target language code
   * @returns {Promise<Array>} Translated defects
   */
  async translateDefects(defects, targetLang) {
    if (!defects || defects.length === 0) {
      return [];
    }

    console.log(`🔄 Translating ${defects.length} defects to ${targetLang}`);
    
    const translatedDefects = [];
    for (const defect of defects) {
      try {
        const translated = await this.translateDefect(defect, targetLang);
        translatedDefects.push(translated);
      } catch (error) {
        console.error('Error translating defect:', error);
        // On error, keep original defect
        translatedDefects.push(defect);
      }
    }
    
    console.log(`✅ Translated ${translatedDefects.length} defects`);
    return translatedDefects;
  }

  /**
   * Translate a single defect
   * @param {object} defect - Defect object
   * @param {string} targetLang - Target language code
   * @returns {Promise<object>} Translated defect
   */
  async translateDefect(defect, targetLang) {
    if (!defect) {
      return defect;
    }

    // Create a copy to avoid mutating original
    const translated = { ...defect };

    // Translate category (static mapping)
    if (translated.category) {
      translated.category = this.translateCategory(translated.category, targetLang);
    }

    // Translate risk level (static mapping)
    if (translated.risk) {
      translated.risk = this.translateRisk(translated.risk, targetLang);
    }

    // Translate confidence level (static mapping)
    if (translated.confidence) {
      translated.confidence = this.translateConfidence(translated.confidence, targetLang);
    }

    // Translate text fields (hybrid strategy)
    // Note: file, function, snippet, and lines are NOT translated (code/path)
    if (translated.howToTrigger) {
      translated.howToTrigger = await this.translateText(translated.howToTrigger, targetLang);
    }

    if (translated.suggestedFix) {
      translated.suggestedFix = await this.translateText(translated.suggestedFix, targetLang);
    }

    return translated;
  }

  /**
   * Translate text using hybrid strategy
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code
   * @returns {Promise<string>} Translated text
   */
  async translateText(text, targetLang) {
    // 1. Check if text is empty or null
    if (!text || text.trim() === '') {
      return text;
    }

    // 2. Check if target language is Chinese (no translation needed)
    if (targetLang === 'zh' || targetLang === 'zh-CN') {
      return text;
    }

    // 3. Try static mapping exact match
    const staticResult = this.tryStaticMapping(text, targetLang);
    if (staticResult) {
      return staticResult;
    }

    // 4. Try partial term replacement
    const partialResult = this.tryPartialReplacement(text, targetLang);
    if (partialResult.hasReplacement && partialResult.replacementRate > 0.8) {
      // If replacement rate > 80%, use it directly
      return partialResult.text;
    }

    // 5. Check memory cache
    const cacheKey = `${text}:${targetLang}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 6. Use AI translation as fallback
    try {
      const aiResult = await this.aiTranslate(text, targetLang);
      
      // Cache the result
      this.cache.set(cacheKey, aiResult);
      
      return aiResult;
    } catch (error) {
      console.error('AI translation failed, using partial replacement or original:', error);
      
      // Fallback: return partial replacement if available, otherwise original
      return partialResult.hasReplacement ? partialResult.text : text;
    }
  }

  /**
   * Translate category using static mapping
   * @param {string} category - Category code
   * @param {string} targetLang - Target language code
   * @returns {string} Translated category
   */
  translateCategory(category, targetLang) {
    if (!category) {
      return category;
    }

    const mapping = this.staticMappings.categories[category];
    if (mapping && mapping[targetLang]) {
      return mapping[targetLang];
    }

    // If no mapping found, return original
    return category;
  }

  /**
   * Translate risk level using static mapping
   * @param {string} risk - Risk level
   * @param {string} targetLang - Target language code
   * @returns {string} Translated risk level
   */
  translateRisk(risk, targetLang) {
    if (!risk) {
      return risk;
    }

    const mapping = this.staticMappings.risks[risk];
    if (mapping && mapping[targetLang]) {
      return mapping[targetLang];
    }

    // If no mapping found, return original
    return risk;
  }

  /**
   * Translate confidence level using static mapping
   * @param {string} confidence - Confidence level
   * @param {string} targetLang - Target language code
   * @returns {string} Translated confidence level
   */
  translateConfidence(confidence, targetLang) {
    if (!confidence) {
      return confidence;
    }

    const mapping = this.staticMappings.confidence[confidence];
    if (mapping && mapping[targetLang]) {
      return mapping[targetLang];
    }

    // If no mapping found, return original
    return confidence;
  }

  /**
   * Try static mapping exact match
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code
   * @returns {string|null} Translated text or null
   */
  tryStaticMapping(text, targetLang) {
    if (!text) {
      return null;
    }

    // Try tech terms
    const techMapping = this.staticMappings.terms[text];
    if (techMapping && techMapping[targetLang]) {
      return techMapping[targetLang];
    }

    // Try common phrases
    const phraseMapping = this.staticMappings.phrases[text];
    if (phraseMapping && phraseMapping[targetLang]) {
      return phraseMapping[targetLang];
    }

    return null;
  }

  /**
   * Try partial term replacement
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code
   * @returns {object} Replacement result with text, hasReplacement, and replacementRate
   */
  tryPartialReplacement(text, targetLang) {
    if (!text) {
      return {
        text,
        hasReplacement: false,
        replacementRate: 0
      };
    }

    let replacedText = text;
    let replacementCount = 0;
    const originalLength = text.length;

    // Combine all mappings for replacement
    const allMappings = {
      ...this.staticMappings.terms,
      ...this.staticMappings.phrases
    };

    // Sort by length (longest first) to avoid partial replacements
    const sortedTerms = Object.keys(allMappings).sort((a, b) => b.length - a.length);

    // Replace each term found in the text
    for (const term of sortedTerms) {
      const mapping = allMappings[term];
      if (mapping && mapping[targetLang] && replacedText.includes(term)) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const beforeReplace = replacedText;
        replacedText = replacedText.replace(regex, mapping[targetLang]);
        
        if (beforeReplace !== replacedText) {
          replacementCount++;
        }
      }
    }

    // Calculate replacement rate based on character changes
    const replacedLength = replacedText.length;
    const hasReplacement = replacementCount > 0;
    
    // Estimate replacement rate: if we replaced terms, assume good coverage
    // This is a heuristic - more replacements = higher confidence
    const replacementRate = hasReplacement ? Math.min(replacementCount * 0.3, 1.0) : 0;

    return {
      text: replacedText,
      hasReplacement,
      replacementRate
    };
  }

  /**
   * Translate using AI
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code
   * @returns {Promise<string>} Translated text
   */
  async aiTranslate(text, targetLang) {
    if (!text) {
      return text;
    }

    console.log(`🤖 AI translating to ${targetLang}:`, text.substring(0, 100));

    // Create timeout controller (30 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Prepare translation prompt with stronger instructions
      const messages = [
        {
          role: 'system',
          content: `You are a professional technical translator specializing in software engineering documentation.

TASK: Translate ALL Chinese text to ${this.getLanguageName(targetLang)}.

CRITICAL RULES:
1. Translate EVERY Chinese character - leave NO Chinese text untranslated
2. Keep technical terms accurate (nullptr, pointer, function names)
3. Do NOT translate: code snippets in backticks, file paths, function names in backticks
4. Maintain the original sentence structure and meaning
5. Use professional technical English
6. Output ONLY the translated text - no explanations, no notes

EXAMPLES:
Input: "当 \`KilledCreature\` 为 \`nullptr\` 时会崩溃"
Output: "Crashes when \`KilledCreature\` is \`nullptr\`"

Input: "在调用前检查指针是否为空"
Output: "Check if the pointer is null before calling"

Now translate the following text:`
        },
        {
          role: 'user',
          content: text
        }
      ];

      // Stream AI response
      let translatedText = '';
      for await (const chunk of this.aiAdapter.streamChat(messages, { signal: controller.signal })) {
        translatedText += chunk;
      }

      clearTimeout(timeoutId);

      // Clean up the result
      translatedText = translatedText.trim();

      // Verify translation quality - check if Chinese still exists
      const hasChinese = /[\u4e00-\u9fa5]/.test(translatedText);
      if (hasChinese) {
        console.warn('⚠️ Translation still contains Chinese characters:', translatedText);
        // Try one more time with even stronger prompt
        return await this.retryTranslation(text, targetLang);
      }

      console.log(`✅ AI translation completed:`, translatedText.substring(0, 100));

      return translatedText;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        console.error('❌ AI translation timeout (30s)');
        throw new Error('AI translation timeout');
      }

      console.error('❌ AI translation error:', error);
      throw error;
    }
  }

  /**
   * Retry translation with stronger prompt
   * @private
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code
   * @returns {Promise<string>} Translated text
   */
  async retryTranslation(text, targetLang) {
    console.log('🔄 Retrying translation with stronger prompt...');
    
    try {
      const messages = [
        {
          role: 'system',
          content: `You are a technical translator. Your ONLY job is to translate Chinese to ${this.getLanguageName(targetLang)}.

ABSOLUTE REQUIREMENT: The output must contain ZERO Chinese characters.

Translate this text completely to ${this.getLanguageName(targetLang)}:`
        },
        {
          role: 'user',
          content: `Translate to ${this.getLanguageName(targetLang)}, remove ALL Chinese: ${text}`
        }
      ];

      let translatedText = '';
      for await (const chunk of this.aiAdapter.streamChat(messages)) {
        translatedText += chunk;
      }

      return translatedText.trim();
    } catch (error) {
      console.error('❌ Retry translation failed:', error);
      // Return original text as last resort
      return text;
    }
  }

  /**
   * Get language name for AI prompt
   * @private
   * @param {string} langCode - Language code
   * @returns {string} Language name
   */
  getLanguageName(langCode) {
    const languageNames = {
      'en': 'English',
      'ja': 'Japanese',
      'ko': 'Korean',
      'de': 'German',
      'fr': 'French',
      'es': 'Spanish'
    };

    return languageNames[langCode] || 'English';
  }
}

/**
 * Cached Translation Service
 * Extends HybridTranslationService with three-layer caching
 */
export class CachedTranslationService extends HybridTranslationService {
  constructor() {
    super();
    this.memoryCache = new Map();
    this.persistentCache = this.loadPersistentCache();
    
    console.log('✅ CachedTranslationService initialized', {
      persistentCacheSize: Object.keys(this.persistentCache).length
    });
  }

  /**
   * Load persistent cache from localStorage
   * @returns {object} Cached translations
   */
  loadPersistentCache() {
    try {
      const cacheKey = 'anythingllm_translation_cache';
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const parsed = JSON.parse(cached);
        console.log(`📦 Loaded ${Object.keys(parsed).length} cached translations from localStorage`);
        return parsed;
      }
    } catch (error) {
      console.warn('⚠️ Failed to load persistent cache:', error);
    }
    
    return {};
  }

  /**
   * Save to persistent cache
   * @param {string} key - Cache key
   * @param {string} value - Translation result
   */
  saveToPersistentCache(key, value) {
    try {
      this.persistentCache[key] = value;
      
      const cacheKey = 'anythingllm_translation_cache';
      const cacheString = JSON.stringify(this.persistentCache);
      
      // Check cache size (limit to 5MB)
      const sizeInBytes = new Blob([cacheString]).size;
      const sizeInMB = sizeInBytes / (1024 * 1024);
      
      if (sizeInMB > 5) {
        console.warn('⚠️ Cache size exceeds 5MB, clearing old entries');
        // Clear half of the cache (simple strategy)
        const entries = Object.entries(this.persistentCache);
        const halfSize = Math.floor(entries.length / 2);
        this.persistentCache = Object.fromEntries(entries.slice(halfSize));
      }
      
      localStorage.setItem(cacheKey, JSON.stringify(this.persistentCache));
    } catch (error) {
      console.warn('⚠️ Failed to save to persistent cache:', error);
    }
  }

  /**
   * Translate text with three-layer cache lookup
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code
   * @returns {Promise<string>} Translated text
   */
  async translateText(text, targetLang) {
    // 1. Check if text is empty or null
    if (!text || text.trim() === '') {
      return text;
    }

    // 2. Check if target language is Chinese (no translation needed)
    if (targetLang === 'zh' || targetLang === 'zh-CN') {
      return text;
    }

    const cacheKey = `${text}:${targetLang}`;

    // 3. Try static mapping exact match (Layer 1)
    const staticResult = this.tryStaticMapping(text, targetLang);
    if (staticResult) {
      return staticResult;
    }

    // 4. Try memory cache (Layer 2)
    if (this.memoryCache.has(cacheKey)) {
      console.log('💾 Memory cache hit');
      return this.memoryCache.get(cacheKey);
    }

    // 5. Try persistent cache (Layer 3)
    if (this.persistentCache[cacheKey]) {
      console.log('💿 Persistent cache hit');
      const result = this.persistentCache[cacheKey];
      
      // Promote to memory cache
      this.memoryCache.set(cacheKey, result);
      
      return result;
    }

    // 6. Try partial term replacement
    const partialResult = this.tryPartialReplacement(text, targetLang);
    if (partialResult.hasReplacement && partialResult.replacementRate > 0.8) {
      // Cache the partial replacement result
      this.memoryCache.set(cacheKey, partialResult.text);
      this.saveToPersistentCache(cacheKey, partialResult.text);
      return partialResult.text;
    }

    // 7. Use AI translation as fallback
    try {
      const aiResult = await this.aiTranslate(text, targetLang);
      
      // Cache the result in both layers
      this.memoryCache.set(cacheKey, aiResult);
      this.saveToPersistentCache(cacheKey, aiResult);
      
      return aiResult;
    } catch (error) {
      console.error('AI translation failed, using partial replacement or original:', error);
      
      // Fallback: return partial replacement if available, otherwise original
      return partialResult.hasReplacement ? partialResult.text : text;
    }
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.memoryCache.clear();
    this.persistentCache = {};
    
    try {
      localStorage.removeItem('anythingllm_translation_cache');
      console.log('🗑️ All caches cleared');
    } catch (error) {
      console.warn('⚠️ Failed to clear persistent cache:', error);
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getCacheStats() {
    return {
      memoryCache: this.memoryCache.size,
      persistentCache: Object.keys(this.persistentCache).length,
      total: this.memoryCache.size + Object.keys(this.persistentCache).length
    };
  }
}

/**
 * Create a translation service instance
 * @param {boolean} useCache - Whether to use caching (default: true)
 * @returns {HybridTranslationService|CachedTranslationService}
 */
export function createTranslationService(useCache = true) {
  if (useCache) {
    return new CachedTranslationService();
  }
  return new HybridTranslationService();
}

export default CachedTranslationService;
