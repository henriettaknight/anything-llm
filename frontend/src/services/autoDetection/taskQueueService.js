/**
 * Frontend Task Queue Service
 * Manages concurrent detection requests with retry logic and notifications
 * Requirements: 3.3, 3.4, 3.5
 */

const QUEUE_STATE_KEY = 'autoDetection_queue_state';
const QUEUE_CONFIG_KEY = 'autoDetection_queue_config';

/**
 * Task status enum
 */
export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying'
};

/**
 * Task priority levels
 */
export const TaskPriority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3
};

/**
 * Notification types
 */
export const NotificationType = {
  TASK_STARTED: 'task_started',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  TASK_RETRYING: 'task_retrying',
  QUEUE_EMPTY: 'queue_empty',
  QUEUE_FULL: 'queue_full'
};

/**
 * Task completion listeners
 */
const taskCompletionListeners = new Set();

/**
 * Task failure listeners
 */
const taskFailureListeners = new Set();

/**
 * Notification listeners
 */
const notificationListeners = new Set();

/**
 * Frontend Task Queue Service
 * Manages task lifecycle with queuing and retry logic
 */
class TaskQueueService {
  constructor() {
    this.queue = [];
    this.runningTasks = new Map();
    this.completedTasks = [];
    this.failedTasks = [];
    this.config = {
      maxConcurrent: 1,        // Maximum concurrent tasks
      maxQueueSize: 10,        // Maximum queue size
      maxRetries: 3,           // Maximum retry attempts
      retryDelay: 2000,        // Delay between retries (ms)
      retryBackoff: true,      // Use exponential backoff
      enableNotifications: true // Enable browser notifications
    };
    this.isInitialized = false;
    this.isProcessing = false;
    this.taskIdCounter = 0;
  }

