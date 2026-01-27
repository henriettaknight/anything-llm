/**
 * Translation Enhancer
 * 
 * Provides additional translation quality checks and fixes
 * for mixed Chinese-English content
 */

/**
 * Check if text contains Chinese characters
 * @param {string} text - Text to check
 * @returns {boolean} True if contains Chinese
 */
export function containsChinese(text) {
  if (!text) return false;
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * Extract Chinese segments from mixed text
 * @param {string} text - Mixed text
 * @returns {Array} Array of {chinese, start, end}
 */
export function extractChineseSegments(text) {
  if (!text) return [];
  
  const segments = [];
  const regex = /[\u4e00-\u9fa5]+/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    segments.push({
      chinese: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return segments;
}

/**
 * Split text into translatable and non-translatable parts
 * @param {string} text - Text to split
 * @returns {Array} Array of {text, shouldTranslate}
 */
export function splitTextForTranslation(text) {
  if (!text) return [];
  
  const parts = [];
  let lastIndex = 0;
  
  // Pattern to match code in backticks, file paths, and function names
  const codePattern = /`[^`]+`|[A-Z][a-zA-Z0-9_]*::|[a-z_][a-zA-Z0-9_]*\(\)|[A-Z][a-zA-Z0-9_]*->[a-zA-Z0-9_]+/g;
  
  let match;
  const matches = [];
  
  while ((match = codePattern.exec(text)) !== null) {
    matches.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // Build parts array
  matches.forEach((match, index) => {
    // Add text before this match (should translate)
    if (match.start > lastIndex) {
      const beforeText = text.substring(lastIndex, match.start);
      if (beforeText.trim()) {
        parts.push({
          text: beforeText,
          shouldTranslate: true
        });
      }
    }
    
    // Add the match itself (should NOT translate)
    parts.push({
      text: match.text,
      shouldTranslate: false
    });
    
    lastIndex = match.end;
  });
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    if (remainingText.trim()) {
      parts.push({
        text: remainingText,
        shouldTranslate: true
      });
    }
  }
  
  // If no matches found, return entire text as translatable
  if (parts.length === 0) {
    parts.push({
      text: text,
      shouldTranslate: true
    });
  }
  
  return parts;
}

/**
 * Translate mixed content by splitting and translating only Chinese parts
 * @param {string} text - Mixed text
 * @param {Function} translateFn - Translation function
 * @param {string} targetLang - Target language
 * @returns {Promise<string>} Translated text
 */
export async function translateMixedContent(text, translateFn, targetLang) {
  if (!text || !containsChinese(text)) {
    return text;
  }
  
  console.log('🔧 Processing mixed content:', text.substring(0, 100));
  
  // Split text into parts
  const parts = splitTextForTranslation(text);
  
  // Translate each part
  const translatedParts = [];
  for (const part of parts) {
    if (part.shouldTranslate && containsChinese(part.text)) {
      try {
        const translated = await translateFn(part.text, targetLang);
        translatedParts.push(translated);
      } catch (error) {
        console.error('Failed to translate part:', part.text, error);
        translatedParts.push(part.text); // Keep original on error
      }
    } else {
      translatedParts.push(part.text);
    }
  }
  
  const result = translatedParts.join('');
  
  // Verify result
  if (containsChinese(result)) {
    console.warn('⚠️ Result still contains Chinese after mixed translation');
  }
  
  return result;
}

/**
 * Post-process translation to fix common issues
 * @param {string} text - Translated text
 * @param {string} originalText - Original text
 * @returns {string} Fixed text
 */
export function postProcessTranslation(text, originalText) {
  if (!text) return text;
  
  let result = text;
  
  // Fix common translation artifacts
  result = result.replace(/\s+/g, ' '); // Normalize whitespace
  result = result.replace(/\s+([.,;:!?])/g, '$1'); // Fix punctuation spacing
  result = result.replace(/`\s+/g, '`'); // Fix backtick spacing
  result = result.replace(/\s+`/g, '`');
  
  // Preserve code formatting from original
  const originalCodeBlocks = originalText.match(/`[^`]+`/g) || [];
  const translatedCodeBlocks = result.match(/`[^`]+`/g) || [];
  
  // Replace translated code blocks with original ones
  originalCodeBlocks.forEach((originalBlock, index) => {
    if (translatedCodeBlocks[index]) {
      result = result.replace(translatedCodeBlocks[index], originalBlock);
    }
  });
  
  return result.trim();
}

/**
 * Validate translation quality
 * @param {string} translatedText - Translated text
 * @param {string} originalText - Original text
 * @param {string} targetLang - Target language
 * @returns {Object} Validation result
 */
export function validateTranslation(translatedText, originalText, targetLang) {
  const result = {
    isValid: true,
    issues: [],
    score: 100
  };
  
  // Check 1: No Chinese characters (for non-Chinese targets)
  if (targetLang !== 'zh' && targetLang !== 'zh-CN') {
    if (containsChinese(translatedText)) {
      result.isValid = false;
      result.issues.push('Contains untranslated Chinese characters');
      result.score -= 50;
      
      const segments = extractChineseSegments(translatedText);
      result.chineseSegments = segments;
    }
  }
  
  // Check 2: Not empty
  if (!translatedText || translatedText.trim() === '') {
    result.isValid = false;
    result.issues.push('Translation is empty');
    result.score = 0;
  }
  
  // Check 3: Not same as original (if original was Chinese)
  if (containsChinese(originalText) && translatedText === originalText) {
    result.isValid = false;
    result.issues.push('Translation is identical to original');
    result.score -= 30;
  }
  
  // Check 4: Reasonable length (not too short or too long)
  const lengthRatio = translatedText.length / originalText.length;
  if (lengthRatio < 0.3 || lengthRatio > 3.0) {
    result.issues.push(`Unusual length ratio: ${lengthRatio.toFixed(2)}`);
    result.score -= 10;
  }
  
  // Check 5: Code blocks preserved
  const originalCodeBlocks = (originalText.match(/`[^`]+`/g) || []).length;
  const translatedCodeBlocks = (translatedText.match(/`[^`]+`/g) || []).length;
  
  if (originalCodeBlocks !== translatedCodeBlocks) {
    result.issues.push('Code block count mismatch');
    result.score -= 15;
  }
  
  return result;
}

/**
 * Enhanced translation with quality checks
 * @param {string} text - Text to translate
 * @param {Function} translateFn - Translation function
 * @param {string} targetLang - Target language
 * @param {Object} options - Options
 * @returns {Promise<Object>} Translation result with metadata
 */
export async function enhancedTranslate(text, translateFn, targetLang, options = {}) {
  const {
    maxRetries = 2,
    useMixedMode = true,
    validateResult = true
  } = options;
  
  let attempt = 0;
  let lastError = null;
  let bestResult = null;
  let bestScore = 0;
  
  while (attempt < maxRetries) {
    try {
      attempt++;
      console.log(`🔄 Translation attempt ${attempt}/${maxRetries}`);
      
      // Try translation
      let result;
      if (useMixedMode && containsChinese(text)) {
        result = await translateMixedContent(text, translateFn, targetLang);
      } else {
        result = await translateFn(text, targetLang);
      }
      
      // Post-process
      result = postProcessTranslation(result, text);
      
      // Validate
      if (validateResult) {
        const validation = validateTranslation(result, text, targetLang);
        
        console.log(`📊 Translation quality score: ${validation.score}/100`);
        
        if (validation.issues.length > 0) {
          console.warn('⚠️ Translation issues:', validation.issues);
        }
        
        // Keep best result
        if (validation.score > bestScore) {
          bestScore = validation.score;
          bestResult = result;
        }
        
        // If valid, return immediately
        if (validation.isValid) {
          return {
            text: result,
            validation,
            attempts: attempt
          };
        }
      } else {
        return {
          text: result,
          attempts: attempt
        };
      }
      
    } catch (error) {
      console.error(`❌ Translation attempt ${attempt} failed:`, error);
      lastError = error;
    }
  }
  
  // Return best result or throw error
  if (bestResult) {
    console.warn('⚠️ Returning best result with score:', bestScore);
    return {
      text: bestResult,
      validation: validateTranslation(bestResult, text, targetLang),
      attempts: maxRetries,
      warning: 'Translation quality below threshold'
    };
  }
  
  throw lastError || new Error('Translation failed after all retries');
}

export default {
  containsChinese,
  extractChineseSegments,
  splitTextForTranslation,
  translateMixedContent,
  postProcessTranslation,
  validateTranslation,
  enhancedTranslate
};
