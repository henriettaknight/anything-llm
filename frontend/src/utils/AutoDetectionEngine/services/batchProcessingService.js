/**
 * @fileoverview Batch Processing Service
 * Handles efficient batch processing of multiple files
 */

import { resourceMonitorService } from './resourceMonitorService.js';

/**
 * @typedef {Object} BatchConfig
 * @property {number} batchSize - Files per batch
 * @property {number} maxConcurrency - Maximum concurrent batches
 */

/**
 * @typedef {Object} FileBatch
 * @property {string} id - Batch ID
 * @property {Object[]} files - Files in batch
 * @property {string} status - Batch status
 * @property {number} [startTime] - Start time
 * @property {number} [endTime] - End time
 * @property {string} [error] - Error message
 */

/**
 * Batch status enum
 * @enum {string}
 */
export const BatchStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Default batch configuration
 * @type {BatchConfig}
 */
export const DEFAULT_BATCH_CONFIG = {
  batchSize: 20,
  maxConcurrency: 1
};

/**
 * @typedef {Function} FileProcessor
 * @param {Object} file - File to process
 * @returns {Promise<void>}
 */

/**
 * Batch Processor Implementation
 */
class BatchProcessorImpl {
  /**
   * @param {BatchConfig} [config] - Batch configuration
   */
  constructor(config = DEFAULT_BATCH_CONFIG) {
    this.config = config;
  }

  /**
   * Find paired files (.h and .cpp with same base name)
   * @param {Object[]} files - Files to pair
   * @returns {{paired: Array<{header: Object, implementation: Object}>, unpaired: Object[]}}
   */
  findPairedFiles(files) {
    const headerFiles = new Map(); // basename -> file
    const implFiles = new Map();   // basename -> file
    const paired = [];
    const unpaired = [];
    
    // Separate header and implementation files
    for (const file of files) {
      const baseName = this.getBaseName(file.name);
      const extension = this.getExtension(file.name);
      
      if (extension === '.h' || extension === '.hpp' || extension === '.h++') {
        headerFiles.set(baseName, file);
      } else if (extension === '.cpp' || extension === '.cc' || extension === '.cxx' || extension === '.c++') {
        implFiles.set(baseName, file);
      } else {
        unpaired.push(file);
      }
    }
    
    // Find pairs
    for (const [baseName, headerFile] of headerFiles.entries()) {
      if (implFiles.has(baseName)) {
        paired.push({
          header: headerFile,
          implementation: implFiles.get(baseName)
        });
        implFiles.delete(baseName);
      } else {
        unpaired.push(headerFile);
      }
    }
    
    // Add remaining implementation files to unpaired
    for (const implFile of implFiles.values()) {
      unpaired.push(implFile);
    }
    
    return { paired, unpaired };
  }

  /**
   * Get base name without extension
   * @param {string} fileName - File name
   * @returns {string} - Base name
   */
  getBaseName(fileName) {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
  }

  /**
   * Get file extension
   * @param {string} fileName - File name
   * @returns {string} - Extension (lowercase)
   */
  getExtension(fileName) {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(lastDotIndex).toLowerCase() : '';
  }

  /**
   * Create file batches with pairing logic
   * @param {Object[]} files - Files to batch
   * @returns {FileBatch[]} - Created batches
   */
  createBatches(files) {
    const batches = [];
    
    // First group by directory
    const directoryGroups = this.groupFilesByDirectory(files);
    
    // Process each directory
    for (const [directory, dirFiles] of directoryGroups.entries()) {
      // Find paired files in this directory
      const { paired, unpaired } = this.findPairedFiles(dirFiles);
      
      console.log(`目录 ${directory}: ${paired.length} 对配对文件, ${unpaired.length} 个单独文件`);
      
      // Create batches prioritizing paired files
      let currentBatch = [];
      let batchId = 0;
      
      // Add paired files first (each pair counts as 1 unit for batching)
      for (const pair of paired) {
        // Add both header and implementation to the same batch
        currentBatch.push(pair.header);
        currentBatch.push(pair.implementation);
        
        // Check if batch is full (considering pairs)
        if (currentBatch.length >= this.config.batchSize) {
          batches.push({
            id: `batch_${directory}_${batchId++}`,
            files: currentBatch,
            status: BatchStatus.PENDING
          });
          currentBatch = [];
        }
      }
      
      // Add unpaired files
      for (const file of unpaired) {
        currentBatch.push(file);
        
        if (currentBatch.length >= this.config.batchSize) {
          batches.push({
            id: `batch_${directory}_${batchId++}`,
            files: currentBatch,
            status: BatchStatus.PENDING
          });
          currentBatch = [];
        }
      }
      
      // Add remaining files as final batch
      if (currentBatch.length > 0) {
        batches.push({
          id: `batch_${directory}_${batchId++}`,
          files: currentBatch,
          status: BatchStatus.PENDING
        });
      }
    }

    console.log(`创建了 ${batches.length} 个批次`);
    return batches;
  }