  /**
   * Initialize the task queue service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load persisted configuration
      this.loadConfig();

      // Request notification permission if enabled
      if (this.config.enableNotifications && 'Notification' in window) {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      }

      this.isInitialized = true;
      console.log('Task queue service initialized');
    } catch (error) {
      console.error('Error initializing task queue service:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Add task to queue
   * @param {Function} taskFn - Task function to execute
   * @param {Object} [options] - Task options
   * @param {number} [options.priority] - Task priority
   * @param {number} [options.maxRetries] - Max retry attempts for this task
   * @param {Object} [options.metadata] - Task metadata
   * @returns {Promise<Object>} Result with task ID
   */
  async addTask(taskFn, options = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check queue size limit
      if (this.queue.length >= this.config.maxQueueSize) {
        this.sendNotification(NotificationType.QUEUE_FULL, {
          queueSize: this.queue.length,
          maxSize: this.config.maxQueueSize
        });
        return {
          success: false,
          error: 'Queue is full'
        };
      }

      // Create task
      const task = {
        id: this.generateTaskId(),
        fn: taskFn,
        priority: options.priority || TaskPriority.NORMAL,
        maxRetries: options.maxRetries !== undefined ? options.maxRetries : this.config.maxRetries,
        retryCount: 0,
        status: TaskStatus.PENDING,
        metadata: options.metadata || {},
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        error: null,
        result: null
      };

      // Add to queue
      this.queue.push(task);

      // Sort queue by priority
      this.sortQueue();

      console.log(`Task ${task.id} added to queue (priority: ${task.priority})`);

      // Start processing if not already processing
      if (!this.isProcessing) {
        this.processQueue();
      }

      return {
        success: true,
        taskId: task.id
      };
    } catch (error) {
      console.error('Error adding task to queue:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cancel task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Result with success status
   */
  async cancelTask(taskId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check if task is in queue
      const queueIndex = this.queue.findIndex(t => t.id === taskId);
      if (queueIndex !== -1) {
        const task = this.queue[queueIndex];
        task.status = TaskStatus.CANCELLED;
        this.queue.splice(queueIndex, 1);
        console.log(`Task ${taskId} cancelled (was in queue)`);
        return {
          success: true
        };
      }

      // Check if task is running
      if (this.runningTasks.has(taskId)) {
        const task = this.runningTasks.get(taskId);
        task.status = TaskStatus.CANCELLED;
        // Note: Cannot actually stop running task, but mark as cancelled
        console.log(`Task ${taskId} marked as cancelled (was running)`);
        return {
          success: true,
          warning: 'Task was running and cannot be stopped, but marked as cancelled'
        };
      }

      return {
        success: false,
        error: 'Task not found'
      };
    } catch (error) {
      console.error('Error cancelling task:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get task status
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Task status
   */
  async getTaskStatus(taskId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check running tasks
      if (this.runningTasks.has(taskId)) {
        const task = this.runningTasks.get(taskId);
        return {
          success: true,
          task: this.sanitizeTask(task)
        };
      }

      // Check queue
      const queuedTask = this.queue.find(t => t.id === taskId);
      if (queuedTask) {
        return {
          success: true,
          task: this.sanitizeTask(queuedTask)
        };
      }

      // Check completed tasks
      const completedTask = this.completedTasks.find(t => t.id === taskId);
      if (completedTask) {
        return {
          success: true,
          task: this.sanitizeTask(completedTask)
        };
      }

      // Check failed tasks
      const failedTask = this.failedTasks.find(t => t.id === taskId);
      if (failedTask) {
        return {
          success: true,
          task: this.sanitizeTask(failedTask)
        };
      }

      return {
        success: false,
        error: 'Task not found'
      };
    } catch (error) {
      console.error('Error getting task status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get queue status
   * @returns {Promise<Object>} Queue status
   */
  async getQueueStatus() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return {
      success: true,
      status: {
        queueLength: this.queue.length,
        runningCount: this.runningTasks.size,
        completedCount: this.completedTasks.length,
        failedCount: this.failedTasks.length,
        isProcessing: this.isProcessing,
        maxConcurrent: this.config.maxConcurrent,
        maxQueueSize: this.config.maxQueueSize
      }
    };
  }

  /**
   * Clear completed tasks
   * @returns {Promise<Object>} Result with success status
   */
  async clearCompleted() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const count = this.completedTasks.length;
      this.completedTasks = [];
      console.log(`Cleared ${count} completed tasks`);

      return {
        success: true,
        clearedCount: count
      };
    } catch (error) {
      console.error('Error clearing completed tasks:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clear failed tasks
   * @returns {Promise<Object>} Result with success status
   */
  async clearFailed() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const count = this.failedTasks.length;
      this.failedTasks = [];
      console.log(`Cleared ${count} failed tasks`);

      return {
        success: true,
        clearedCount: count
      };
    } catch (error) {
      console.error('Error clearing failed tasks:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update configuration
   * @param {Object} configUpdate - Configuration update
   * @returns {Promise<Object>} Result with success status
   */
  async updateConfig(configUpdate) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate configuration
      if (configUpdate.maxConcurrent !== undefined) {
        if (!Number.isInteger(configUpdate.maxConcurrent) || configUpdate.maxConcurrent < 1) {
          return {
            success: false,
            error: 'maxConcurrent must be a positive integer'
          };
        }
      }

      if (configUpdate.maxQueueSize !== undefined) {
        if (!Number.isInteger(configUpdate.maxQueueSize) || configUpdate.maxQueueSize < 1) {
          return {
            success: false,
            error: 'maxQueueSize must be a positive integer'
          };
        }
      }

      // Update configuration
      this.config = {
        ...this.config,
        ...configUpdate
      };

      // Save configuration
      this.saveConfig();

      console.log('Queue configuration updated');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error updating queue config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process queue
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && this.runningTasks.size < this.config.maxConcurrent) {
        // Get next task
        const task = this.queue.shift();
        
        if (!task) {
          break;
        }

        // Start task
        this.startTask(task);
      }

      // Check if queue is empty
      if (this.queue.length === 0 && this.runningTasks.size === 0) {
        this.sendNotification(NotificationType.QUEUE_EMPTY, {});
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start task execution
   * @param {Object} task - Task to execute
   */
  async startTask(task) {
    try {
      // Update task status
      task.status = TaskStatus.RUNNING;
      task.startedAt = Date.now();

      // Add to running tasks
      this.runningTasks.set(task.id, task);

      console.log(`Starting task ${task.id}`);

      // Send notification
      this.sendNotification(NotificationType.TASK_STARTED, {
        taskId: task.id,
        metadata: task.metadata
      });

      // Execute task
      try {
        const result = await task.fn();
        
        // Check if task was cancelled
        if (task.status === TaskStatus.CANCELLED) {
          console.log(`Task ${task.id} was cancelled`);
          this.runningTasks.delete(task.id);
          this.processQueue();
          return;
        }

        // Task completed successfully
        this.completeTask(task, result);
      } catch (error) {
        // Task failed
        this.handleTaskFailure(task, error);
      }
    } catch (error) {
      console.error(`Error starting task ${task.id}:`, error);
      this.handleTaskFailure(task, error);
    }
  }

  /**
   * Complete task
   * @param {Object} task - Task
   * @param {*} result - Task result
   */
  completeTask(task, result) {
    // Update task
    task.status = TaskStatus.COMPLETED;
    task.completedAt = Date.now();
    task.result = result;

    // Remove from running tasks
    this.runningTasks.delete(task.id);

    // Add to completed tasks
    this.completedTasks.push(task);

    console.log(`Task ${task.id} completed successfully`);

    // Send notification
    this.sendNotification(NotificationType.TASK_COMPLETED, {
      taskId: task.id,
      metadata: task.metadata,
      duration: task.completedAt - task.startedAt
    });

    // Notify listeners
    this.notifyTaskCompletion(task);

    // Continue processing queue
    this.processQueue();
  }

  /**
   * Handle task failure
   * @param {Object} task - Task
   * @param {Error} error - Error
   */
  async handleTaskFailure(task, error) {
    console.error(`Task ${task.id} failed:`, error);

    // Update task
    task.error = error.message || String(error);
    task.retryCount++;

    // Check if should retry
    if (task.retryCount <= task.maxRetries) {
      // Retry task
      task.status = TaskStatus.RETRYING;
      
      console.log(`Retrying task ${task.id} (attempt ${task.retryCount}/${task.maxRetries})`);

      // Send notification
      this.sendNotification(NotificationType.TASK_RETRYING, {
        taskId: task.id,
        metadata: task.metadata,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries
      });

      // Calculate retry delay
      const delay = this.calculateRetryDelay(task.retryCount);

      // Remove from running tasks
      this.runningTasks.delete(task.id);

      // Schedule retry
      setTimeout(() => {
        // Add back to queue with high priority
        task.priority = TaskPriority.HIGH;
        this.queue.unshift(task);
        this.processQueue();
      }, delay);
    } else {
      // Max retries exceeded, mark as failed
      task.status = TaskStatus.FAILED;
      task.completedAt = Date.now();

      // Remove from running tasks
      this.runningTasks.delete(task.id);

      // Add to failed tasks
      this.failedTasks.push(task);

      console.log(`Task ${task.id} failed after ${task.retryCount} attempts`);

      // Send notification
      this.sendNotification(NotificationType.TASK_FAILED, {
        taskId: task.id,
        metadata: task.metadata,
        error: task.error,
        retryCount: task.retryCount
      });

      // Notify listeners
      this.notifyTaskFailure(task);

      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} retryCount - Current retry count
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(retryCount) {
    if (!this.config.retryBackoff) {
      return this.config.retryDelay;
    }

    // Exponential backoff: delay * 2^(retryCount - 1)
    return this.config.retryDelay * Math.pow(2, retryCount - 1);
  }

  /**
   * Sort queue by priority
   */
  sortQueue() {
    this.queue.sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Earlier created first
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Send notification
   * @param {string} type - Notification type
   * @param {Object} data - Notification data
   */
  sendNotification(type, data) {
    // Notify listeners
    this.notifyNotification(type, data);

    // Send browser notification if enabled
    if (this.config.enableNotifications && 'Notification' in window && Notification.permission === 'granted') {
      this.sendBrowserNotification(type, data);
    }
  }

  /**
   * Send browser notification
   * @param {string} type - Notification type
   * @param {Object} data - Notification data
   */
  sendBrowserNotification(type, data) {
    let title = '';
    let body = '';

    switch (type) {
      case NotificationType.TASK_COMPLETED:
        title = 'Detection Completed';
        body = `Task completed successfully`;
        break;
      case NotificationType.TASK_FAILED:
        title = 'Detection Failed';
        body = `Task failed: ${data.error}`;
        break;
      case NotificationType.QUEUE_EMPTY:
        title = 'All Tasks Completed';
        body = 'All detection tasks have been completed';
        break;
      default:
        return;
    }

    try {
      new Notification(title, {
        body: body,
        icon: '/favicon.ico',
        tag: `autodetection-${type}`
      });
    } catch (error) {
      console.error('Error sending browser notification:', error);
    }
  }

  /**
   * Subscribe to task completion events
   * @param {Function} listener - Callback function (task) => void
   * @returns {Function} Unsubscribe function
   */
  onTaskCompletion(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    taskCompletionListeners.add(listener);

    return () => {
      taskCompletionListeners.delete(listener);
    };
  }

  /**
   * Subscribe to task failure events
   * @param {Function} listener - Callback function (task) => void
   * @returns {Function} Unsubscribe function
   */
  onTaskFailure(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    taskFailureListeners.add(listener);

    return () => {
      taskFailureListeners.delete(listener);
    };
  }

  /**
   * Subscribe to notification events
   * @param {Function} listener - Callback function (type, data) => void
   * @returns {Function} Unsubscribe function
   */
  onNotification(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    notificationListeners.add(listener);

    return () => {
      notificationListeners.delete(listener);
    };
  }

  /**
   * Notify task completion listeners
   * @param {Object} task - Completed task
   */
  notifyTaskCompletion(task) {
    taskCompletionListeners.forEach(listener => {
      try {
        listener(this.sanitizeTask(task));
      } catch (error) {
        console.error('Error in task completion listener:', error);
      }
    });
  }

  /**
   * Notify task failure listeners
   * @param {Object} task - Failed task
   */
  notifyTaskFailure(task) {
    taskFailureListeners.forEach(listener => {
      try {
        listener(this.sanitizeTask(task));
      } catch (error) {
        console.error('Error in task failure listener:', error);
      }
    });
  }

  /**
   * Notify notification listeners
   * @param {string} type - Notification type
   * @param {Object} data - Notification data
   */
  notifyNotification(type, data) {
    notificationListeners.forEach(listener => {
      try {
        listener(type, data);
      } catch (error) {
        console.error('Error in notification listener:', error);
      }
    });
  }

  /**
   * Sanitize task for external use (remove function reference)
   * @param {Object} task - Task
   * @returns {Object} Sanitized task
   */
  sanitizeTask(task) {
    const { fn, ...sanitized } = task;
    return sanitized;
  }

  /**
   * Generate unique task ID
   * @returns {string} Task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${++this.taskIdCounter}`;
  }

  /**
   * Save configuration to storage
   */
  saveConfig() {
    try {
      localStorage.setItem(QUEUE_CONFIG_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.error('Error saving queue config:', error);
    }
  }

  /**
   * Load configuration from storage
   */
  loadConfig() {
    try {
      const stored = localStorage.getItem(QUEUE_CONFIG_KEY);
      if (stored) {
        this.config = {
          ...this.config,
          ...JSON.parse(stored)
        };
      }
    } catch (error) {
      console.error('Error loading queue config:', error);
    }
  }

  /**
   * Reset queue service
   */
  reset() {
    // Clear queue
    this.queue = [];
    
    // Clear running tasks
    this.runningTasks.clear();
    
    // Clear completed and failed tasks
    this.completedTasks = [];
    this.failedTasks = [];
    
    // Reset processing flag
    this.isProcessing = false;
    
    console.log('Task queue service reset');
  }
}

// Create singleton instance
const taskQueueService = new TaskQueueService();

export default taskQueueService;
