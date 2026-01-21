/**
 * @fileoverview Resource Monitor Service
 * Monitors system resources and provides resource management capabilities
 */

/**
 * @typedef {Object} ResourceInfo
 * @property {number} availableMemory - Available memory in MB
 * @property {number} usedMemory - Used memory in MB
 * @property {number} totalMemory - Total memory in MB
 * @property {number} memoryUsagePercent - Memory usage percentage
 * @property {number} estimatedAvailableForProcessing - Estimated memory available for processing in MB
 */

/**
 * @typedef {Object} ResourceConstraints
 * @property {boolean} hasEnoughMemory - Whether there's enough memory
 * @property {boolean} canStartDetection - Whether detection can start
 * @property {string[]} warnings - List of warning messages
 * @property {Object} recommendations - Recommendations for resource optimization
 */

/**
 * Resource Monitor Service Implementation
 */
class ResourceMonitorServiceImpl {
  constructor() {
    this.memoryCheckInterval = null;
    this.memoryHistory = [];
    this.maxHistorySize = 100;
    this.warningThreshold = 0.85; // 85% memory usage triggers warning
    this.criticalThreshold = 0.95; // 95% memory usage is critical
  }

  /**
   * Get current resource information
   * @returns {ResourceInfo} Current resource info
   */
  getResourceInfo() {
    const resourceInfo = {
      availableMemory: 0,
      usedMemory: 0,
      totalMemory: 0,
      memoryUsagePercent: 0,
      estimatedAvailableForProcessing: 0
    };

    // Check if Performance API is available
    if (typeof performance !== 'undefined' && performance.memory) {
      const memory = performance.memory;
      
      // Convert bytes to MB
      resourceInfo.usedMemory = Math.round(memory.usedJSHeapSize / (1024 * 1024));
      resourceInfo.totalMemory = Math.round(memory.jsHeapSizeLimit / (1024 * 1024));
      resourceInfo.availableMemory = resourceInfo.totalMemory - resourceInfo.usedMemory;
      resourceInfo.memoryUsagePercent = (resourceInfo.usedMemory / resourceInfo.totalMemory) * 100;
      
      // Estimate available memory for processing (conservative: 50% of available)
      resourceInfo.estimatedAvailableForProcessing = Math.floor(resourceInfo.availableMemory * 0.5);
    } else {
      // Fallback: assume reasonable defaults
      resourceInfo.totalMemory = 2048; // 2GB default
      resourceInfo.usedMemory = 512; // 512MB default
      resourceInfo.availableMemory = 1536;
      resourceInfo.memoryUsagePercent = 25;
      resourceInfo.estimatedAvailableForProcessing = 768;
      
      console.warn('Performance.memory API not available, using default values');
    }

    return resourceInfo;
  }

  /**
   * Check if system has enough resources to start detection
   * @param {Object} config - Detection configuration
   * @returns {ResourceConstraints} Resource constraints check result
   */
  checkResourceConstraints(config = {}) {
    const resourceInfo = this.getResourceInfo();
    const warnings = [];
    const recommendations = {};
    
    // Calculate estimated memory needed
    const batchSize = config.batchSize || 20;
    const avgFileSize = config.avgFileSize || 50; // KB
    const estimatedMemoryPerFile = avgFileSize * 10 / 1024; // MB (10x file size for processing)
    const estimatedMemoryNeeded = batchSize * estimatedMemoryPerFile;

    // Check memory availability
    const hasEnoughMemory = resourceInfo.estimatedAvailableForProcessing >= estimatedMemoryNeeded;
    
    if (!hasEnoughMemory) {
      warnings.push(`内存不足: 需要约 ${Math.round(estimatedMemoryNeeded)}MB，可用 ${Math.round(resourceInfo.estimatedAvailableForProcessing)}MB`);
      
      // Calculate recommended batch size
      const recommendedBatchSize = Math.max(
        5,
        Math.floor(resourceInfo.estimatedAvailableForProcessing / estimatedMemoryPerFile)
      );
      
      recommendations.batchSize = recommendedBatchSize;
      recommendations.message = `建议将批处理大小降低到 ${recommendedBatchSize}`;
    }

    // Check memory usage percentage
    if (resourceInfo.memoryUsagePercent >= this.criticalThreshold * 100) {
      warnings.push(`内存使用率过高: ${resourceInfo.memoryUsagePercent.toFixed(1)}%`);
      recommendations.action = 'critical';
      recommendations.message = '建议等待内存释放或关闭其他应用程序';
    } else if (resourceInfo.memoryUsagePercent >= this.warningThreshold * 100) {
      warnings.push(`内存使用率较高: ${resourceInfo.memoryUsagePercent.toFixed(1)}%`);
      recommendations.action = 'warning';
      recommendations.message = '建议减小批处理大小或监控内存使用';
    }

    const canStartDetection = hasEnoughMemory && 
                             resourceInfo.memoryUsagePercent < this.criticalThreshold * 100;

    return {
      hasEnoughMemory,
      canStartDetection,
      warnings,
      recommendations,
      resourceInfo
    };
  }

