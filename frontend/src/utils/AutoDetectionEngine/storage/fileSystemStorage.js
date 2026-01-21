/**
 * File System Storage Service
 * Manages file system access using IndexedDB and File System Access API
 * Provides file handle persistence, permission management, and recovery
 */

const DB_NAME = 'AutoDetectionFileSystem';
const DB_VERSION = 1;
const STORE_NAME = 'fileHandles';

/**
 * File System Storage Service
 */
class FileSystemStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Initialize IndexedDB
   * @returns {Promise<IDBDatabase>} Database instance
   */
  async init() {
    if (this.db) {
      return this.db;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store for file handles
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('path', 'path', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Save a file or directory handle
   * @param {string} id - Unique identifier for the handle
   * @param {FileSystemHandle} handle - File or directory handle
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<boolean>} Success status
   */
  async saveHandle(id, handle, metadata = {}) {
    try {
      await this.init();

      const entry = {
        id,
        handle,
        type: handle.kind, // 'file' or 'directory'
        name: handle.name,
        path: metadata.path || handle.name,
        metadata: {
          ...metadata,
          savedAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString()
        }
      };

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(new Error('Failed to save handle'));
      });
    } catch (error) {
      console.error('Error saving file handle:', error);
      return false;
    }
  }

  /**
   * Retrieve a file or directory handle
   * @param {string} id - Handle identifier
   * @returns {Promise<Object|null>} Handle entry or null
   */
  async getHandle(id) {
    try {
      await this.init();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const entry = request.result;
          if (entry) {
            // Update last accessed time
            this.updateLastAccessed(id);
          }
          resolve(entry || null);
        };
        request.onerror = () => reject(new Error('Failed to retrieve handle'));
      });
    } catch (error) {
      console.error('Error retrieving file handle:', error);
      return null;
    }
  }

  /**
   * Get all stored handles
   * @returns {Promise<Array>} Array of handle entries
   */
  async getAllHandles() {
    try {
      await this.init();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(new Error('Failed to retrieve handles'));
      });
    } catch (error) {
      console.error('Error retrieving all handles:', error);
      return [];
    }
  }

  /**
   * Delete a handle
   * @param {string} id - Handle identifier
   * @returns {Promise<boolean>} Success status
   */
  async deleteHandle(id) {
    try {
      await this.init();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(new Error('Failed to delete handle'));
      });
    } catch (error) {
      console.error('Error deleting file handle:', error);
      return false;
    }
  }

  /**
   * Clear all stored handles
   * @returns {Promise<boolean>} Success status
   */
  async clearAll() {
    try {
      await this.init();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(new Error('Failed to clear handles'));
      });
    } catch (error) {
      console.error('Error clearing file handles:', error);
      return false;
    }
  }

  /**
   * Update last accessed timestamp
   * @param {string} id - Handle identifier
   * @returns {Promise<boolean>} Success status
   */
  async updateLastAccessed(id) {
    try {
      await this.init();

      const entry = await this.getHandle(id);
      if (!entry) {
        return false;
      }

      entry.metadata.lastAccessed = new Date().toISOString();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(new Error('Failed to update timestamp'));
      });
    } catch (error) {
      console.error('Error updating last accessed:', error);
      return false;
    }
  }

  /**
   * Verify file system permission for a handle
   * @param {FileSystemHandle} handle - File or directory handle
   * @param {string} mode - Permission mode ('read' or 'readwrite')
   * @returns {Promise<boolean>} Permission status
   */
  async verifyPermission(handle, mode = 'read') {
    try {
      const options = { mode };
      
      // Check if permission is already granted
      if ((await handle.queryPermission(options)) === 'granted') {
        return true;
      }

      // Request permission
      if ((await handle.requestPermission(options)) === 'granted') {
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error verifying permission:', error);
      return false;
    }
  }

  /**
   * Request directory access and save handle
   * @param {string} id - Identifier for the directory
   * @returns {Promise<Object|null>} Directory handle entry or null
   */
  async requestDirectoryAccess(id = 'targetDirectory') {
    try {
      // Check if File System Access API is supported
      if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API not supported');
      }

      // Request directory access
      const dirHandle = await window.showDirectoryPicker({
        mode: 'read'
      });

      // Save the handle
      await this.saveHandle(id, dirHandle, {
        path: dirHandle.name,
        requestedAt: new Date().toISOString()
      });

      return await this.getHandle(id);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('User cancelled directory selection');
      } else {
        console.error('Error requesting directory access:', error);
      }
      return null;
    }
  }

  /**
   * Recover and verify stored directory handle
   * @param {string} id - Directory handle identifier
   * @returns {Promise<Object|null>} Verified handle entry or null
   */
  async recoverDirectoryHandle(id = 'targetDirectory') {
    try {
      const entry = await this.getHandle(id);
      
      if (!entry || !entry.handle) {
        return null;
      }

      // Verify permission
      const hasPermission = await this.verifyPermission(entry.handle, 'read');
      
      if (!hasPermission) {
        console.warn('Permission denied for stored directory handle');
        return null;
      }

      return entry;
    } catch (error) {
      console.error('Error recovering directory handle:', error);
      return null;
    }
  }

  /**
   * Check if File System Access API is supported
   * @returns {boolean} Support status
   */
  static isSupported() {
    return 'showDirectoryPicker' in window && 
           'showOpenFilePicker' in window &&
           'indexedDB' in window;
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>} Storage statistics
   */
  async getStats() {
    try {
      const handles = await this.getAllHandles();
      
      const stats = {
        totalHandles: handles.length,
        directories: handles.filter(h => h.type === 'directory').length,
        files: handles.filter(h => h.type === 'file').length,
        oldestHandle: null,
        newestHandle: null
      };

      if (handles.length > 0) {
        const sorted = handles.sort((a, b) => 
          new Date(a.metadata.savedAt) - new Date(b.metadata.savedAt)
        );
        stats.oldestHandle = sorted[0].metadata.savedAt;
        stats.newestHandle = sorted[sorted.length - 1].metadata.savedAt;
      }

      return stats;
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return {
        totalHandles: 0,
        directories: 0,
        files: 0,
        oldestHandle: null,
        newestHandle: null
      };
    }
  }

  /**
   * Validate handle is still accessible
   * @param {string} id - Handle identifier
   * @returns {Promise<boolean>} Accessibility status
   */
  async validateHandle(id) {
    try {
      const entry = await this.getHandle(id);
      
      if (!entry || !entry.handle) {
        return false;
      }

      // Try to verify permission
      const hasPermission = await this.verifyPermission(entry.handle, 'read');
      
      return hasPermission;
    } catch (error) {
      console.error('Error validating handle:', error);
      return false;
    }
  }

  /**
   * Clean up invalid or inaccessible handles
   * @returns {Promise<number>} Number of handles removed
   */
  async cleanupInvalidHandles() {
    try {
      const handles = await this.getAllHandles();
      let removedCount = 0;

      for (const entry of handles) {
        const isValid = await this.validateHandle(entry.id);
        if (!isValid) {
          await this.deleteHandle(entry.id);
          removedCount++;
        }
      }

      return removedCount;
    } catch (error) {
      console.error('Error cleaning up invalid handles:', error);
      return 0;
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

// Create singleton instance
const fileSystemStorage = new FileSystemStorage();

export default fileSystemStorage;