  /**
   * Process single batch
   * @param {FileBatch} batch - Batch to process
   * @param {FileProcessor} processor - File processor function
   * @returns {Promise<FileBatch>} - Processed batch
   */
  async processBatch(batch, processor) {
    batch.status = BatchStatus.PROCESSING;
    batch.startTime = Date.now();
    batch.results = []; // Initialize results array

    try {
      // Process each file in batch sequentially and collect results
      for (const file of batch.files) {
        const defects = await processor(file);
        
        // Store result for this file
        batch.results.push({
          file: file,
          filePath: file.path,
          defects: defects || []
        });
      }

      batch.status = BatchStatus.COMPLETED;
      batch.endTime = Date.now();
    } catch (error) {
      batch.status = BatchStatus.FAILED;
      batch.error = error instanceof Error ? error.message : String(error);
      batch.endTime = Date.now();
    }

    return batch;
  }

  /**
   * Process all batches (with concurrency control)
   * @param {FileBatch[]} batches - Batches to process
   * @param {FileProcessor} processor - File processor function
   * @param {Function} [onProgress] - Progress callback (batchIndex, totalBatches)
   * @returns {Promise<FileBatch[]>} - Processed batches
   */
  async processAllBatches(batches, processor, onProgress) {
    const processedBatches = [];
    let batchIndex = 0;

    for (const batch of batches) {
      // Process batch
      const result = await this.processBatch(batch, processor);
      processedBatches.push(result);
      batchIndex++;

      // Report progress
      if (onProgress) {
        onProgress(batchIndex, batches.length);
      }
    }

    return processedBatches;
  }

  /**
   * Aggregate results from all batches
   * @param {FileBatch[]} batches - Processed batches
   * @returns {Object} - Aggregated results
   */
  aggregateResults(batches) {
    const aggregated = {
      totalBatches: batches.length,
      completedBatches: 0,
      failedBatches: 0,
      totalFiles: 0,
      processedFiles: 0,
      failedFiles: 0,
      errors: [],
      totalDuration: 0
    };

    for (const batch of batches) {
      aggregated.totalFiles += batch.files.length;
      
      if (batch.status === BatchStatus.COMPLETED) {
        aggregated.completedBatches++;
        aggregated.processedFiles += batch.files.length;
      } else if (batch.status === BatchStatus.FAILED) {
        aggregated.failedBatches++;
        aggregated.failedFiles += batch.files.length;
        if (batch.error) {
          aggregated.errors.push({
            batchId: batch.id,
            error: batch.error
          });
        }
      }
      
      if (batch.startTime && batch.endTime) {
        aggregated.totalDuration += (batch.endTime - batch.startTime);
      }
    }

    return aggregated;
  }

  /**
   * Dynamically adjust batch size based on resource constraints
   * @param {Object} resourceInfo - Current resource information
   * @param {number} resourceInfo.availableMemory - Available memory in MB
   * @param {number} resourceInfo.avgFileSize - Average file size in KB
   * @returns {number} - Adjusted batch size
   */
  adjustBatchSize(resourceInfo) {
    const { availableMemory = 1000, avgFileSize = 50 } = resourceInfo;
    
    // Use resource monitor service for more accurate calculation
    const optimalBatchSize = resourceMonitorService.calculateOptimalBatchSize({
      avgFileSize,
      currentBatchSize: this.config.batchSize,
      minBatchSize: 5,
      maxBatchSize: 50
    });
    
    // Log adjustment
    if (optimalBatchSize !== this.config.batchSize) {
      console.log(`调整批处理大小: ${this.config.batchSize} -> ${optimalBatchSize} (基于可用内存: ${availableMemory}MB)`);
    }
    
    return optimalBatchSize;
  }