  /**
   * Calculate optimal batch size based on available resources
   * @param {Object} options - Calculation options
   * @returns {number} Optimal batch size
   */
  calculateOptimalBatchSize(options = {}) {
    const resourceInfo = this.getResourceInfo();
    const avgFileSize = options.avgFileSize || 50; // KB
    const minBatchSize = options.minBatchSize || 5;
    const maxBatchSize = options.maxBatchSize || 50;
    const currentBatchSize = options.currentBatchSize || 20;

    // Calculate memory per file (conservative estimate)
    const memoryPerFile = avgFileSize * 10 / 1024; // MB

    // Calculate max batch size based on available memory
    const maxBatchByMemory = Math.floor(
      resourceInfo.estimatedAvailableForProcessing / memoryPerFile
    );

    // Consider current memory usage
    let adjustedBatchSize = currentBatchSize;
    
    if (resourceInfo.memoryUsagePercent >= this.warningThreshold * 100) {
      // High memory usage: reduce batch size
      adjustedBatchSize = Math.floor(currentBatchSize * 0.7);
    } else if (resourceInfo.memoryUsagePercent < 0.5 * 100) {
      // Low memory usage: can increase batch size
      adjustedBatchSize = Math.floor(currentBatchSize * 1.3);
    }

    // Apply constraints
    const optimalBatchSize = Math.max(
      minBatchSize,
      Math.min(maxBatchSize, maxBatchByMemory, adjustedBatchSize)
    );

    console.log(`资源监控: 当前批处理大小 ${currentBatchSize} -> 优化后 ${optimalBatchSize}`);
    console.log(`  可用内存: ${resourceInfo.availableMemory}MB`);
    console.log(`  内存使用率: ${resourceInfo.memoryUsagePercent.toFixed(1)}%`);

    return optimalBatchSize;
  }

  /**
   * Start monitoring memory usage
   * @param {Function} onWarning - Callback when memory warning occurs
   * @param {number} interval - Check interval in milliseconds
   */
  startMonitoring(onWarning, interval = 5000) {
    if (this.memoryCheckInterval) {
      this.stopMonitoring();
    }

    this.memoryCheckInterval = setInterval(() => {
      const resourceInfo = this.getResourceInfo();
      
      // Add to history
      this.memoryHistory.push({
        timestamp: Date.now(),
        ...resourceInfo
      });

      // Trim history
      if (this.memoryHistory.length > this.maxHistorySize) {
        this.memoryHistory.shift();
      }

      // Check for warnings
      if (resourceInfo.memoryUsagePercent >= this.criticalThreshold * 100) {
        if (onWarning) {
          onWarning({
            level: 'critical',
            message: `内存使用率达到临界值: ${resourceInfo.memoryUsagePercent.toFixed(1)}%`,
            resourceInfo
          });
        }
      } else if (resourceInfo.memoryUsagePercent >= this.warningThreshold * 100) {
        if (onWarning) {
          onWarning({
            level: 'warning',
            message: `内存使用率较高: ${resourceInfo.memoryUsagePercent.toFixed(1)}%`,
            resourceInfo
          });
        }
      }
    }, interval);

    console.log('资源监控已启动');
  }

