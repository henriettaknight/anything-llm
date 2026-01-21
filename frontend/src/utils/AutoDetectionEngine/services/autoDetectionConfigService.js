/**
 * @fileoverview Configuration Service for Auto Detection Engine
 * Manages user detection preferences, validation, and persistence
 */

/**
 * @typedef {Object} AutoDetectionConfig
 * @property {boolean} enabled - Enable/disable auto detection
 * @property {string} targetDirectory - Directory to monitor
 * @property {string} targetTime - Scheduled detection time (HH:mm format)
 */

// Directory handle storage key name
const DIRECTORY_HANDLE_STORAGE_KEY = 'auto_detection_directory_handle';

// Configuration storage key name
const CONFIG_STORAGE_KEY = 'auto_detection_config';

/**
 * Save configuration to localStorage
 * @param {AutoDetectionConfig} config - Configuration to save
 * @returns {void}
 */
export const saveConfig = (config) => {
  try {
    // Only access localStorage in client environment
    if (typeof window !== 'undefined') {
      console.log('保存配置到localStorage:', config);
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
      console.log('配置保存成功');
    }
  } catch (error) {
    console.error('保存配置失败:', error);
  }
};

/**
 * Load configuration from localStorage
 * @returns {AutoDetectionConfig} - Loaded configuration or default config
 */
export const loadConfig = () => {
  try {
    // Only access localStorage in client environment
    if (typeof window !== 'undefined') {
      const storedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
      console.log('从localStorage读取配置:', storedConfig);
      if (storedConfig) {
        const config = JSON.parse(storedConfig);
        const validation = validateConfig(config);
        if (validation.isValid) {
          console.log('加载用户配置成功:', config);
          return config;
        } else {
          console.warn('用户配置验证失败，使用默认配置');
        }
      } else {
        console.log('localStorage中没有找到用户配置');
      }
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
  // Return valid default configuration
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  const defaultConfig = {
    enabled: false,  // Disabled by default, wait for user configuration
    targetDirectory: '',
    targetTime: `${hours}:${minutes}` // Current time in HH:mm format
  };
  
  console.log('使用默认配置:', defaultConfig);
  return defaultConfig;
};

/**
 * Check if target time has been reached
 * @param {string} targetTime - Target time in HH:mm format
 * @returns {boolean} - True if target time has been reached
 */
export const isTargetTimeReached = (targetTime) => {
  if (!targetTime || targetTime.trim() === '') {
    console.warn('目标时间配置无效，跳过检测');
    return false;
  }
  
  const now = new Date();
  
  // Convert HH:mm format to today's datetime
  const [hours, minutes] = targetTime.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    console.warn('目标时间格式解析失败，跳过检测');
    return false;
  }
  
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  
  const timeReached = now >= target;
  console.log(`目标时间检查: 当前时间=${now.toLocaleString()}, 目标时间=${target.toLocaleString()}, 是否到达=${timeReached}`);
  
  return timeReached;
};

/**
 * Calculate milliseconds to target time
 * @param {string} targetTime - Target time in HH:mm format
 * @returns {number} - Milliseconds to target time
 */
export const getTimeToTarget = (targetTime) => {
  if (!targetTime || targetTime.trim() === '') {
    return 0;
  }
  
  const now = new Date();
  
  // Convert HH:mm format to today's datetime
  const [hours, minutes] = targetTime.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return 0;
  }
  
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  
  return Math.max(0, target.getTime() - now.getTime());
};

/**
 * Validate configuration
 * @param {AutoDetectionConfig} config - Configuration to validate
 * @returns {{isValid: boolean, error?: string}} - Validation result
 */
export const validateConfig = (config) => {
  // Validate directory
  if (!config.targetDirectory) {
    return { isValid: false, error: '请指定检测目录' };
  }

  // Validate target time format (HH:mm)
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(config.targetTime)) {
    return { isValid: false, error: '目标时间格式不正确，请使用HH:mm格式' };
  }

  return { isValid: true };
};

/**
 * Save directoryHandle to IndexedDB
 * @param {FileSystemDirectoryHandle} handle - Directory handle to save
 * @returns {Promise<void>}
 */
export const saveDirectoryHandle = async (handle) => {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB 不可用');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('AutoDetectionDB', 1);

      request.onerror = () => {
        console.error('打开 IndexedDB 失败');
        reject(request.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('directoryHandles')) {
          db.createObjectStore('directoryHandles');
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['directoryHandles'], 'readwrite');
        const store = transaction.objectStore('directoryHandles');
        const putRequest = store.put(handle, DIRECTORY_HANDLE_STORAGE_KEY);

        putRequest.onsuccess = () => {
          console.log('directoryHandle 已保存到 IndexedDB');
          resolve();
        };

        putRequest.onerror = () => {
          console.error('保存 directoryHandle 失败');
          reject(putRequest.error);
        };
      };
    });
  } catch (error) {
    console.error('保存 directoryHandle 异常:', error);
  }
};

/**
 * Restore directoryHandle from IndexedDB
 * @returns {Promise<FileSystemDirectoryHandle|null>} - Restored directory handle or null
 */
export const restoreDirectoryHandle = async () => {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB 不可用');
      return null;
    }

    return new Promise((resolve) => {
      const request = indexedDB.open('AutoDetectionDB', 1);

      request.onerror = () => {
        console.error('打开 IndexedDB 失败');
        resolve(null);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('directoryHandles')) {
          db.createObjectStore('directoryHandles');
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['directoryHandles'], 'readonly');
        const store = transaction.objectStore('directoryHandles');
        const getRequest = store.get(DIRECTORY_HANDLE_STORAGE_KEY);

        getRequest.onsuccess = () => {
          const handle = getRequest.result;
          if (handle) {
            console.log('已从 IndexedDB 恢复 directoryHandle');
            resolve(handle);
          } else {
            console.log('IndexedDB 中没有保存的 directoryHandle');
            resolve(null);
          }
        };

        getRequest.onerror = () => {
          console.error('读取 directoryHandle 失败');
          resolve(null);
        };
      };
    });
  } catch (error) {
    console.error('恢复 directoryHandle 异常:', error);
    return null;
  }
};

/**
 * Verify if directoryHandle is still valid
 * @param {FileSystemDirectoryHandle} handle - Directory handle to verify
 * @returns {Promise<boolean>} - True if handle is valid
 */
export const verifyDirectoryHandle = async (handle) => {
  try {
    // Try to get directory permission status
    const permission = await handle.queryPermission({ mode: 'read' });
    return permission === 'granted';
  } catch (error) {
    console.error('验证 directoryHandle 失败:', error);
    return false;
  }
};