  /**
   * Adjust batch size dynamically during processing
   * Ensures paired files (.h and .cpp) stay together
   * @param {Object} resourceInfo - Resource information
   * @returns {number} - New batch size
   */
  adjustBatchSizeDynamic(resourceInfo) {
    const newBatchSize = this.adjustBatchSize(resourceInfo);
    
    // Ensure batch size is even to accommodate file pairs
    const adjustedBatchSize = newBatchSize % 2 === 0 ? newBatchSize : newBatchSize - 1;
    
    // Update configuration
    this.config.batchSize = Math.max(2, adjustedBatchSize); // Minimum 2 to allow at least one pair
    
    return this.config.batchSize;
  }

  /**
   * Create batches with resource-aware sizing
   * @param {Object[]} files - Files to batch
   * @param {Object} [resourceInfo] - Optional resource information
   * @returns {FileBatch[]} - Created batches
   */
  createBatchesWithResourceCheck(files, resourceInfo) {
    // Check resources before creating batches
    if (resourceInfo) {
      const constraints = resourceMonitorService.checkResourceConstraints({
        batchSize: this.config.batchSize,
        avgFileSize: resourceInfo.avgFileSize
      });

      if (!constraints.canStartDetection) {
        console.warn('资源不足，调整批处理大小');
        this.adjustBatchSizeDynamic(resourceInfo);
      }
    }

    return this.createBatches(files);
  }

  /**
   * Get files in specified directory
   * @param {Object[]} files - Files to filter
   * @param {string} directory - Directory path
   * @returns {Object[]} - Filtered files
   */
  getBatchByDirectory(files, directory) {
    return files.filter(file => this.getDirectory(file.path) === directory);
  }

  /**
   * Group files by directory
   * @param {Object[]} files - Files to group
   * @returns {Map<string, Object[]>} - Grouped files
   */
  groupFilesByDirectory(files) {
    const groups = new Map();

    for (const file of files) {
      const directory = this.getDirectory(file.path);
      if (!groups.has(directory)) {
        groups.set(directory, []);
      }
      groups.get(directory).push(file);
    }

    return groups;
  }

  /**
   * Extract directory from file path
   * @param {string} filePath - File path
   * @returns {string} - Directory path
   */
  getDirectory(filePath) {
    const lastSlashIndex = filePath.lastIndexOf('/');
    return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '/';
  }

  /**
   * Get batch statistics
   * @param {FileBatch[]} batches - Batches to analyze
   * @returns {Object} - Statistics
   */
  getBatchStatistics(batches) {
    const totalBatches = batches.length;
    const completedBatches = batches.filter(b => b.status === BatchStatus.COMPLETED).length;
    const failedBatches = batches.filter(b => b.status === BatchStatus.FAILED).length;
    const pendingBatches = batches.filter(b => b.status === BatchStatus.PENDING).length;
    const processingBatches = batches.filter(b => b.status === BatchStatus.PROCESSING).length;
    
    const totalFiles = batches.reduce((sum, batch) => sum + batch.files.length, 0);
    const processedFiles = batches
      .filter(b => b.status === BatchStatus.COMPLETED)
      .reduce((sum, batch) => sum + batch.files.length, 0);

    return {
      totalBatches,
      completedBatches,
      failedBatches,
      pendingBatches,
      processingBatches,
      totalFiles,
      processedFiles
    };
  }

  /**
   * Update configuration
   * @param {Partial<BatchConfig>} config - Configuration to update
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const batchProcessor = new BatchProcessorImpl();

// Export factory function
export const createBatchProcessor = (config) => {
  return new BatchProcessorImpl(config);
};

// Export default
export default {
  BatchStatus,
  DEFAULT_BATCH_CONFIG,
  batchProcessor,
  createBatchProcessor,
  BatchProcessorImpl
};
