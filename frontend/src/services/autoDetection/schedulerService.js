/**
 * Frontend Scheduler Service
 * Manages browser-based scheduled detection with state persistence
 * Requirements: 3.1, 3.2, 8.5
 */

const SCHEDULER_STATE_KEY = 'autoDetection_scheduler_state';
const SCHEDULE_CONFIG_KEY = 'autoDetection_schedule_config';

/**
 * Schedule state change listeners
 */
const scheduleStateListeners = new Set();

/**
 * Schedule types
 */
export const ScheduleType = {
  ONCE: 'once',           // Single scheduled detection
  DAILY: 'daily',         // Daily at specific time
  WEEKLY: 'weekly',       // Weekly on specific days
  INTERVAL: 'interval'    // Fixed interval (hours)
};

/**
 * Scheduler status
 */
export const SchedulerStatus = {
  IDLE: 'idle',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  PAUSED: 'paused',
  ERROR: 'error'
};

/**
 * Frontend Scheduler Service
 * Provides browser-based scheduling with persistence
 */
class SchedulerService {
  constructor() {
    this.timerId = null;
    this.state = {
      status: SchedulerStatus.IDLE,
      scheduleType: null,
      nextRunTime: null,
      lastRunTime: null,
      config: null,
      error: null
    };
    this.isInitialized = false;
    this.detectionCallback = null;
  }

