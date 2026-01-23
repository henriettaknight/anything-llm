/**
 * @fileoverview Task Scheduler Service
 * Manages automated detection task scheduling and execution
 */

import { loadConfig } from './autoDetectionConfigService.js';
import { scanDirectoryByGroups } from './fileMonitorService.js';

/**
 * Task status enum
 * @enum {string}
 */
export const TaskStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  ERROR: 'error'
};

/**
 * @typedef {Function} DetectionCompleteCallback
 * @param {{files: Object[], hasChanges: boolean}} result - Detection result
 */

/**
 * Task Scheduler Implementation
 */
class TaskSchedulerImpl {
  constructor() {
    this.config = loadConfig();
    this.status = TaskStatus.IDLE;
    this.timeoutId = null;
    this.previousFiles = [];
    this.detectionCompleteCallback = null;
    this.directoryHandle = null;
    this.lastDetectionTime = 0;
    this.targetDetectionTime = 0;
    
    // Bind methods
    this.handleDetection = this.handleDetection.bind(this);
    
    // Initialize status to IDLE
    this.status = TaskStatus.IDLE;
    this.timeoutId = null;
    this.lastDetectionTime = 0;
    this.targetDetectionTime = 0;
  }

  /**
   * Start scheduler
   */
  start() {
    if (this.status === TaskStatus.RUNNING) {
      console.warn('调度器已经在运行中');
      return;
    }

    // Reload configuration to ensure using latest user configuration
    this.config = loadConfig();
    
    console.log('=== 启动调度器配置信息 ===');
    console.log(`启用状态: ${this.config.enabled}`);
    console.log(`目标时间: ${this.config.targetTime}`);
    console.log(`目标目录: ${this.config.targetDirectory || '未设置'}`);
    
    // Check if configuration is enabled
    if (!this.config.enabled) {
      console.warn('配置未启用，无法启动调度器');
      return;
    }
    
    // Check if directory handle is set
    if (!this.directoryHandle) {
      console.warn('未设置目录句柄，无法启动调度器');
      return;
    }
    
    this.status = TaskStatus.RUNNING;
    console.log('单次预约检测调度器已启动');

    // Set single scheduled detection
    this.scheduleDetection();
  }

