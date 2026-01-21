/**
 * @fileoverview Monitoring Service
 * Collects performance metrics and system health information
 */

import { loggingService, LogCategory } from './loggingService.js';

/**
 * Metric types
 * @enum {string}
 */
export const MetricType = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  TIMER: 'timer'
};

/**
 * Monitoring Service Implementation
 */
class MonitoringServiceImpl {
  constructor() {
    this.metrics = new Map();
    this.timers = new Map();
    this.alerts = [];
    this.thresholds = {
      detectionDuration: 300000, // 5 minutes
      fileProcessingTime: 30000, // 30 seconds
      errorRate: 0.1, // 10%
      memoryUsage: 0.9 // 90%
    };
    this.enabled = true;
  }

  /**
   * Enable/disable monitoring
   * @param {boolean} enabled - Enable monitoring
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Set threshold
   * @param {string} name - Threshold name
   * @param {number} value - Threshold value
   */
  setThreshold(name, value) {
    this.thresholds[name] = value;
  }

  /**
   * Record a counter metric
   * @param {string} name - Metric name
   * @param {number} [value=1] - Value to add
   * @param {Object} [tags] - Metric tags
   */
  recordCounter(name, value = 1, tags = {}) {
    if (!this.enabled) return;

    const key = this.getMetricKey(name, tags);
    const existing = this.metrics.get(key);

    if (existing && existing.type === MetricType.COUNTER) {
      existing.value += value;
      existing.lastUpdated = Date.now();
    } else {
      this.metrics.set(key, {
        name,
        type: MetricType.COUNTER,
        value,
        tags,
        created: Date.now(),
        lastUpdated: Date.now()
      });
    }

    loggingService.debug(LogCategory.SYSTEM, `Counter metric recorded: ${name}`, { value, tags });
  }

  /**
   * Record a gauge metric
   * @param {string} name - Metric name
   * @param {number} value - Current value
   * @param {Object} [tags] - Metric tags
   */
  recordGauge(name, value, tags = {}) {
    if (!this.enabled) return;

    const key = this.getMetricKey(name, tags);
    this.metrics.set(key, {
      name,
      type: MetricType.GAUGE,
      value,
      tags,
      created: Date.now(),
      lastUpdated: Date.now()
    });

    loggingService.debug(LogCategory.SYSTEM, `Gauge metric recorded: ${name}`, { value, tags });
  }

  /**
   * Record a histogram value
   * @param {string} name - Metric name
   * @param {number} value - Value to record
   * @param {Object} [tags] - Metric tags
   */
  recordHistogram(name, value, tags = {}) {
    if (!this.enabled) return;

    const key = this.getMetricKey(name, tags);
    const existing = this.metrics.get(key);

    if (existing && existing.type === MetricType.HISTOGRAM) {
      existing.values.push(value);
      existing.count++;
      existing.sum += value;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
      existing.lastUpdated = Date.now();
    } else {
      this.metrics.set(key, {
        name,
        type: MetricType.HISTOGRAM,
        values: [value],
        count: 1,
        sum: value,
        min: value,
        max: value,
        tags,
        created: Date.now(),
        lastUpdated: Date.now()
      });
    }

    loggingService.debug(LogCategory.SYSTEM, `Histogram value recorded: ${name}`, { value, tags });
  }

  /**
   * Start a timer
   * @param {string} name - Timer name
   * @param {Object} [tags] - Timer tags
   * @returns {Function} Stop function
   */
  startTimer(name, tags = {}) {
    if (!this.enabled) {
      return () => 0;
    }

    const key = this.getMetricKey(name, tags);
    const startTime = Date.now();
    this.timers.set(key, startTime);

    loggingService.debug(LogCategory.SYSTEM, `Timer started: ${name}`, { tags });

    return () => {
      const duration = Date.now() - startTime;
      this.timers.delete(key);
      this.recordHistogram(name, duration, tags);
      
      loggingService.debug(LogCategory.SYSTEM, `Timer stopped: ${name}`, { duration, tags });
      
      return duration;
    };
  }

  /**
   * Get metric key
   * @param {string} name - Metric name
   * @param {Object} tags - Metric tags
   * @returns {string} Metric key
   */
  getMetricKey(name, tags) {
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    return tagString ? `${name}|${tagString}` : name;
  }

  /**
   * Get metric
   * @param {string} name - Metric name
   * @param {Object} [tags] - Metric tags
   * @returns {Object|null} Metric or null
   */
  getMetric(name, tags = {}) {
    const key = this.getMetricKey(name, tags);
    return this.metrics.get(key) || null;
  }

