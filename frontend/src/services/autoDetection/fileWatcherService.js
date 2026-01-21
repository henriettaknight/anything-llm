/**
 * Frontend File Watcher Service
 * Monitors file changes using File System Access API with debouncing
 * Requirements: 7.1, 7.2, 7.3
 */

const WATCHER_STATE_KEY = 'autoDetection_watcher_state';
const WATCHER_CONFIG_KEY = 'autoDetection_watcher_config';

/**
 * File change event listeners
 */
const fileChangeListeners = new Set();

/**
 * Watcher status
 */
export const WatcherStatus = {
  IDLE: 'idle',
  WATCHING: 'watching',
  PAUSED: 'paused',
  ERROR: 'error'
};

/**
 * Change detection sensitivity levels
 */
export const Sensitivity = {
  LOW: 'low',       // 5 second debounce
  MEDIUM: 'medium', // 2 second debounce
  HIGH: 'high'      // 500ms debounce
};

/**
 * Debounce delays by sensitivity
 */
const DEBOUNCE_DELAYS = {
  [Sensitivity.LOW]: 5000,
  [Sensitivity.MEDIUM]: 2000,
  [Sensitivity.HIGH]: 500
};

/**
 * Default file patterns to exclude
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  '*.tmp',
  '*.temp',
  '*.swp',
  '*.swo',
  '*~',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.bak',
  '*.cache'
];

/**
 * Frontend File Watcher Service
 * Monitors file system changes with debouncing
 */
class FileWatcherService {
  constructor() {
    this.directoryHandle = null;
    this.watchInterval = null;
    this.debounceTimers = new Map();
    this.fileSnapshots = new Map();
    this.state = {
      status: WatcherStatus.IDLE,
      watchedDirectory: null,
      lastChangeTime: null,
      changeCount: 0,
      error: null
    };
    this.config = {
      sensitivity: Sensitivity.MEDIUM,
      excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
      fileTypes: ['.h', '.cpp', '.hpp', '.cc', '.cxx', '.c++', '.h++'],
      pollInterval: 3000, // Poll every 3 seconds
      triggerOnChange: true
    };
    this.isInitialized = false;
    this.changeCallback = null;
  }

  /**
   * Initialize the file watcher service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load persisted state
      this.loadState();
      
      // Load watcher configuration
      this.loadConfig();

      this.isInitialized = true;
      console.log('File watcher service initialized');
    } catch (error) {
      console.error('Error initializing file watcher service:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Start watching directory
   * @param {FileSystemDirectoryHandle} directoryHandle - Directory to watch
   * @param {Object} [options] - Watch options
   * @param {Function} callback - Change callback function
   * @returns {Promise<Object>} Result with success status
   */
  async startWatching(directoryHandle, options = {}, callback) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate directory handle
      if (!directoryHandle || directoryHandle.kind !== 'directory') {
        return {
          success: false,
          error: 'Invalid directory handle'
        };
      }

      // Check if already watching
      if (this.state.status === WatcherStatus.WATCHING) {
        return {
          success: false,
          error: 'Already watching a directory'
        };
      }

      // Store directory handle and callback
      this.directoryHandle = directoryHandle;
      this.changeCallback = callback;