  /**
   * Stop scheduler
   */
  stop() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
      console.log('定时器已清除');
    }
    this.status = TaskStatus.IDLE;
    console.log('单次预约检测调度器已停止');
    console.trace('stop() 调用堆栈'); // Add stack trace to find who called stop
  }

  /**
   * Reset error status
   */
  resetError() {
    if (this.status === TaskStatus.ERROR) {
      this.status = TaskStatus.IDLE;
      console.log('调度器错误状态已重置');
    }
  }

  /**
   * Pause scheduler
   */
  pause() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.status = TaskStatus.PAUSED;
    console.log('单次预约检测调度器已暂停');
  }

  /**
   * Resume scheduler
   */
  resume() {
    if (this.status === TaskStatus.PAUSED) {
      this.start();
    }
  }

  /**
   * Get current status
   * @returns {string} - Current status
   */
  getStatus() {
    return this.status;
  }

  /**
   * Set detection complete callback
   * @param {DetectionCompleteCallback} callback - Callback function
   */
  setOnDetectionComplete(callback) {
    this.detectionCompleteCallback = callback;
  }

  /**
   * Set directory handle
   * @param {FileSystemDirectoryHandle} handle - Directory handle
   */
  setDirectoryHandle(handle) {
    this.directoryHandle = handle;
  }

  /**
   * Get next detection time
   * @returns {number|null} - Next detection time or null
   */
  getNextDetectionTime() {
    if (this.status !== TaskStatus.RUNNING) {
      return null;
    }
    
    return this.targetDetectionTime;
  }

  /**
   * Restore detection task (called on page load, only execute in client)
   */
  restoreDetectionTask() {
    try {
      // Check if in browser environment
      if (typeof window === 'undefined') {
        console.log('不在浏览器环境中，跳过恢复检测任务');
        return;
      }

      // Load configuration from localStorage
      const storedConfig = localStorage.getItem('auto_detection_config');
      if (storedConfig) {
        const config = JSON.parse(storedConfig);
        if (config.enabled && config.targetTime) {
          // Convert HH:mm format to today's datetime
          const [hours, minutes] = config.targetTime.split(':').map(Number);
          if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            console.warn('恢复检测任务失败：目标时间格式无效');
            return;
          }
          
          const target = new Date();
          target.setHours(hours, minutes, 0, 0);
          const targetTime = target.getTime();
          const currentTime = Date.now();
          
          if (targetTime > currentTime) {
            // Target time is in the future, reset timer
            console.log('恢复检测任务，目标时间在未来');
            this.scheduleDetection();
          }
        }
      }
    } catch (error) {
      console.error('恢复检测任务失败:', error);
    }
  }

  /**
   * Schedule single detection
   */
  scheduleDetection() {
    // Clear existing timer
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Convert HH:mm format to today's datetime
    const [hours, minutes] = this.config.targetTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.warn('目标时间格式解析失败，无法安排检测');
      return;
    }
    
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    const targetTime = target.getTime();
    const currentTime = Date.now();
    const timeDiff = targetTime - currentTime;

    console.log(`目标时间: ${target.toLocaleString()}`);
    console.log(`当前时间: ${new Date(currentTime).toLocaleString()}`);
    console.log(`时间差: ${timeDiff} 毫秒`);

    if (timeDiff <= 0) {
      // Target time has passed or equals current time, execute detection immediately
      console.log('目标时间已到达，立即执行检测');
      this.executeDetection();
    } else {
      // Target time is in the future, set timer to wait
      console.log(`目标时间在未来，等待 ${timeDiff} 毫秒后执行检测`);
      this.targetDetectionTime = targetTime;
      
      this.timeoutId = setTimeout(() => {
        console.log('定时器触发，开始执行检测');
        this.executeDetection();
      }, timeDiff);
    }
  }

  /**
   * Execute detection
   * @returns {Promise<void>}
   */
  async executeDetection() {
    try {
      console.log('开始执行文件检测...');
      
      // 1. Scan directory by groups
      const { groups, rootFiles } = await scanDirectoryByGroups(this.directoryHandle);
      
      console.log(`扫描完成，发现 ${groups.length} 个分组，根目录文件 ${rootFiles.length} 个`);
      
      // Update last detection time
      this.lastDetectionTime = Date.now();
      
      // Merge all file lists for callback
      const allFiles = [
        ...groups.flatMap(g => g.files),
        ...rootFiles
      ];
      
      // Update file list
      this.previousFiles = allFiles;
      
      console.log(`总共发现 ${allFiles.length} 个C++文件`);
      
      // Regardless of file changes, must detect all files at time point
      console.log('开始执行代码缺陷检测...');
      
      let detectionCompleted = false;
      
      try {
        // Dynamically import code review service
        const { detectDefectsByGroups } = await import('./codeDetectionService.js');
        
        // 2. Detect by groups (each group will automatically save and download after completion)
        const reports = await detectDefectsByGroups(
          groups, 
          rootFiles, 
          this.directoryHandle,
          () => {
            // After each report save, trigger callback to update UI
            if (this.detectionCompleteCallback) {
              this.detectionCompleteCallback({
                files: allFiles,
                hasChanges: true
              });
            }
          }
        );
        
        console.log(`检测完成，生成 ${reports.length} 份报告`);
        console.log('所有报告已保存和下载');
        detectionCompleted = true;
        
      } catch (detectionError) {
        console.error('代码缺陷检测失败:', detectionError);
        detectionCompleted = true; // Mark as completed even on error
        // Continue execution, don't interrupt entire detection flow
      }
      
      // Only trigger callback and stop scheduler when detection truly completes
      if (detectionCompleted) {
        // Trigger final callback
        if (this.detectionCompleteCallback) {
          this.detectionCompleteCallback({
            files: allFiles,
            hasChanges: true // Always return has changes because detection was executed
          });
        }
        
        // Wait for all async operations to complete (including download, localStorage save, etc.)
        console.log('等待异步操作完成...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Automatically stop scheduler after detection completes, only execute once
        console.log('检测完成，自动停止调度器');
        this.stop(); // Stop scheduler, no more detections
        
        // Try to close window or exit program
        console.log('尝试关闭程序...');
        if (typeof window !== 'undefined') {
          // Browser environment: try to close window
          setTimeout(() => {
            window.close();
          }, 500);
        } else if (typeof process !== 'undefined' && process.exit) {
          // Node.js environment: force exit process
          setTimeout(() => {
            process.exit(0);
          }, 500);
        }
      }
      
    } catch (error) {
      console.error('执行检测时发生错误:', error);
      this.status = TaskStatus.ERROR;
      // Stop scheduler even on error
      this.stop();
    }
  }

  /**
   * Handle detection logic (for external calls)
   * @returns {Promise<{files: Object[], hasChanges: boolean}>} - Detection result
   */
  async handleDetection() {
    if (!this.directoryHandle) {
      throw new Error('未设置目录句柄');
    }

    console.log('=== 手动触发检测 ===');
    
    // Execute detection immediately, don't wait for timer
    await this.executeDetection();
    
    return {
      files: this.previousFiles,
      hasChanges: true // Always return has changes because detection was executed
    };
  }

  /**
   * Get last detection time
   * @returns {number} - Last detection time
   */
  getLastDetectionTime() {
    return this.lastDetectionTime;
  }

  /**
   * Get scheduler status info
   * @returns {Object} - Status information
   */
  getStatusInfo() {
    const nextDetectionTime = this.getNextDetectionTime();
    
    return {
      status: this.status,
      nextDetectionTime: nextDetectionTime ? new Date(nextDetectionTime).toLocaleString() : null,
      lastDetectionTime: this.lastDetectionTime ? new Date(this.lastDetectionTime).toLocaleString() : null,
      targetTime: this.config.targetTime ? new Date(this.config.targetTime).toLocaleString() : null
    };
  }

  /**
   * Reload configuration
   */
  reloadConfig() {
    const newConfig = loadConfig();
    console.log('重新加载配置:', newConfig);
    
    // Check if configuration has changed
    const configChanged = JSON.stringify(this.config) !== JSON.stringify(newConfig);
    
    if (configChanged) {
      console.log('检测到配置变化，重新安排检测');
      this.config = newConfig;
      
      // If scheduler is running, reschedule detection
      if (this.status === TaskStatus.RUNNING) {
        this.scheduleDetection();
      }
    }
  }
}

// Export factory function for creating new instances (if multiple schedulers needed)
export const createTaskScheduler = () => {
  return new TaskSchedulerImpl();
};

// Lazy singleton instance
let taskSchedulerInstance = null;

export const getTaskScheduler = () => {
  if (!taskSchedulerInstance) {
    taskSchedulerInstance = new TaskSchedulerImpl();
  }
  return taskSchedulerInstance;
};

// Export default - use lazy getter
export default {
  get default() {
    return getTaskScheduler();
  }
};