  /**
   * Get all metrics
   * @returns {Array} All metrics
   */
  getAllMetrics() {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics by type
   * @param {string} type - Metric type
   * @returns {Array} Filtered metrics
   */
  getMetricsByType(type) {
    return Array.from(this.metrics.values()).filter(m => m.type === type);
  }

  /**
   * Calculate histogram statistics
   * @param {Object} histogram - Histogram metric
   * @returns {Object} Statistics
   */
  calculateHistogramStats(histogram) {
    if (histogram.type !== MetricType.HISTOGRAM || histogram.count === 0) {
      return null;
    }

    const values = [...histogram.values].sort((a, b) => a - b);
    const mean = histogram.sum / histogram.count;
    
    // Calculate percentiles
    const p50 = values[Math.floor(values.length * 0.5)];
    const p95 = values[Math.floor(values.length * 0.95)];
    const p99 = values[Math.floor(values.length * 0.99)];

    return {
      count: histogram.count,
      sum: histogram.sum,
      mean,
      min: histogram.min,
      max: histogram.max,
      p50,
      p95,
      p99
    };
  }

  /**
   * Record detection started
   * @param {string} sessionId - Session ID
   * @param {Object} config - Configuration
   */
  recordDetectionStarted(sessionId, config) {
    this.recordCounter('detection.started', 1, { sessionId });
    loggingService.info(LogCategory.DETECTION, 'Detection started', { sessionId, config });
  }

  /**
   * Record detection completed
   * @param {string} sessionId - Session ID
   * @param {number} duration - Duration in milliseconds
   * @param {Object} results - Detection results
   */
  recordDetectionCompleted(sessionId, duration, results) {
    this.recordCounter('detection.completed', 1, { sessionId });
    this.recordHistogram('detection.duration', duration, { sessionId });
    this.recordGauge('detection.files_processed', results.filesProcessed || 0, { sessionId });
    this.recordGauge('detection.defects_found', results.defectsFound || 0, { sessionId });

    loggingService.info(LogCategory.DETECTION, 'Detection completed', { 
      sessionId, 
      duration, 
      results 
    });

    // Check threshold
    if (duration > this.thresholds.detectionDuration) {
      this.createAlert('detection_duration_exceeded', {
        sessionId,
        duration,
        threshold: this.thresholds.detectionDuration
      });
    }
  }

  /**
   * Record detection failed
   * @param {string} sessionId - Session ID
   * @param {Error} error - Error object
   */
  recordDetectionFailed(sessionId, error) {
    this.recordCounter('detection.failed', 1, { sessionId });
    loggingService.error(LogCategory.DETECTION, 'Detection failed', error, { sessionId });
    
    this.createAlert('detection_failed', {
      sessionId,
      error: error.message
    });
  }

  /**
   * Record file processed
   * @param {string} sessionId - Session ID
   * @param {string} fileName - File name
   * @param {number} duration - Processing duration
   * @param {boolean} success - Success status
   */
  recordFileProcessed(sessionId, fileName, duration, success) {
    const status = success ? 'success' : 'failed';
    this.recordCounter('file.processed', 1, { sessionId, status });
    this.recordHistogram('file.processing_time', duration, { sessionId, status });

    loggingService.debug(LogCategory.DETECTION, 'File processed', {
      sessionId,
      fileName,
      duration,
      success
    });

    // Check threshold
    if (duration > this.thresholds.fileProcessingTime) {
      this.createAlert('file_processing_slow', {
        sessionId,
        fileName,
        duration,
        threshold: this.thresholds.fileProcessingTime
      });
    }
  }

  /**
   * Record batch processed
   * @param {string} sessionId - Session ID
   * @param {number} batchIndex - Batch index
   * @param {number} batchSize - Batch size
   * @param {number} duration - Processing duration
   */
  recordBatchProcessed(sessionId, batchIndex, batchSize, duration) {
    this.recordCounter('batch.processed', 1, { sessionId });
    this.recordHistogram('batch.processing_time', duration, { sessionId });
    this.recordGauge('batch.size', batchSize, { sessionId, batchIndex });

    loggingService.debug(LogCategory.BATCH, 'Batch processed', {
      sessionId,
      batchIndex,
      batchSize,
      duration
    });
  }

  /**
   * Record AI provider call
   * @param {string} provider - Provider name
   * @param {number} duration - Call duration
   * @param {boolean} success - Success status
   */
  recordAIProviderCall(provider, duration, success) {
    const status = success ? 'success' : 'failed';
    this.recordCounter('ai.calls', 1, { provider, status });
    this.recordHistogram('ai.call_duration', duration, { provider, status });

    loggingService.debug(LogCategory.AI_PROVIDER, 'AI provider call', {
      provider,
      duration,
      success
    });
  }

  /**
   * Record report generated
   * @param {string} reportId - Report ID
   * @param {number} defectsCount - Number of defects
   */
  recordReportGenerated(reportId, defectsCount) {
    this.recordCounter('report.generated', 1);
    this.recordGauge('report.defects_count', defectsCount, { reportId });

    loggingService.info(LogCategory.REPORT, 'Report generated', {
      reportId,
      defectsCount
    });
  }

  /**
   * Record memory usage
   * @param {number} usedMemory - Used memory in bytes
   * @param {number} totalMemory - Total memory in bytes
   */
  recordMemoryUsage(usedMemory, totalMemory) {
    const usageRatio = usedMemory / totalMemory;
    this.recordGauge('system.memory_used', usedMemory);
    this.recordGauge('system.memory_total', totalMemory);
    this.recordGauge('system.memory_usage_ratio', usageRatio);

    loggingService.debug(LogCategory.RESOURCE, 'Memory usage recorded', {
      usedMemory,
      totalMemory,
      usageRatio
    });

    // Check threshold
    if (usageRatio > this.thresholds.memoryUsage) {
      this.createAlert('memory_usage_high', {
        usedMemory,
        totalMemory,
        usageRatio,
        threshold: this.thresholds.memoryUsage
      });
    }
  }

  /**
   * Create alert
   * @param {string} type - Alert type
   * @param {Object} data - Alert data
   */
  createAlert(type, data) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type,
      data,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };

    this.alerts.push(alert);

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    loggingService.warn(LogCategory.SYSTEM, `Alert created: ${type}`, data);

    return alert;
  }

  /**
   * Get all alerts
   * @returns {Array} All alerts
   */
  getAlerts() {
    return [...this.alerts];
  }

  /**
   * Get unacknowledged alerts
   * @returns {Array} Unacknowledged alerts
   */
  getUnacknowledgedAlerts() {
    return this.alerts.filter(a => !a.acknowledged);
  }

  /**
   * Acknowledge alert
   * @param {string} alertId - Alert ID
   */
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
    }
  }

  /**
   * Clear all alerts
   */
  clearAlerts() {
    this.alerts = [];
  }

  /**
   * Get monitoring summary
   * @returns {Object} Monitoring summary
   */
  getSummary() {
    const detectionStarted = this.getMetric('detection.started')?.value || 0;
    const detectionCompleted = this.getMetric('detection.completed')?.value || 0;
    const detectionFailed = this.getMetric('detection.failed')?.value || 0;

    const filesProcessed = this.getMetric('file.processed', { status: 'success' })?.value || 0;
    const filesFailed = this.getMetric('file.processed', { status: 'failed' })?.value || 0;

    const durationMetric = this.getMetric('detection.duration');
    const durationStats = durationMetric ? this.calculateHistogramStats(durationMetric) : null;

    const fileTimeMetric = this.getMetric('file.processing_time');
    const fileTimeStats = fileTimeMetric ? this.calculateHistogramStats(fileTimeMetric) : null;

    return {
      detection: {
        started: detectionStarted,
        completed: detectionCompleted,
        failed: detectionFailed,
        successRate: detectionStarted > 0 
          ? ((detectionCompleted / detectionStarted) * 100).toFixed(2) + '%'
          : 'N/A',
        durationStats
      },
      files: {
        processed: filesProcessed,
        failed: filesFailed,
        successRate: (filesProcessed + filesFailed) > 0
          ? ((filesProcessed / (filesProcessed + filesFailed)) * 100).toFixed(2) + '%'
          : 'N/A',
        processingTimeStats: fileTimeStats
      },
      alerts: {
        total: this.alerts.length,
        unacknowledged: this.getUnacknowledgedAlerts().length
      },
      metrics: {
        total: this.metrics.size,
        byType: {
          counter: this.getMetricsByType(MetricType.COUNTER).length,
          gauge: this.getMetricsByType(MetricType.GAUGE).length,
          histogram: this.getMetricsByType(MetricType.HISTOGRAM).length
        }
      }
    };
  }

  /**
   * Export metrics as JSON
   * @returns {string} JSON string
   */
  exportMetrics() {
    const data = {
      metrics: Array.from(this.metrics.entries()).map(([key, value]) => ({
        key,
        ...value
      })),
      alerts: this.alerts,
      summary: this.getSummary(),
      exportedAt: new Date().toISOString()
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
    this.timers.clear();
    this.alerts = [];
    loggingService.info(LogCategory.SYSTEM, 'Monitoring service reset');
  }
}

// Export singleton instance
export const monitoringService = new MonitoringServiceImpl();

// Export default
export default monitoringService;