      // Update configuration with options
      if (options.sensitivity) {
        this.config.sensitivity = options.sensitivity;
      }
      if (options.excludePatterns) {
        this.config.excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...options.excludePatterns];
      }
      if (options.fileTypes) {
        this.config.fileTypes = options.fileTypes;
      }
      if (options.pollInterval) {
        this.config.pollInterval = options.pollInterval;
      }
      if (typeof options.triggerOnChange === 'boolean') {
        this.config.triggerOnChange = options.triggerOnChange;
      }

      // Save configuration
      this.saveConfig();

      // Create initial snapshot
      await this.createSnapshot();

      // Update state
      this.updateState({
        status: WatcherStatus.WATCHING,
        watchedDirectory: directoryHandle.name,
        error: null
      });

      // Start polling
      this.startPolling();

      console.log(`Started watching directory: ${directoryHandle.name}`);

      return {
        success: true
      };
    } catch (error) {
      console.error('Error starting file watcher:', error);
      this.updateState({
        status: WatcherStatus.ERROR,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop watching directory
   * @returns {Promise<Object>} Result with success status
   */
  async stopWatching() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Stop polling
      this.stopPolling();

      // Clear debounce timers
      this.clearAllDebounceTimers();

      // Clear snapshots
      this.fileSnapshots.clear();

      // Update state
      this.updateState({
        status: WatcherStatus.IDLE,
        watchedDirectory: null
      });

      // Clear directory handle
      this.directoryHandle = null;
      this.changeCallback = null;

      console.log('Stopped watching directory');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error stopping file watcher:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Pause watching
   * @returns {Promise<Object>} Result with success status
   */
  async pause() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.state.status !== WatcherStatus.WATCHING) {
        return {
          success: false,
          error: 'Not currently watching'
        };
      }

      // Stop polling but keep configuration
      this.stopPolling();

      // Update state
      this.updateState({
        status: WatcherStatus.PAUSED
      });

      console.log('File watching paused');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error pausing file watcher:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resume watching
   * @returns {Promise<Object>} Result with success status
   */
  async resume() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.state.status !== WatcherStatus.PAUSED) {
        return {
          success: false,
          error: 'Not currently paused'
        };
      }

      // Recreate snapshot
      await this.createSnapshot();

      // Update state
      this.updateState({
        status: WatcherStatus.WATCHING
      });

      // Restart polling
      this.startPolling();

      console.log('File watching resumed');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error resuming file watcher:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current watcher state
   * @returns {Promise<Object>} Current state
   */
  async getState() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return {
      success: true,
      state: { ...this.state },
      config: { ...this.config }
    };
  }

  /**
   * Update watcher configuration
   * @param {Object} configUpdate - Configuration update
   * @returns {Promise<Object>} Result with success status
   */
  async updateConfig(configUpdate) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate configuration
      if (configUpdate.sensitivity && !Object.values(Sensitivity).includes(configUpdate.sensitivity)) {
        return {
          success: false,
          error: 'Invalid sensitivity value'
        };
      }

      // Update configuration
      this.config = {
        ...this.config,
        ...configUpdate
      };

      // Save configuration
      this.saveConfig();

      // If watching, restart with new configuration
      if (this.state.status === WatcherStatus.WATCHING) {
        this.stopPolling();
        this.startPolling();
      }

      console.log('Watcher configuration updated');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error updating watcher config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Start polling for changes
   */
  startPolling() {
    if (this.watchInterval) {
      return;
    }

    this.watchInterval = setInterval(async () => {
      await this.checkForChanges();
    }, this.config.pollInterval);

    console.log(`Started polling with interval: ${this.config.pollInterval}ms`);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
      console.log('Stopped polling');
    }
  }

  /**
   * Check for file changes
   */
  async checkForChanges() {
    try {
      if (!this.directoryHandle) {
        return;
      }

      // Scan directory
      const currentFiles = await this.scanDirectory(this.directoryHandle);

      // Compare with snapshot
      const changes = this.detectChanges(currentFiles);

      if (changes.length > 0) {
        console.log(`Detected ${changes.length} file changes`);
        
        // Update state
        this.updateState({
          lastChangeTime: Date.now(),
          changeCount: this.state.changeCount + changes.length
        });

        // Trigger debounced callback
        if (this.config.triggerOnChange) {
          this.debouncedTrigger(changes);
        }

        // Update snapshot
        this.updateSnapshot(currentFiles);
      }
    } catch (error) {
      console.error('Error checking for changes:', error);
      this.updateState({
        status: WatcherStatus.ERROR,
        error: error.message
      });
    }
  }

  /**
   * Create initial file snapshot
   */
  async createSnapshot() {
    try {
      if (!this.directoryHandle) {
        return;
      }

      const files = await this.scanDirectory(this.directoryHandle);
      this.updateSnapshot(files);
      console.log(`Created snapshot with ${files.length} files`);
    } catch (error) {
      console.error('Error creating snapshot:', error);
      throw error;
    }
  }

  /**
   * Update file snapshot
   * @param {Array} files - Current file list
   */
  updateSnapshot(files) {
    this.fileSnapshots.clear();
    for (const file of files) {
      this.fileSnapshots.set(file.path, {
        lastModified: file.lastModified,
        size: file.size
      });
    }
  }

  /**
   * Detect changes between current files and snapshot
   * @param {Array} currentFiles - Current file list
   * @returns {Array} List of changes
   */
  detectChanges(currentFiles) {
    const changes = [];

    // Check for new or modified files
    for (const file of currentFiles) {
      const snapshot = this.fileSnapshots.get(file.path);
      
      if (!snapshot) {
        // New file
        changes.push({
          type: 'added',
          file: file
        });
      } else if (snapshot.lastModified !== file.lastModified || snapshot.size !== file.size) {
        // Modified file
        changes.push({
          type: 'modified',
          file: file
        });
      }
    }

    // Check for deleted files
    const currentPaths = new Set(currentFiles.map(f => f.path));
    for (const [path] of this.fileSnapshots) {
      if (!currentPaths.has(path)) {
        changes.push({
          type: 'deleted',
          path: path
        });
      }
    }

    return changes;
  }

  /**
   * Scan directory recursively
   * @param {FileSystemDirectoryHandle} directoryHandle - Directory to scan
   * @param {string} [basePath=''] - Base path
   * @returns {Promise<Array>} List of files
   */
  async scanDirectory(directoryHandle, basePath = '') {
    const files = [];

    try {
      for await (const [name, handle] of directoryHandle.entries()) {
        const currentPath = basePath ? `${basePath}/${name}` : name;

        // Check if should be excluded
        if (this.shouldExclude(currentPath)) {
          continue;
        }

        if (handle.kind === 'directory') {
          // Recursively scan subdirectory
          const subFiles = await this.scanDirectory(handle, currentPath);
          files.push(...subFiles);
        } else if (handle.kind === 'file') {
          // Check if file type matches
          if (this.matchesFileType(name)) {
            const file = await handle.getFile();
            files.push({
              path: currentPath,
              name: name,
              lastModified: file.lastModified,
              size: file.size
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${basePath}:`, error);
    }

    return files;
  }

  /**
   * Check if path should be excluded
   * @param {string} path - File path
   * @returns {boolean} True if should be excluded
   */
  shouldExclude(path) {
    for (const pattern of this.config.excludePatterns) {
      const regex = this.patternToRegex(pattern);
      if (regex.test(path)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if file matches configured file types
   * @param {string} fileName - File name
   * @returns {boolean} True if matches
   */
  matchesFileType(fileName) {
    if (!this.config.fileTypes || this.config.fileTypes.length === 0) {
      return true;
    }

    const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    return this.config.fileTypes.includes(extension);
  }

  /**
   * Convert glob pattern to regex
   * @param {string} pattern - Glob pattern
   * @returns {RegExp} Regular expression
   */
  patternToRegex(pattern) {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`, 'i');
  }

  /**
   * Trigger callback with debouncing
   * @param {Array} changes - List of changes
   */
  debouncedTrigger(changes) {
    // Clear existing debounce timer
    if (this.debounceTimers.has('changes')) {
      clearTimeout(this.debounceTimers.get('changes'));
    }

    // Get debounce delay based on sensitivity
    const delay = DEBOUNCE_DELAYS[this.config.sensitivity];

    // Set new debounce timer
    const timerId = setTimeout(() => {
      this.triggerChangeCallback(changes);
      this.debounceTimers.delete('changes');
    }, delay);

    this.debounceTimers.set('changes', timerId);
  }

  /**
   * Trigger change callback
   * @param {Array} changes - List of changes
   */
  async triggerChangeCallback(changes) {
    try {
      console.log(`Triggering change callback with ${changes.length} changes`);

      // Notify listeners
      this.notifyFileChange(changes);

      // Execute callback if provided
      if (this.changeCallback) {
        await this.changeCallback(changes);
      }
    } catch (error) {
      console.error('Error in change callback:', error);
    }
  }

  /**
   * Clear all debounce timers
   */
  clearAllDebounceTimers() {
    for (const [key, timerId] of this.debounceTimers) {
      clearTimeout(timerId);
    }
    this.debounceTimers.clear();
  }

  /**
   * Subscribe to file change events
   * @param {Function} listener - Callback function (changes) => void
   * @returns {Function} Unsubscribe function
   */
  onFileChange(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    fileChangeListeners.add(listener);

    // Return unsubscribe function
    return () => {
      fileChangeListeners.delete(listener);
    };
  }

  /**
   * Notify file change listeners
   * @param {Array} changes - List of changes
   */
  notifyFileChange(changes) {
    fileChangeListeners.forEach(listener => {
      try {
        listener(changes);
      } catch (error) {
        console.error('Error in file change listener:', error);
      }
    });
  }

  /**
   * Update state and save
   * @param {Object} stateUpdate - State update
   */
  updateState(stateUpdate) {
    this.state = {
      ...this.state,
      ...stateUpdate
    };
    this.saveState();
  }

  /**
   * Save state to storage
   */
  saveState() {
    try {
      localStorage.setItem(WATCHER_STATE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.error('Error saving watcher state:', error);
    }
  }

  /**
   * Load state from storage
   */
  loadState() {
    try {
      const stored = localStorage.getItem(WATCHER_STATE_KEY);
      if (stored) {
        const loadedState = JSON.parse(stored);
        // Don't restore 'watching' status on page load
        if (loadedState.status === WatcherStatus.WATCHING) {
          loadedState.status = WatcherStatus.IDLE;
        }
        this.state = loadedState;
      }
    } catch (error) {
      console.error('Error loading watcher state:', error);
    }
  }

  /**
   * Save configuration to storage
   */
  saveConfig() {
    try {
      localStorage.setItem(WATCHER_CONFIG_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.error('Error saving watcher config:', error);
    }
  }

  /**
   * Load configuration from storage
   */
  loadConfig() {
    try {
      const stored = localStorage.getItem(WATCHER_CONFIG_KEY);
      if (stored) {
        this.config = {
          ...this.config,
          ...JSON.parse(stored)
        };
      }
    } catch (error) {
      console.error('Error loading watcher config:', error);
    }
  }

  /**
   * Reset watcher state
   */
  reset() {
    this.stopWatching();
    this.state = {
      status: WatcherStatus.IDLE,
      watchedDirectory: null,
      lastChangeTime: null,
      changeCount: 0,
      error: null
    };
    this.config = {
      sensitivity: Sensitivity.MEDIUM,
      excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
      fileTypes: ['.h', '.cpp', '.hpp', '.cc', '.cxx', '.c++', '.h++'],
      pollInterval: 3000,
      triggerOnChange: true
    };
    this.saveState();
    this.saveConfig();
  }

  /**
   * Check if watcher is active
   * @returns {boolean} True if watching
   */
  isActive() {
    return this.state.status === WatcherStatus.WATCHING;
  }
}

// Create singleton instance
const fileWatcherService = new FileWatcherService();

export default fileWatcherService;