  /**
   * Initialize the scheduler service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load persisted state
      this.loadState();
      
      // Load schedule configuration
      this.loadScheduleConfig();

      // Restore active schedule if exists
      if (this.state.status === SchedulerStatus.SCHEDULED && this.state.nextRunTime) {
        await this.restoreSchedule();
      }

      this.isInitialized = true;
      console.log('Scheduler service initialized');
    } catch (error) {
      console.error('Error initializing scheduler service:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Schedule detection
   * @param {Object} config - Schedule configuration
   * @param {string} config.type - Schedule type (once, daily, weekly, interval)
   * @param {string} [config.time] - Time in HH:MM format (for once, daily)
   * @param {number[]} [config.weekdays] - Weekdays (0-6, Sunday=0) for weekly
   * @param {number} [config.intervalHours] - Interval in hours
   * @param {Function} callback - Detection callback function
   * @returns {Promise<Object>} Result with success status
   */
  async schedule(config, callback) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate configuration
      const validation = this.validateScheduleConfig(config);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }

      // Store detection callback
      this.detectionCallback = callback;

      // Calculate next run time
      const nextRunTime = this.calculateNextRunTime(config);
      if (!nextRunTime) {
        return {
          success: false,
          error: 'Failed to calculate next run time'
        };
      }

      // Update state
      this.updateState({
        status: SchedulerStatus.SCHEDULED,
        scheduleType: config.type,
        nextRunTime: nextRunTime,
        config: config,
        error: null
      });

      // Save configuration
      this.saveScheduleConfig(config);

      // Set timer
      this.setTimer(nextRunTime);

      console.log(`Detection scheduled for ${new Date(nextRunTime).toLocaleString()}`);

      return {
        success: true,
        nextRunTime: nextRunTime
      };
    } catch (error) {
      console.error('Error scheduling detection:', error);
      this.updateState({
        status: SchedulerStatus.ERROR,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cancel scheduled detection
   * @returns {Promise<Object>} Result with success status
   */
  async cancel() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Clear timer
      this.clearTimer();

      // Update state
      this.updateState({
        status: SchedulerStatus.IDLE,
        scheduleType: null,
        nextRunTime: null,
        config: null,
        error: null
      });

      // Clear saved configuration
      this.clearScheduleConfig();

      console.log('Scheduled detection cancelled');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error cancelling schedule:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Pause scheduled detection
   * @returns {Promise<Object>} Result with success status
   */
  async pause() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.state.status !== SchedulerStatus.SCHEDULED) {
        return {
          success: false,
          error: 'No active schedule to pause'
        };
      }

      // Clear timer but keep configuration
      this.clearTimer();

      // Update state
      this.updateState({
        status: SchedulerStatus.PAUSED
      });

      console.log('Scheduled detection paused');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error pausing schedule:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resume paused schedule
   * @returns {Promise<Object>} Result with success status
   */
  async resume() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.state.status !== SchedulerStatus.PAUSED) {
        return {
          success: false,
          error: 'No paused schedule to resume'
        };
      }

      // Recalculate next run time
      const nextRunTime = this.calculateNextRunTime(this.state.config);
      if (!nextRunTime) {
        return {
          success: false,
          error: 'Failed to calculate next run time'
        };
      }

      // Update state
      this.updateState({
        status: SchedulerStatus.SCHEDULED,
        nextRunTime: nextRunTime
      });

      // Set timer
      this.setTimer(nextRunTime);

      console.log(`Schedule resumed, next run at ${new Date(nextRunTime).toLocaleString()}`);

      return {
        success: true,
        nextRunTime: nextRunTime
      };
    } catch (error) {
      console.error('Error resuming schedule:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current scheduler state
   * @returns {Promise<Object>} Current state
   */
  async getState() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return {
      success: true,
      state: { ...this.state }
    };
  }

  /**
   * Get schedule configuration
   * @returns {Promise<Object|null>} Schedule configuration or null
   */
  async getScheduleConfig() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.state.config ? { ...this.state.config } : null;
  }

  /**
   * Calculate next run time based on schedule configuration
   * @param {Object} config - Schedule configuration
   * @returns {number|null} Next run time timestamp or null
   */
  calculateNextRunTime(config) {
    const now = Date.now();

    switch (config.type) {
      case ScheduleType.ONCE: {
        // Parse time (HH:MM)
        const [hours, minutes] = config.time.split(':').map(Number);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        
        // If time has passed today, schedule for tomorrow
        if (target.getTime() <= now) {
          target.setDate(target.getDate() + 1);
        }
        
        return target.getTime();
      }

      case ScheduleType.DAILY: {
        // Parse time (HH:MM)
        const [hours, minutes] = config.time.split(':').map(Number);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        
        // If time has passed today, schedule for tomorrow
        if (target.getTime() <= now) {
          target.setDate(target.getDate() + 1);
        }
        
        return target.getTime();
      }

      case ScheduleType.WEEKLY: {
        // Parse time (HH:MM)
        const [hours, minutes] = config.time.split(':').map(Number);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        
        // Find next matching weekday
        const currentWeekday = target.getDay();
        const sortedWeekdays = [...config.weekdays].sort((a, b) => a - b);
        
        // Find next weekday
        let nextWeekday = sortedWeekdays.find(day => day > currentWeekday);
        
        if (!nextWeekday) {
          // No matching day this week, use first day of next week
          nextWeekday = sortedWeekdays[0];
          const daysToAdd = 7 - currentWeekday + nextWeekday;
          target.setDate(target.getDate() + daysToAdd);
        } else {
          // Found matching day this week
          const daysToAdd = nextWeekday - currentWeekday;
          target.setDate(target.getDate() + daysToAdd);
        }
        
        // If calculated time is in the past, add 7 days
        if (target.getTime() <= now) {
          target.setDate(target.getDate() + 7);
        }
        
        return target.getTime();
      }

      case ScheduleType.INTERVAL: {
        // Calculate next run based on interval
        const intervalMs = config.intervalHours * 60 * 60 * 1000;
        
        if (this.state.lastRunTime) {
          return this.state.lastRunTime + intervalMs;
        } else {
          return now + intervalMs;
        }
      }

      default:
        console.error('Unknown schedule type:', config.type);
        return null;
    }
  }

  /**
   * Set timer for next detection
   * @param {number} nextRunTime - Next run time timestamp
   */
  setTimer(nextRunTime) {
    // Clear existing timer
    this.clearTimer();

    const now = Date.now();
    const delay = nextRunTime - now;

    if (delay <= 0) {
      // Time has passed, execute immediately
      this.executeScheduledDetection();
      return;
    }

    // Set timer
    this.timerId = setTimeout(() => {
      this.executeScheduledDetection();
    }, delay);

    console.log(`Timer set for ${delay}ms (${new Date(nextRunTime).toLocaleString()})`);
  }

  /**
   * Clear timer
   */
  clearTimer() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Execute scheduled detection
   */
  async executeScheduledDetection() {
    try {
      console.log('Executing scheduled detection...');

      // Update state
      this.updateState({
        status: SchedulerStatus.RUNNING,
        lastRunTime: Date.now()
      });

      // Execute detection callback
      if (this.detectionCallback) {
        await this.detectionCallback();
      }

      // Check if should reschedule (for recurring schedules)
      if (this.shouldReschedule()) {
        const nextRunTime = this.calculateNextRunTime(this.state.config);
        if (nextRunTime) {
          this.updateState({
            status: SchedulerStatus.SCHEDULED,
            nextRunTime: nextRunTime
          });
          this.setTimer(nextRunTime);
          console.log(`Rescheduled for ${new Date(nextRunTime).toLocaleString()}`);
        } else {
          this.updateState({
            status: SchedulerStatus.IDLE,
            scheduleType: null,
            nextRunTime: null
          });
        }
      } else {
        // One-time schedule, mark as complete
        this.updateState({
          status: SchedulerStatus.IDLE,
          scheduleType: null,
          nextRunTime: null
        });
        this.clearScheduleConfig();
      }

    } catch (error) {
      console.error('Error executing scheduled detection:', error);
      this.updateState({
        status: SchedulerStatus.ERROR,
        error: error.message
      });
    }
  }

  /**
   * Check if schedule should be rescheduled
   * @returns {boolean} True if should reschedule
   */
  shouldReschedule() {
    if (!this.state.config) {
      return false;
    }

    // Recurring schedule types
    return [
      ScheduleType.DAILY,
      ScheduleType.WEEKLY,
      ScheduleType.INTERVAL
    ].includes(this.state.config.type);
  }

  /**
   * Restore schedule from persisted state
   */
  async restoreSchedule() {
    try {
      const now = Date.now();
      
      // Check if next run time has passed
      if (this.state.nextRunTime <= now) {
        // Recalculate next run time
        const nextRunTime = this.calculateNextRunTime(this.state.config);
        if (nextRunTime) {
          this.updateState({
            nextRunTime: nextRunTime
          });
          this.setTimer(nextRunTime);
          console.log(`Schedule restored, next run at ${new Date(nextRunTime).toLocaleString()}`);
        } else {
          this.updateState({
            status: SchedulerStatus.IDLE,
            scheduleType: null,
            nextRunTime: null
          });
        }
      } else {
        // Set timer for existing next run time
        this.setTimer(this.state.nextRunTime);
        console.log(`Schedule restored, next run at ${new Date(this.state.nextRunTime).toLocaleString()}`);
      }
    } catch (error) {
      console.error('Error restoring schedule:', error);
      this.updateState({
        status: SchedulerStatus.ERROR,
        error: error.message
      });
    }
  }

  /**
   * Validate schedule configuration
   * @param {Object} config - Schedule configuration
   * @returns {Object} Validation result
   */
  validateScheduleConfig(config) {
    if (!config || typeof config !== 'object') {
      return { valid: false, error: 'Invalid configuration' };
    }

    if (!Object.values(ScheduleType).includes(config.type)) {
      return { valid: false, error: 'Invalid schedule type' };
    }

    switch (config.type) {
      case ScheduleType.ONCE:
      case ScheduleType.DAILY:
        if (!config.time || !/^\d{2}:\d{2}$/.test(config.time)) {
          return { valid: false, error: 'Invalid time format (expected HH:MM)' };
        }
        break;

      case ScheduleType.WEEKLY:
        if (!config.time || !/^\d{2}:\d{2}$/.test(config.time)) {
          return { valid: false, error: 'Invalid time format (expected HH:MM)' };
        }
        if (!Array.isArray(config.weekdays) || config.weekdays.length === 0) {
          return { valid: false, error: 'Weekdays must be a non-empty array' };
        }
        if (!config.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
          return { valid: false, error: 'Invalid weekday values (expected 0-6)' };
        }
        break;

      case ScheduleType.INTERVAL:
        if (!Number.isFinite(config.intervalHours) || config.intervalHours <= 0) {
          return { valid: false, error: 'Invalid interval hours (must be positive number)' };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * Update state and notify listeners
   * @param {Object} stateUpdate - State update
   */
  updateState(stateUpdate) {
    const oldState = { ...this.state };
    
    this.state = {
      ...this.state,
      ...stateUpdate
    };

    // Save state
    this.saveState();

    // Notify listeners
    this.notifyStateChange(this.state, oldState);
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function (newState, oldState) => void
   * @returns {Function} Unsubscribe function
   */
  onStateChange(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    scheduleStateListeners.add(listener);

    // Return unsubscribe function
    return () => {
      scheduleStateListeners.delete(listener);
    };
  }

  /**
   * Notify state change listeners
   * @param {Object} newState - New state
   * @param {Object} oldState - Old state
   */
  notifyStateChange(newState, oldState) {
    scheduleStateListeners.forEach(listener => {
      try {
        listener(newState, oldState);
      } catch (error) {
        console.error('Error in state change listener:', error);
      }
    });
  }

  /**
   * Save state to storage
   */
  saveState() {
    try {
      localStorage.setItem(SCHEDULER_STATE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.error('Error saving scheduler state:', error);
    }
  }

  /**
   * Load state from storage
   */
  loadState() {
    try {
      const stored = localStorage.getItem(SCHEDULER_STATE_KEY);
      if (stored) {
        const loadedState = JSON.parse(stored);
        // Don't restore 'running' status on page load
        if (loadedState.status === SchedulerStatus.RUNNING) {
          loadedState.status = SchedulerStatus.SCHEDULED;
        }
        this.state = loadedState;
      }
    } catch (error) {
      console.error('Error loading scheduler state:', error);
    }
  }

  /**
   * Save schedule configuration
   * @param {Object} config - Schedule configuration
   */
  saveScheduleConfig(config) {
    try {
      localStorage.setItem(SCHEDULE_CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('Error saving schedule config:', error);
    }
  }

  /**
   * Load schedule configuration
   */
  loadScheduleConfig() {
    try {
      const stored = localStorage.getItem(SCHEDULE_CONFIG_KEY);
      if (stored && !this.state.config) {
        this.state.config = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading schedule config:', error);
    }
  }

  /**
   * Clear schedule configuration
   */
  clearScheduleConfig() {
    try {
      localStorage.removeItem(SCHEDULE_CONFIG_KEY);
    } catch (error) {
      console.error('Error clearing schedule config:', error);
    }
  }

  /**
   * Reset scheduler state
   */
  reset() {
    this.clearTimer();
    this.clearScheduleConfig();
    this.state = {
      status: SchedulerStatus.IDLE,
      scheduleType: null,
      nextRunTime: null,
      lastRunTime: null,
      config: null,
      error: null
    };
    this.saveState();
    this.detectionCallback = null;
  }

  /**
   * Check if scheduler is active
   * @returns {boolean} True if scheduled or running
   */
  isActive() {
    return [SchedulerStatus.SCHEDULED, SchedulerStatus.RUNNING].includes(this.state.status);
  }

  /**
   * Get time until next run
   * @returns {number|null} Milliseconds until next run or null
   */
  getTimeUntilNextRun() {
    if (!this.state.nextRunTime) {
      return null;
    }
    return Math.max(0, this.state.nextRunTime - Date.now());
  }
}

// Create singleton instance
const schedulerService = new SchedulerService();

export default schedulerService;