  /**
   * Stop monitoring memory usage
   */
  stopMonitoring() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
      console.log('资源监控已停止');
    }
  }

  /**
   * Get memory usage history
   * @param {number} [limit] - Number of recent entries to return
   * @returns {Array} Memory usage history
   */
  getMemoryHistory(limit) {
    if (limit) {
      return this.memoryHistory.slice(-limit);
    }
    return [...this.memoryHistory];
  }

  /**
   * Get memory usage statistics
   * @returns {Object} Memory usage statistics
   */
  getMemoryStats() {
    if (this.memoryHistory.length === 0) {
      return {
        count: 0,
        avgUsage: 0,
        maxUsage: 0,
        minUsage: 0,
        trend: 'stable'
      };
    }

    const usageValues = this.memoryHistory.map(h => h.memoryUsagePercent);
    const avgUsage = usageValues.reduce((sum, val) => sum + val, 0) / usageValues.length;
    const maxUsage = Math.max(...usageValues);
    const minUsage = Math.min(...usageValues);

    // Calculate trend
    let trend = 'stable';
    if (this.memoryHistory.length >= 10) {
      const recentAvg = usageValues.slice(-5).reduce((sum, val) => sum + val, 0) / 5;
      const olderAvg = usageValues.slice(-10, -5).reduce((sum, val) => sum + val, 0) / 5;
      
      if (recentAvg > olderAvg * 1.1) {
        trend = 'increasing';
      } else if (recentAvg < olderAvg * 0.9) {
        trend = 'decreasing';
      }
    }

    return {
      count: this.memoryHistory.length,
      avgUsage: avgUsage.toFixed(2),
      maxUsage: maxUsage.toFixed(2),
      minUsage: minUsage.toFixed(2),
      trend
    };
  }

  /**
   * Clear memory history
   */
  clearHistory() {
    this.memoryHistory = [];
  }

  /**
   * Force garbage collection (if available)
   * Note: This only works in specific environments with --expose-gc flag
   */
  forceGarbageCollection() {
    if (typeof global !== 'undefined' && global.gc) {
      console.log('触发垃圾回收...');
      global.gc();
      return true;
    } else if (typeof window !== 'undefined' && window.gc) {
      console.log('触发垃圾回收...');
      window.gc();
      return true;
    } else {
      console.warn('垃圾回收不可用');
      return false;
    }
  }

  /**
   * Get resource recommendations for detection
   * @param {Object} detectionConfig - Detection configuration
   * @returns {Object} Resource recommendations
   */
  getResourceRecommendations(detectionConfig = {}) {
    const resourceInfo = this.getResourceInfo();
    const constraints = this.checkResourceConstraints(detectionConfig);
    const optimalBatchSize = this.calculateOptimalBatchSize({
      avgFileSize: detectionConfig.avgFileSize,
      currentBatchSize: detectionConfig.batchSize
    });

    return {
      canProceed: constraints.canStartDetection,
      currentResources: resourceInfo,
      recommendations: {
        batchSize: optimalBatchSize,
        shouldReduceBatchSize: optimalBatchSize < (detectionConfig.batchSize || 20),
        shouldWait: !constraints.canStartDetection,
        warnings: constraints.warnings
      },
      actions: this.getRecommendedActions(resourceInfo, constraints)
    };
  }

  /**
   * Get recommended actions based on resource state
   * @param {ResourceInfo} resourceInfo - Current resource info
   * @param {ResourceConstraints} constraints - Resource constraints
   * @returns {Array} Recommended actions
   */
  getRecommendedActions(resourceInfo, constraints) {
    const actions = [];

    if (resourceInfo.memoryUsagePercent >= this.criticalThreshold * 100) {
      actions.push({
        priority: 'high',
        action: 'wait',
        message: '等待内存释放后再开始检测'
      });
      actions.push({
        priority: 'high',
        action: 'close_apps',
        message: '关闭其他应用程序以释放内存'
      });
    } else if (resourceInfo.memoryUsagePercent >= this.warningThreshold * 100) {
      actions.push({
        priority: 'medium',
        action: 'reduce_batch',
        message: `减小批处理大小到 ${constraints.recommendations.batchSize || 10}`
      });
      actions.push({
        priority: 'medium',
        action: 'monitor',
        message: '密切监控内存使用情况'
      });
    } else {
      actions.push({
        priority: 'low',
        action: 'proceed',
        message: '资源充足，可以开始检测'
      });
    }

    return actions;
  }

  /**
   * Estimate detection time based on resources
   * @param {Object} options - Estimation options
   * @returns {Object} Time estimation
   */
  estimateDetectionTime(options = {}) {
    const totalFiles = options.totalFiles || 0;
    const batchSize = options.batchSize || 20;
    const avgTimePerFile = options.avgTimePerFile || 5000; // ms
    const resourceInfo = this.getResourceInfo();

    // Adjust time based on memory availability
    let adjustmentFactor = 1.0;
    if (resourceInfo.memoryUsagePercent >= this.warningThreshold * 100) {
      adjustmentFactor = 1.5; // 50% slower when memory is constrained
    } else if (resourceInfo.memoryUsagePercent >= this.criticalThreshold * 100) {
      adjustmentFactor = 2.0; // 100% slower when memory is critical
    }

    const totalBatches = Math.ceil(totalFiles / batchSize);
    const estimatedTimeMs = totalFiles * avgTimePerFile * adjustmentFactor;

    return {
      totalFiles,
      batchSize,
      totalBatches,
      estimatedTimeMs,
      estimatedTimeFormatted: this.formatDuration(estimatedTimeMs),
      adjustmentFactor,
      note: adjustmentFactor > 1.0 ? '由于资源限制，预计时间可能更长' : null
    };
  }

  /**
   * Format duration in milliseconds
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}小时 ${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟 ${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }
}

// Export singleton instance
export const resourceMonitorService = new ResourceMonitorServiceImpl();

// Export class for testing
export { ResourceMonitorServiceImpl };
