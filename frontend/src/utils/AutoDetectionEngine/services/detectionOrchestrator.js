/**
 * @fileoverview Detection Orchestrator Service
 * Coordinates all services for the main detection workflow
 */

import { scanDirectoryByGroups, filterFiles } from './fileMonitorService.js';
import { createBatchProcessor } from './batchProcessingService.js';
import { detectDefectsInFile, deduplicateDefects } from './codeDetectionService.js';
import { resumeDetectionService } from './resumeDetectionService.js';
import { buildPairingMap } from './pairingMapService.js';
import { buildReportUnits, buildUnitPlanSnapshot, verifyUnitPlan, DEFAULT_UNIT_THRESHOLD_BYTES, DEFAULT_MAX_FILES_PER_UNIT } from './reportUnitService.js';
import * as resumeStore from '../storage/resumeStore.js';
import SessionStorage, { SessionStatus } from '../storage/sessionStorage.js';
import { resourceMonitorService } from './resourceMonitorService.js';
import tokenStatisticsService from './tokenStatisticsService.js';
import zipPackageService from './zipPackageService.js';
import { serverLog } from './serverLogService.js';

/**
 * @typedef {Object} DetectionSession
 * @property {string} id - Session ID
 * @property {string} status - Session status (running, paused, completed, failed)
 * @property {Object} progress - Progress information
 * @property {number} progress.totalFiles - Total files to process
 * @property {number} progress.processedFiles - Files processed
 * @property {string} progress.currentFile - Current file being processed
 * @property {number} progress.percentage - Progress percentage
 * @property {number} startTime - Start timestamp
 * @property {number} [endTime] - End timestamp
 * @property {Object} config - Configuration snapshot
 * @property {string} [error] - Error message if failed
 */

/**
 * Detection Orchestrator Implementation
 */
class DetectionOrchestratorImpl {
  constructor() {
    this.currentSession = null;
    this.batchProcessor = null;
    this.progressCallbacks = [];
    this.statusCallbacks = [];
    // 全局 .h/.cpp 配对映射表：扫描后一次性构建，检测全程只读共享
    // （buildPairingMap 为纯函数，断点续检重扫重建后边界一致）
    this.pairingMap = null;
    // 报告单元 xlsx 缓存：每单元完成时生成（与阶段包同源），最终包/partial 包直接复用
    this._unitReports = [];
    this._isCancelled = false;  // 使用私有变量
    
    // 🔍 调试：使用 getter/setter 监控 isCancelled 的变化
    Object.defineProperty(this, 'isCancelled', {
      get: () => {
        return this._isCancelled;
      },
      set: (value) => {
        if (this._isCancelled !== value) {
          console.log('🚨🚨🚨 isCancelled 标志变化:', this._isCancelled, '→', value);
          console.log('变化时间:', new Date().toISOString());
          console.trace('变化调用栈:');
        }
        this._isCancelled = value;
      }
    });
  }

  /**
   * Start a new detection session
   * @param {Object} options - Detection options
   * @param {FileSystemDirectoryHandle} options.directoryHandle - Directory to scan
   * @param {Object} options.config - Detection configuration
   * @param {Function} [options.onProgress] - Progress callback
   * @param {Function} [options.onStatusChange] - Status change callback
   * @param {Function} [options.onReportGenerated] - Report generated callback
   * @param {boolean} [options.resumeFromLast] - Resume from last incomplete session
   * @returns {Promise<DetectionSession>} - Created session
   */
  async startDetection(options) {
    console.log('🔥 NEW CODE LOADED - startDetection called with force cleanup');
    const { directoryHandle, config, onProgress, onStatusChange, onReportGenerated, resumeFromLast = false } = options;

    // Force cleanup any existing session state
    console.log('🧹 强制清理会话状态');
    console.trace('调用栈:');
    console.log('清理前 isCancelled:', this.isCancelled);
    
    this.currentSession = null;
    this.progressCallbacks = [];
    this.statusCallbacks = [];
    this.reportCallbacks = [];
    this.pairingMap = null;  // 清理旧配对映射表，防止跨会话泄漏
    this._unitReports = [];  // 清理旧单元报告缓存
    this.isCancelled = false;  // 重置取消标志
    
    console.log('✅ Session state forcefully cleared');
    console.log('清理后 isCancelled:', this.isCancelled);

    // Check if we should resume from last session
    if (resumeFromLast) {
      const incompleteSessions = SessionStorage.getIncompleteSessions();
      if (incompleteSessions.length > 0) {
        const lastSession = incompleteSessions[0];
        console.log(`恢复会话: ${lastSession.id}`);
        return await this.resumeFromSession(lastSession.id, options);
      }
    }

    // Check system resources before starting
    console.log('检查系统资源...');
    const resourceCheck = resourceMonitorService.checkResourceConstraints({
      batchSize: config.batchSize,
      avgFileSize: config.avgFileSize || 50
    });

    if (!resourceCheck.canStartDetection) {
      const error = `资源不足，无法开始检测:\n${resourceCheck.warnings.join('\n')}`;
      console.error(error);
      
      if (resourceCheck.recommendations.batchSize) {
        console.log(`建议: ${resourceCheck.recommendations.message}`);
        // Auto-adjust batch size
        config.batchSize = resourceCheck.recommendations.batchSize;
        console.log(`已自动调整批处理大小为: ${config.batchSize}`);
      } else {
        throw new Error(error);
      }
    }

    // Start resource monitoring
    resourceMonitorService.startMonitoring((warning) => {
      console.warn(`资源警告 [${warning.level}]: ${warning.message}`);
      
      if (warning.level === 'critical' && this.batchProcessor) {
        // Dynamically reduce batch size
        const newBatchSize = this.batchProcessor.adjustBatchSizeDynamic({
          availableMemory: warning.resourceInfo.availableMemory,
          avgFileSize: config.avgFileSize || 50
        });
        console.log(`由于资源限制，批处理大小已调整为: ${newBatchSize}`);
      }
    });

    // Create new session using SessionStorage
    this.currentSession = SessionStorage.createSession(config);

    // Start token statistics session
    tokenStatisticsService.startSession(this.currentSession.id);
    console.log('📊 Token statistics session started for:', this.currentSession.id);

    // Register callbacks
    if (onProgress) {
      this.progressCallbacks.push(onProgress);
    }
    if (onStatusChange) {
      this.statusCallbacks.push(onStatusChange);
    }

    // Notify status change
    this.notifyStatusChange(SessionStatus.RUNNING);

    try {
      // Step 1: Scan directory with filters
      console.log('步骤 1: 扫描目录...');
      const scanConfig = {
        fileTypes: config.fileTypes || ['.h', '.cpp', '.hpp', '.cc', '.cxx'],
        excludePatterns: config.excludePatterns || []
      };
      
      const { groups, rootFiles } = await scanDirectoryByGroups(directoryHandle, scanConfig);
      
      // Calculate total files
      const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0) + rootFiles.length;

      // 🔧 全局配对映射表：扫描完成后、任何检测开始前一次性建表（纯内存，零额外 IO）。
      // 之后所有配对（.h→.cpp 合并检测、.cpp→.h 骨架）与去重判断都查这张表，
      // 根治旧逻辑"同目录配对 vs 整组去重"口径不一致导致的跨目录 .cpp 漏检。
      const allScannedFiles = [...groups.flatMap((g) => g.files || []), ...rootFiles];
      this.pairingMap = buildPairingMap(allScannedFiles);
      console.log(`配对映射表已构建: ${JSON.stringify(this.pairingMap.stats)}`);
      
      // Update session progress
      SessionStorage.updateProgress(this.currentSession.id, {
        totalFiles: totalFiles,
        processedFiles: 0
      });
      
      this.currentSession = SessionStorage.load(this.currentSession.id);
      
      console.log(`扫描完成: ${groups.length} 个分组, ${totalFiles} 个文件`);
      
      // Estimate detection time
      const timeEstimate = resourceMonitorService.estimateDetectionTime({
        totalFiles,
        batchSize: config.batchSize,
        avgTimePerFile: 5000
      });
      console.log(`预计检测时间: ${timeEstimate.estimatedTimeFormatted}`);
      if (timeEstimate.note) {
        console.warn(timeEstimate.note);
      }
      
      this.notifyProgress();

      // Step 2: Process each group
      console.log('步骤 2: 开始批处理检测...');
      const allResults = [];
      
      // Initialize batch processor with resource-aware configuration
      this.batchProcessor = createBatchProcessor({
        batchSize: config.batchSize || 20,
        maxConcurrency: config.maxConcurrency || 1
      });

      // Calculate total groups (including root if it has files)
      // 🔧 报告单元化：全局去重 → 按体积拆单元 → 以单元为循环主体（doc/分阶段检测报告方案.md §3.1）
      const unitPlan = this._buildUnitPlan(groups, rootFiles, config);
      const totalGroups = unitPlan.length;

      // 🔧 断点续检：持久化单元划分快照（恢复时校验基准；写入失败不阻断检测）
      try {
        SessionStorage.updateResumeState(this.currentSession.id, {
          unitPlan: buildUnitPlanSnapshot(unitPlan),
        });
      } catch (planError) {
        console.warn('⚠️ [断点续检] unitPlan 快照写入失败（不影响检测，仅影响断点恢复粒度）:', planError?.message || planError);
      }

      // Process units（每个单元 = 阶段报告的最小产出粒度）
      for (let i = 0; i < unitPlan.length; i++) {
        // 检查是否已取消
        console.log(`🔍 检查取消标志 (单元 ${i + 1}/${unitPlan.length}): isCancelled = ${this.isCancelled}`);
        if (this.isCancelled) {
          console.log('❌ 检测已被取消，停止处理');
          console.log('取消时间:', new Date().toISOString());
          console.log('当前单元:', unitPlan[i].unitName);
          console.trace('取消检测点的调用栈:');
          throw new Error('检测已被用户取消');
        }

        const unit = unitPlan[i];
        console.log(`处理单元 ${i + 1}/${unitPlan.length}: ${unit.unitName}（目录 ${unit.groupName}，${unit.files.length} 个文件，${unit.sizeBytes}B）`);

        // Update progress with current unit info
        SessionStorage.updateProgress(this.currentSession.id, {
          currentGroup: i + 1,
          totalGroups: totalGroups,
          currentGroupName: unit.unitName
        });
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();

        const unitResult = await this.processGroup(
          { name: unit.unitName, path: unit.groupPath, files: unit.files },
          directoryHandle,
          null,  // 不传递 onReportGenerated，避免在单元完成时生成重复报告
          this.currentSession.id  // 传递 sessionId
        );

        allResults.push(unitResult);

        console.log(`✅ 单元 ${unit.unitName} 检测完成`);

        // 🔧 断点续检：单元完成即落盘（IndexedDB 存结果 + localStorage 标记）
        try {
          await this._persistUnitCompletion(unit.unitName, unitResult);
        } catch (persistError) {
          console.warn(`⚠️ [断点续检] 单元 ${unit.unitName} 落盘失败（不影响检测，仅影响断点恢复）:`, persistError?.message || persistError);
        }

        // 🔧 分阶段报告：单元完成即产出阶段包（可配置关闭；失败不阻断主流程）
        try {
          await this._emitUnitReport(unitResult, config);
        } catch (unitReportError) {
          console.warn(`⚠️ 单元 ${unit.unitName} 阶段包生成失败（不影响检测继续）:`, unitReportError?.message || unitReportError);
        }
      }

      // Step 3: Complete session
      SessionStorage.updateStatus(this.currentSession.id, SessionStatus.COMPLETED);
      SessionStorage.updateProgress(this.currentSession.id, { percentage: 100 });

      // 🔧 断点续检：会话正常完成，清理 IndexedDB 断点数据（防长期占浏览器存储）
      try {
        await resumeStore.clearSession(this.currentSession.id);
      } catch (clearError) {
        console.warn('⚠️ [断点续检] 清理会话断点数据失败（不影响本次交付）:', clearError?.message || clearError);
      }

      // End token statistics session and get statistics
      const tokenStats = tokenStatisticsService.endSession();
      let tokenStatisticsXLSX = null;

      // 诊断日志：无论是否有数据都打印 tokenStats 状态，便于定位"token_statistics.xlsx 没产出"
      console.log('📊 [tokenStats] endSession 返回:', tokenStats ? {
        sessionId: tokenStats.sessionId,
        filesProcessed: tokenStats.filesProcessed,
        fileRecordsLen: tokenStats.fileRecords ? tokenStats.fileRecords.length : 'no-fileRecords',
        totalPromptTokens: tokenStats.totalPromptTokens,
        totalCompletionTokens: tokenStats.totalCompletionTokens,
        totalTokens: tokenStats.totalTokens
      } : 'NULL(无活跃 session)');

      if (tokenStats) {
        // 始终生成 token_statistics.xlsx（即便 0 文件也输出仅汇总页），避免文件整包丢失
        const { detectUserLanguage } = await import('../utils/languageDetector.js');
        const userLang = detectUserLanguage();
        const locale = userLang === 'zh' ? 'zh' : 'en';

        tokenStatisticsXLSX = await tokenStatisticsService.generateXLSXBuffer(tokenStats, locale);
        console.log('📊 [tokenStats] generateXLSXBuffer 结果:', tokenStatisticsXLSX ? `OK(${tokenStatisticsXLSX.byteLength}B)` : 'NULL');
        if (!tokenStatisticsXLSX) {
          console.warn('⚠️ generateXLSXBuffer 返回 null，token_statistics.xlsx 将缺失');
        }
      } else {
        console.warn('⚠️ No active token statistics session (endSession 返回 null) —— token_statistics.xlsx 将缺失');
      }
      
      // Collect all defect reports for ZIP packaging
      // 🔧 单元化：各单元 xlsx 已在 _emitUnitReport 阶段生成并缓存（与阶段包同源同内容），
      // 最终包直接复用缓存，不再遍历 allResults 重新生成（避免重复转换）
      console.log('📦 Collecting all reports for ZIP packaging...');
      const defectReports = this._unitReports.slice();

      // 兜底：阶段包被关闭或个别单元生成失败时，最终包仍需完整（现场补生成缺失单元）
      if (defectReports.length < allResults.length) {
        const cachedNames = new Set(defectReports.map((r) => r.groupName));
        for (const result of allResults) {
          if (!cachedNames.has(result.groupName)) {
            try {
              const unitReport = await this._buildUnitXlsxReport(result);
              defectReports.push(unitReport);
              console.log(`  ✓ [最终包补齐] Collected report for: ${result.groupName}`);
            } catch (e) {
              console.warn(`⚠️ [最终包补齐] 单元 ${result.groupName} 报告生成失败:`, e?.message || e);
            }
          }
        }
      }

      // HTML 报告已移除：报告统一以 xlsx 交付（缺陷明细 xlsx + token_statistics.xlsx）

      // Package everything into ZIP and download
      console.log('📦 Packaging all reports into ZIP...');

      // Generate timestamp for filename: YYYY-MM-DD_HH-MM-SS
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .substring(0, 19);

      await zipPackageService.packageAndDownload({
        defectReports: defectReports,
        tokenStatistics: tokenStatisticsXLSX,
        fileName: `report_${timestamp}`
      });
      
      console.log('✅ ZIP package generated and downloaded successfully');
      
      // 🔧 调用 onReportGenerated 回调，保存报告到 localStorage（报告区）
      if (onReportGenerated) {
        console.log('📝 Saving unified report to localStorage...');
        
        // 合并所有分组的报告数据
        const allDefects = [];
        const allFileResults = [];
        let totalFilesScanned = 0;
        
        for (const result of allResults) {
          const batchResults = (result.batches || []).flatMap(batch => batch.results || []);
          totalFilesScanned += batchResults.length;
          
          batchResults.forEach(r => {
            if (r.defects && r.defects.length > 0) {
              // 🔧 B: 统一报告聚合并兜底去重，根除跨分组/根目录重复
              allDefects.push(...deduplicateDefects(r.defects));
            }
            allFileResults.push({
              file: r.filePath || r.file?.path,
              filePath: r.filePath || r.file?.path,
              defects: r.defects || []
            });
          });
        }
        
        // 创建统一的报告对象
        const unifiedReport = {
          groupName: 'all',  // 使用 'all' 表示这是所有分组的统一报告
          groupPath: '.',
          filesScanned: totalFilesScanned,
          defectsFound: allDefects.length,
          batches: allResults.flatMap(r => r.batches || []),
          groups: allResults,  // 保留按分组的原始结构，供报告区下载复用（与自动下载路径一致）
          sessionId: this.currentSession.id,
          timestamp: now.getTime(),
          createdAt: now.toISOString(),
          status: 'completed',
          defects: allDefects,
          results: allFileResults,
          tokenStats: tokenStats
        };
        
        // 调用回调保存到 localStorage
        onReportGenerated(unifiedReport);
        console.log('✅ Unified report saved to localStorage');
      }
      
      // Transform allResults to groups format for report generation
      const groupResults = allResults.map(result => {
        const batchResults = (result.batches || []).flatMap(batch => {
          // batch.results should now contain file results with defects
          if (!batch.results || batch.results.length === 0) {
            console.warn(`批次 ${batch.id} 没有结果数据`);
            return [];
          }
          
          return batch.results.map(fileResult => ({
            file: fileResult.filePath || fileResult.file?.path,
            filePath: fileResult.filePath || fileResult.file?.path,
            defects: fileResult.defects || []
          }));
        });
        
        console.log(`分组 ${result.groupName}: ${batchResults.length} 个文件结果`);
        
        return {
          name: result.groupName,
          path: result.groupPath,
          results: batchResults
        };
      });
      
      // Save group results to session
      this.currentSession.groups = groupResults;
      SessionStorage.save(this.currentSession);
      
      this.currentSession = SessionStorage.load(this.currentSession.id);
      this.notifyStatusChange(SessionStatus.COMPLETED);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      // Log resource statistics
      const memoryStats = resourceMonitorService.getMemoryStats();
      console.log('资源使用统计:', memoryStats);
      
      console.log('检测完成，分组数:', groupResults.length);
      
      return this.currentSession;

    } catch (error) {
      console.error('检测过程中发生错误:', error);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      // End token statistics session (even on error)
      const tokenStats = tokenStatisticsService.endSession();
      let tokenStatisticsXLSX = null;

      console.log('📊 [tokenStats-partial] endSession 返回:', tokenStats ? {
        filesProcessed: tokenStats.filesProcessed,
        fileRecordsLen: tokenStats.fileRecords ? tokenStats.fileRecords.length : 'no-fileRecords'
      } : 'NULL');

      if (tokenStats) {
        const { detectUserLanguage } = await import('../utils/languageDetector.js');
        const userLang = detectUserLanguage();
        const locale = userLang === 'zh' ? 'zh' : 'en';
        
        // Generate token statistics xlsx with user's language
        tokenStatisticsXLSX = await tokenStatisticsService.generateXLSXBuffer(tokenStats, locale);
        console.log('📊 [tokenStats-partial] generateXLSXBuffer:', tokenStatisticsXLSX ? `OK(${tokenStatisticsXLSX.byteLength}B)` : 'NULL');
        
        // Try to package partial results into ZIP
        try {
          console.log('📦 Packaging partial results into ZIP...');
          // 🔧 单元化：已完成单元的报告已在 _unitReports 缓存（且均已下载过阶段包），
          // partial 包仅补齐中断时刻未及缓存的单元
          const defectReports = this._unitReports.slice();
          const cachedNames = new Set(defectReports.map((r) => r.groupName));

          // 现场补生成缺失单元（中断可能发生在单元完成但阶段包失败/关闭时）
          for (const result of allResults || []) {
            if (!cachedNames.has(result.groupName)) {
              const batchResults = (result.batches || []).flatMap(batch => batch.results || []);
              if (batchResults.length === 0) continue;
              try {
                const unitReport = await this._buildUnitXlsxReport(result);
                defectReports.push(unitReport);
                console.log(`  ✓ [partial 补齐] Collected report for: ${result.groupName}`);
              } catch (e) {
                console.warn(`⚠️ [partial 补齐] 单元 ${result.groupName} 报告生成失败:`, e?.message || e);
              }
            }
          }
          
          if (defectReports.length > 0 || tokenStatisticsXLSX) {
            // HTML 报告已移除：报告统一以 xlsx 交付（缺陷明细 xlsx + token_statistics.xlsx）
            
            // Generate timestamp for partial report filename
            const now = new Date();
            const timestamp = now.toISOString()
              .replace(/[:.]/g, '-')
              .replace('T', '_')
              .substring(0, 19);
            
            await zipPackageService.packageAndDownload({
              defectReports: defectReports,
              tokenStatistics: tokenStatisticsXLSX,
              fileName: `report_${timestamp}_partial`
            });
            
            console.log('✅ Partial ZIP package generated');
          }
        } catch (zipError) {
          console.error('❌ Failed to generate partial ZIP:', zipError);
        }
      }
      
      // 检查是否是用户取消
      if (this.isCancelled || error.message.includes('取消')) {
        console.log('检测被用户取消');
        SessionStorage.updateStatus(this.currentSession.id, SessionStatus.CANCELLED, '用户取消了检测');
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyStatusChange(SessionStatus.CANCELLED);
        
        // 不抛出错误，正常返回
        return this.currentSession;
      }
      
      SessionStorage.updateStatus(this.currentSession.id, SessionStatus.FAILED, error.message);
      this.currentSession = SessionStorage.load(this.currentSession.id);
      this.notifyStatusChange(SessionStatus.FAILED);
      
      throw error;
    }
  }

  /**
   * 🔧 报告单元化：全局去重 + 按体积拆单元（startDetection / resume 共用）。
   * 顺序（方案 §3.1）：全局配对去重（查映射表）→ 每组 splitFilesIntoUnits → 单元列表。
   * 阈值来自 config.reportUnitSizeThresholdKB（0 = 不拆分，退化为一组一单元 = 旧行为）。
   *
   * @param {Array} groups - 扫描得到的一级目录分组
   * @param {Array} rootFiles - 根目录散文件
   * @param {Object} config - 检测配置
   * @returns {Array} [{ unitName, groupName, groupPath, files, sizeBytes }]
   */
  _buildUnitPlan(groups, rootFiles, config) {
    const thresholdKB = Number(
      config?.reportUnitSizeThresholdKB ?? (DEFAULT_UNIT_THRESHOLD_BYTES / 1024)
    );
    const thresholdBytes = Math.max(0, thresholdKB) * 1024;
    const maxFilesPerUnit = Number(config?.maxFilesPerUnit ?? DEFAULT_MAX_FILES_PER_UNIT);

    const unitOptions = { thresholdBytes, maxFilesPerUnit };
    const units = [];

    for (const g of groups || []) {
      // 全局配对去重（已建映射表时查表，口径与 .h 合并检测一致）
      const detectionFiles = this._filterPairedImplementationFiles(g.files || []);
      if (detectionFiles.length !== (g.files || []).length) {
        serverLog?.info(
          `配对源头去重：组 ${g.name} 从检测清单移除 ${(g.files || []).length - detectionFiles.length} 个被 .h 认领的实现文件`
        );
      }
      for (const u of buildReportUnits(g.name, detectionFiles, unitOptions)) {
        units.push({ ...u, groupPath: g.path });
      }
    }

    if ((rootFiles || []).length > 0) {
      const detectionRootFiles = this._filterPairedImplementationFiles(rootFiles);
      for (const u of buildReportUnits('root', detectionRootFiles, unitOptions)) {
        units.push({ ...u, groupPath: '.' });
      }
    }

    console.log(`[报告单元] 单元划分完成：共 ${units.length} 个单元（阈值 ${thresholdBytes}B，${maxFilesPerUnit} 文件/单元兜底）`);
    return units;
  }

  /**
   * 🔧 从单元检测结果生成 xlsx 报告对象（阶段包 / 最终包补齐 / partial 补齐共用）。
   *
   * @param {Object} result - processGroup 返回的单元结果（含 groupName/groupPath/batches）
   * @returns {Promise<{groupName: string, xlsxBuffer: ArrayBuffer, defects: Array, filesScanned: number, defectsFound: number}>}
   */
  async _buildUnitXlsxReport(result) {
    const groupName = result.groupName;
    const batchResults = (result.batches || []).flatMap((batch) => batch.results || []);

    const { default: reportGenerationService } = await import('./reportGenerationService.js');

    const groupReport = {
      groupName: groupName,
      groupPath: result.groupPath || '.',
      filesScanned: batchResults.length,
      defectsFound: batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0),
      defects: batchResults.flatMap((r) => r.defects || []),
      fileResults: batchResults.map((r) => ({
        file: { path: r.filePath || r.file?.path },
        filePath: r.filePath || r.file?.path,
        defects: r.defects || [],
        hasDefects: (r.defects?.length || 0) > 0
      })),
      totalFiles: batchResults.length,
      totalDefects: batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0),
      summary: { bySeverity: {}, byType: {} }
    };

    // Convert to DetectionReport format and export as xlsx
    const detectionReport = reportGenerationService.convertCodeDetectionReport(groupReport);
    const { blob: xlsxBlob } = reportGenerationService.generateXLSXReport(detectionReport, groupName);
    const xlsxBuffer = await xlsxBlob.arrayBuffer();

    // Collect flat defects for statistics
    const allDefects = [];
    for (const fr of (detectionReport.fileResults || [])) {
      if (fr.hasDefects && fr.defects?.length) {
        for (const d of fr.defects) {
          if (!reportGenerationService.isPlaceholderDefectInMarkdown(d)) {
            allDefects.push({ ...d, _filePath: fr.file?.path || '' });
          }
        }
      }
    }

    return {
      groupName: groupName,
      xlsxBuffer: xlsxBuffer,   // xlsx binary for ZIP
      defects: allDefects,      // flat list for statistics
      filesScanned: groupReport.filesScanned,
      defectsFound: groupReport.defectsFound
    };
  }

  /**
   * 🔧 分阶段报告：单元完成时生成 xlsx → 缓存 + 可选阶段包下载（方案 §3.2 形态 A）。
   * 阶段包仅含该单元 xlsx（不含 token 统计——token 按会话全局累计，单元边界切不动）。
   * 阶段包下载失败（如 Chrome 多文件下载授权被拒）不阻断检测主流程。
   *
   * @param {Object} unitResult - processGroup 返回的单元结果
   * @param {Object} config - 检测配置（stageDownloadEnabled 默认开）
   */
  async _emitUnitReport(unitResult, config) {
    const unitReport = await this._buildUnitXlsxReport(unitResult);
    this._unitReports.push(unitReport);
    console.log(`  ✓ [阶段报告] 已缓存单元报告: ${unitReport.groupName}（${unitReport.filesScanned} 文件 / ${unitReport.defectsFound} 缺陷）`);

    if (config?.stageDownloadEnabled === false) {
      return; // 阶段下载关闭：仅缓存，最后出完整包
    }

    const ts = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    await zipPackageService.packageAndDownload({
      defectReports: [unitReport],
      tokenStatistics: null,
      fileName: `report_${ts}_${unitReport.groupName}`
    });
    console.log(`  📦 [阶段报告] 单元阶段包已下载: report_${ts}_${unitReport.groupName}.zip`);
  }

  /**
   * 🔧 断点续检：单元完成落盘（单元级进度的提交点）。
   * IndexedDB 存单元结果（batches 等，恢复时重建报告）；localStorage 标记完成。
   * 全部失败仅损失恢复粒度，检测主流程不受影响。
   *
   * @param {string} unitName - 单元名
   * @param {Object} unitResult - processGroup 返回的单元结果
   */
  async _persistUnitCompletion(unitName, unitResult) {
    const sessionId = this.currentSession?.id;
    if (!sessionId) return;

    // 提取本单元的 token 记录（恢复时回放，保证 token_statistics.xlsx 全量）
    const unitFilePaths = new Set(
      (unitResult.batches || []).flatMap((b) => (b.results || []).map((r) => r.filePath || r.file?.path)).filter(Boolean)
    );
    const tokenRecords = (tokenStatisticsService.currentSession?.fileRecords || [])
      .filter((r) => unitFilePaths.has(r.filePath));

    // IndexedDB：单元结果（恢复时作为"已完成单元"的数据源）
    await resumeStore.saveUnitResult(sessionId, unitName, {
      groupName: unitResult.groupName,
      groupPath: unitResult.groupPath,
      batches: unitResult.batches,
      aggregated: unitResult.aggregated,
      tokenRecords,
    });

    // localStorage：完成标记（轻量清单）
    SessionStorage.updateResumeState(sessionId, {
      completedUnits: { [unitName]: true },
    });
  }

  /**
   * 🔧 断点续检：文件完成落盘（文件级进度 + mtime/size 指纹）。
   * 指纹用于恢复时校验"文件检测期间未被修改"，不一致则该文件重跑。
   *
   * @param {Object} file - 刚检测完成的文件对象（含 path/lastModified/size）
   */
  _persistFileCompletion(file) {
    const sessionId = this.currentSession?.id;
    if (!sessionId || !file?.path) return;
    try {
      SessionStorage.updateResumeState(sessionId, {
        completedFiles: {
          [file.path]: { mtime: file.lastModified || 0, size: file.size || 0 },
        },
      });
    } catch (e) {
      console.warn('⚠️ [断点续检] 文件完成标记写入失败:', e?.message || e);
    }
  }

  /**
   * 🔧 断点续检（块级）：为大文件构造分块续跑参数（从 chunkProgress/chunkResults 断点读取）。
   * 无论有无历史断点都返回 onChunkDone（首跑即开始累积块进度，中断才有块级断点可恢复）；
   * 仅普通非分块文件路径完全忽略本参数（行为不变）。
   * 指纹不一致（文件已被修改，块边界可能漂移）→ 放弃断点整文件重跑（保守）。
   *
   * 🔧 skipChunks（§12.2 前置改造）：进度从 doneChunks 计数（前缀语义）升级为 doneSet
   * 完成块集合（乱序安全）——为第三阶段风险调度铺地基；按序执行时集合恒为前缀，行为不变。
   * 旧格式断点（仅 doneChunks）读取时转换为前缀集合，兼容已存断点。
   *
   * @param {Object} file - 待检测文件对象（含 path/lastModified/size）
   * @returns {Promise<{onChunkDone: Function, skipChunks: number[], priorDefects: Array}|null>}
   *   null 仅当会话缺失（无进度可写）
   */
  async _buildChunkResume(file) {
    const sessionId = this.currentSession?.id;
    if (!sessionId || !file?.path) return null;

    const prog = SessionStorage.getResumeState(sessionId).chunkProgress?.[file.path];
    // 完成块集合：新格式 doneSet；旧格式 doneChunks 计数 → 前缀集合兼容
    let doneSet = Array.isArray(prog?.doneSet) ? new Set(prog.doneSet) : new Set();
    if (doneSet.size === 0 && prog && prog.doneChunks > 0) {
      const n = Math.min(prog.doneChunks, prog.totalChunks || prog.doneChunks);
      for (let k = 0; k < n; k++) doneSet.add(k);
    }

    let priorDefects = [];
    let totalChunks = 0; // onChunkDone 首次回调时以实际值覆盖
    const hasPartial = prog && prog.totalChunks && doneSet.size > 0 && doneSet.size < prog.totalChunks;

    if (hasPartial) {
      // 指纹校验（§12.3 裁决链第一环：mtime/size 快速预判）：
      //   不一致 → 不在此处直接放弃断点，改为清空块级断点走文件级重检——
      //   文件级检测时 chunk 缓存（内容寻址）会对未变化块自然命中（hash 裁决），
      //   真正变化的块才重新送审 = 增量重跑语义；无缓存/关闭时退化为整文件重跑（旧保守行为）。
      if ((prog.mtime || 0) !== (file.lastModified || 0) || (prog.size || 0) !== (file.size || 0)) {
        console.warn(`[断点续检] ${file.path} 断点后文件已变更（指纹不一致），清空块级断点交由文件级重检（chunk 缓存将按内容 hash 增量复用未变化块）`);
        doneSet = new Set();
      } else {
        totalChunks = prog.totalChunks;
        const saved = await resumeStore.loadChunkResult(sessionId, file.path);
        priorDefects = saved?.defects || [];
        console.log(`[断点续检] ${file.path} 恢复：已完成块 ${doneSet.size}/${prog.totalChunks}（集合 ${[...doneSet].sort((a, b) => a - b).join(',')}），其余续跑`);
      }
    }

    const sessionIdFixed = sessionId;
    const filePath = file.path;
    // 闭包内维护累积集合（避免每次回调读-改-写 localStorage 的竞态与开销）
    const liveDoneSet = new Set(doneSet);

    return {
      skipChunks: [...doneSet],
      priorDefects,
      onChunkDone: (chunkIndex, chunkDefects, actualTotalChunks) => {
        // 优先用回调实际传入的总块数（首跑时未知），兜底断点记录值
        const tc = actualTotalChunks || totalChunks;
        liveDoneSet.add(chunkIndex);
        // IndexedDB：块级缺陷累积（小事务，集合幂等）
        resumeStore.appendChunkResult(sessionIdFixed, filePath, chunkIndex, tc, chunkDefects);
        // localStorage：完成块集合 + 文件指纹（供下次恢复校验）
        try {
          SessionStorage.updateResumeState(sessionIdFixed, {
            chunkProgress: {
              [filePath]: {
                doneSet: [...liveDoneSet],
                totalChunks: tc,
                mtime: file.lastModified || 0,
                size: file.size || 0,
              },
            },
          });
        } catch (e) {
          console.warn('⚠️ [断点续检] 块进度写入失败:', e?.message || e);
        }
      },
    };
  }

  /**
   * Process a single group
   * @param {Object} group - File group
   * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
   * @param {Function} [onReportGenerated] - Report callback
   * @returns {Promise<Object>} - Group result
   */
  async processGroup(group, directoryHandle, onReportGenerated) {
    const { name, path, files } = group;
    
    // 🔧 C: 配对源头去重——.h 会合并其同名 .cpp 一起检测，故从独立检测清单移除该 .cpp
    const detectionFiles = this._filterPairedImplementationFiles(files);
    if (detectionFiles.length !== files.length) {
      serverLog?.info(`配对源头去重：从独立检测清单移除 ${files.length - detectionFiles.length} 个被 .h 配对的实现文件`);
    }

    // Create batches with pairing logic
    const batches = this.batchProcessor.createBatches(detectionFiles);
    console.log(`创建了 ${batches.length} 个批次`);

    // Update session with batch info
    SessionStorage.updateProgress(this.currentSession.id, {
      totalBatches: batches.length,
      currentBatch: 0
    });

    // Process batches
    const processedBatches = await this.batchProcessor.processAllBatches(
      batches,
      async (file) => {
        // 检查是否已取消
        if (this.isCancelled) {
          console.log('❌ 文件处理时检测到取消标志');
          console.log('文件:', file.path);
          console.log('取消时间:', new Date().toISOString());
          throw new Error('检测已被用户取消');
        }
        
        // Update progress
        SessionStorage.updateProgress(this.currentSession.id, {
          currentFile: file.name
        });
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        // Detect defects in file
        let defects = [];
        try {
          // Get projectType from config
          const projectType = this.currentSession.config.projectType;
          if (!projectType) {
            throw new Error('Project type is required for detection');
          }
          
          defects = await detectDefectsInFile(
            file,
            directoryHandle,
            projectType,
            this.pairingMap,
            await this._buildChunkResume(file)  // 🔧 块级断点续检（无断点时为 null，行为不变）
          );

          // Track processed file
          SessionStorage.addProcessedFile(this.currentSession.id, {
            path: file.path,
            name: file.name,
            defectsFound: defects.length
          });

          // 🔧 断点续检：文件级进度落盘（含指纹，恢复时校验文件未变更）
          this._persistFileCompletion(file);
        } catch (error) {
          console.error(`处理文件 ${file.name} 失败:`, error);
          
          // Track failed file
          SessionStorage.addFailedFile(this.currentSession.id, {
            path: file.path,
            name: file.name,
            error: error.message
          });
        }
        
        // Update progress
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        return defects;
      },
      (batchIndex, totalBatches) => {
        console.log(`批次进度: ${batchIndex}/${totalBatches}`);
        SessionStorage.updateProgress(this.currentSession.id, {
          currentBatch: batchIndex
        });
      }
    );

    // Aggregate results
    const aggregated = this.batchProcessor.aggregateResults(processedBatches);
    
    // 注意：报告生成已移至 startDetection 中，在 processGroup 完成后统一处理
    // 这样可以确保每个分组只生成一次报告

    return {
      groupName: name,
      groupPath: path,
      batches: processedBatches,
      aggregated
    };
  }

  /**
   * 🔧 配对源头去重 C：从待检测文件列表移除"已被 .h 认领合并检测的 .cpp"，
   * 避免 .h 合并 .cpp 检测后 .cpp 又被单独检测一次造成的"双边重复"。
   *
   * 判断依据优先使用全局配对映射表（this.pairingMap.isClaimedImpl）：
   * 「剔除口径 = 合并口径」——被剔除的 .cpp 必然是某个 .h 检测时明确合并的，
   * 根治旧版"按基名整组剔除 + 同目录查找合并"口径不一致造成的跨目录漏检。
   * 映射表缺失时（异常防御）降级为旧版基名逻辑。
   *
   * @param {Array} files - 文件列表（含 name/path 字段）
   * @returns {Array} 过滤后的文件列表
   */
  _filterPairedImplementationFiles(files) {
    if (!Array.isArray(files) || files.length === 0) return files;

    // 优先：全局映射表认领判断（口径与 .h 检测时的合并完全一致）
    if (this.pairingMap && typeof this.pairingMap.isClaimedImpl === 'function') {
      return files.filter((f) => {
        if (!f || !f.path) return true;
        const lower = String(f.name || '').toLowerCase();
        if (/\.(cpp|cc|cxx)$/.test(lower) && this.pairingMap.isClaimedImpl(f.path)) {
          return false; // 被同名 .h 认领合并检测，剔除独立检测
        }
        return true;
      });
    }

    // 降级：旧版按基名匹配（仅表缺失时走，与 .h 同目录合并口径存在不一致的旧 bug）
    const headerBases = new Set();
    for (const f of files) {
      if (f && f.name && f.name.toLowerCase().endsWith('.h')) {
        headerBases.add(f.name.substring(0, f.name.lastIndexOf('.')).toLowerCase());
      }
    }
    if (headerBases.size === 0) return files;
    const implExts = ['.cpp', '.cc', '.cxx'];
    return files.filter((f) => {
      if (!f || !f.name) return true;
      const lower = f.name.toLowerCase();
      const dot = lower.lastIndexOf('.');
      if (dot <= 0) return true;
      const ext = lower.substring(dot);
      if (implExts.includes(ext)) {
        const base = lower.substring(0, dot);
        if (headerBases.has(base)) return false; // 已被同名 .h 配对，剔除独立检测
      }
      return true;
    });
  }

  /**
   * Pause current detection session
   * @returns {Promise<void>}
   */
  async pauseDetection() {
    if (!this.currentSession || this.currentSession.status !== SessionStatus.RUNNING) {
      throw new Error('没有正在运行的检测会话');
    }

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.PAUSED);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.PAUSED);
    
    console.log('检测已暂停');
  }

  /**
   * Resume paused detection session
   * @returns {Promise<void>}
   */
  async resumeDetection() {
    if (!this.currentSession || this.currentSession.status !== SessionStatus.PAUSED) {
      throw new Error('没有暂停的检测会话');
    }

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.RUNNING);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.RUNNING);
    
    console.log('检测已恢复');
    
    // Continue from where it left off
    // This would require more complex state management
    // For now, just update status
  }

  /**
   * Cancel current detection session
   * @returns {Promise<void>}
   */
  async cancelDetection() {
    // 🔍 调试：记录调用栈
    console.log('🛑🛑🛑 detectionOrchestrator.cancelDetection() 被调用');
    console.trace('调用栈:');
    console.log('当前时间:', new Date().toISOString());
    console.log('当前会话:', this.currentSession?.id);
    console.log('isCancelled 当前值:', this.isCancelled);
    
    if (!this.currentSession) {
      throw new Error('没有活动的检测会话');
    }

    // 设置取消标志
    this.isCancelled = true;
    console.log('✅ 设置取消标志为 true，检测将在下一个检查点停止');

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.CANCELLED);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.CANCELLED);
    
    // Stop resource monitoring
    resourceMonitorService.stopMonitoring();
    
    console.log('检测已取消');
  }

  /**
   * Get current session status
   * @returns {DetectionSession|null} - Current session or null
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Get session progress
   * @returns {Object|null} - Progress information or null
   */
  getProgress() {
    return this.currentSession ? this.currentSession.progress : null;
  }

  /**
   * Generate session ID
   * @returns {string} - Session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Notify progress callbacks
   */
  notifyProgress() {
    if (this.currentSession) {
      for (const callback of this.progressCallbacks) {
        try {
          callback(this.currentSession.progress);
        } catch (error) {
          console.error('进度回调错误:', error);
        }
      }
    }
  }

  /**
   * Notify status change callbacks
   * @param {string} status - New status
   */
  notifyStatusChange(status) {
    for (const callback of this.statusCallbacks) {
      try {
        callback(status, this.currentSession);
      } catch (error) {
        console.error('状态变更回调错误:', error);
      }
    }
  }

  /**
   * Clear callbacks
   */
  clearCallbacks() {
    this.progressCallbacks = [];
    this.statusCallbacks = [];
  }

  /**
   * Load incomplete sessions
   * @returns {Promise<DetectionSession[]>} - Incomplete sessions
   */
  async loadIncompleteSessions() {
    return SessionStorage.getIncompleteSessions();
  }

  /**
   * Resume from incomplete session
   * @param {string} sessionId - Session ID to resume
   * @param {Object} options - Resume options
   * @returns {Promise<DetectionSession>} - Resumed session
   */
  async resumeFromSession(sessionId, options) {
    const session = SessionStorage.load(sessionId);
    
    if (!session) {
      throw new Error('会话不存在');
    }

    // Set as current session
    this.currentSession = session;
    
    // Update status to running
    SessionStorage.updateStatus(sessionId, SessionStatus.RUNNING);
    this.currentSession = SessionStorage.load(sessionId);

    // Register callbacks
    if (options.onProgress) {
      this.progressCallbacks.push(options.onProgress);
    }
    if (options.onStatusChange) {
      this.statusCallbacks.push(options.onStatusChange);
    }

    this.notifyStatusChange(SessionStatus.RUNNING);

    // Start resource monitoring
    resourceMonitorService.startMonitoring((warning) => {
      console.warn(`资源警告 [${warning.level}]: ${warning.message}`);
      
      if (warning.level === 'critical' && this.batchProcessor) {
        const newBatchSize = this.batchProcessor.adjustBatchSizeDynamic({
          availableMemory: warning.resourceInfo.availableMemory,
          avgFileSize: session.config.avgFileSize || 50
        });
        console.log(`由于资源限制，批处理大小已调整为: ${newBatchSize}`);
      }
    });

    try {
      // Get processed files list（旧路径兼容：无 resume 字段的会话按文件路径过滤）
      const processedFiles = session.results?.processedFilesList || [];
      const processedPaths = new Set(processedFiles.map(f => f.path));

      // 🔧 断点续检三级进度清单（新路径；旧会话缺失字段时为空结构 → 全量重跑，保守）
      const resumeState = session.resume || {
        unitPlan: [], completedUnits: {}, completedFiles: {}, chunkProgress: {},
      };
      const completedUnits = resumeState.completedUnits || {};
      const completedFiles = resumeState.completedFiles || {};

      console.log(`恢复会话 ${sessionId}，旧路径已处理 ${processedFiles.length} 个文件；断点：已完成单元 ${Object.keys(completedUnits).length} 个`);

      // Scan directory again
      const scanConfig = {
        fileTypes: session.config.fileTypes || ['.h', '.cpp', '.hpp', '.cc', '.cxx'],
        excludePatterns: session.config.excludePatterns || []
      };
      
      const { groups, rootFiles } = await scanDirectoryByGroups(options.directoryHandle, scanConfig);
      
      // 🔧 恢复路径同样在检测前重建全局配对映射表（buildPairingMap 纯函数，
      // 与首跑同输入同输出，配对与去重口径与首轮一致）
      const allScannedFiles = [...groups.flatMap((g) => g.files || []), ...rootFiles];
      this.pairingMap = buildPairingMap(allScannedFiles);
      console.log(`[resume] 配对映射表已重建: ${JSON.stringify(this.pairingMap.stats)}`);

      // 🔧 断点续检：重划分单元（确定性，与首跑一致）→ 校验快照 → 三级分流
      const unitPlan = this._buildUnitPlan(groups, rootFiles, session.config);
      const verify = verifyUnitPlan(unitPlan, resumeState.unitPlan || []);
      // 快照不一致的单元整单元重跑（保守：文件增删改导致的配对/边界漂移被自然覆盖）
      const skipUnits = new Set(
        Object.keys(completedUnits).filter((u) => !verify.changedUnits.includes(u))
      );
      if (verify.changedUnits.length > 0) {
        console.warn(`[resume] 单元划分与快照不一致，以下单元将整单元重跑: ${verify.changedUnits.join(', ')}`);
      }

      const allResults = [];
      this._unitReports = [];

      // ① 已完成且校验通过的单元：从 IndexedDB 载入结果，零 AI 调用
      let resumedUnitCount = 0;
      for (const unitName of skipUnits) {
        const saved = await resumeStore.loadUnitResult(sessionId, unitName);
        if (!saved || !Array.isArray(saved.batches)) {
          console.warn(`[resume] 单元 ${unitName} 标记完成但 IndexedDB 无结果，将重跑`);
          skipUnits.delete(unitName);
          continue;
        }
        const unitResult = {
          groupName: saved.groupName || unitName,
          groupPath: saved.groupPath || '.',
          batches: saved.batches,
          aggregated: saved.aggregated || null,
        };
        allResults.push(unitResult);
        // 重建该单元的 xlsx 报告（恢复跑完后统一进最终包）
        try {
          const unitReport = await this._buildUnitXlsxReport(unitResult);
          this._unitReports.push(unitReport);
        } catch (e) {
          console.warn(`[resume] 单元 ${unitName} 报告重建失败（不影响最终包其余部分）:`, e?.message || e);
        }
        resumedUnitCount++;
      }
      console.log(`[resume] 恢复已完成单元 ${resumedUnitCount} 个（零重跑）`);

      // ② 未完成单元：文件级过滤（断点指纹优先，旧路径 processedPaths 兜底）后检测
      const filterCompleted = (files) => {
        return files.filter((f) => {
          if (skipUnits.size > 0) {
            // 新路径：文件级指纹校验（mtime/size 一致才跳过，文件变更则重跑）
            const fp = completedFiles[f.path];
            if (fp && (fp.mtime || 0) === (f.lastModified || 0) && (fp.size || 0) === (f.size || 0)) {
              return false; // 已完成且未变更，跳过
            }
          }
          // 旧路径兜底：按已处理路径过滤
          return !processedPaths.has(f.path);
        });
      };

      // 计算各单元的剩余文件，过滤掉全空的单元
      const pendingUnits = unitPlan
        .map((u) => ({ ...u, files: filterCompleted(u.files) }))
        .filter((u) => !skipUnits.has(u.unitName) && u.files.length > 0);

      const remainingTotal = pendingUnits.reduce((sum, u) => sum + u.files.length, 0);
      console.log(`剩余 ${pendingUnits.length} 个单元 / ${remainingTotal} 个文件待处理`);

      // token 统计回放：已完成单元的历史 token 记录重新计入本会话（§3.6.5）
      // 无条件 startSession（旧 resume 路径从不启动 token 会话，属原缺陷，此处一并修复）
      const replayRecords = [];
      for (const result of allResults) {
        const saved = await resumeStore.loadUnitResult(sessionId, result.groupName);
        if (saved?.tokenRecords) replayRecords.push(...saved.tokenRecords);
      }
      tokenStatisticsService.startSession(sessionId);
      for (const r of replayRecords) {
        tokenStatisticsService.recordFileTokens(
          r.fileName, r.filePath,
          { prompt_tokens: r.promptTokens, completion_tokens: r.completionTokens, total_tokens: r.totalTokens },
          '', '', r.moduleName, r.processingTime,
          { totalLines: r.totalLines, codeLines: r.codeLines, commentLines: r.commentLines }
        );
      }
      if (replayRecords.length > 0) {
        console.log(`[resume] token 统计已回放 ${replayRecords.length} 条历史记录`);
      }

      if (remainingTotal === 0 && pendingUnits.length === 0) {
        console.log('所有文件已处理完成');
        // 🔧 修复短板②：即使没有剩余文件，已完成单元也要出最终报告
        await this._finalizeResumedSession(sessionId, allResults, options);
        return this.currentSession;
      }

      // Initialize batch processor with resource-aware configuration
      this.batchProcessor = createBatchProcessor({
        batchSize: session.config.batchSize || 20,
        maxConcurrency: session.config.maxConcurrency || 1
      });

      // ③ 逐单元处理剩余文件（沿用 startDetection 的单元循环语义）
      const totalGroups = unitPlan.length;
      for (let i = 0; i < pendingUnits.length; i++) {
        if (this.isCancelled) {
          throw new Error('检测已被用户取消');
        }

        const unit = pendingUnits[i];
        SessionStorage.updateProgress(sessionId, {
          currentGroup: i + 1,
          totalGroups: totalGroups,
          currentGroupName: unit.unitName
        });
        this.currentSession = SessionStorage.load(sessionId);
        this.notifyProgress();

        const unitResult = await this.processGroup(
          { name: unit.unitName, path: unit.groupPath, files: unit.files },
          options.directoryHandle,
          null
        );
        allResults.push(unitResult);

        try {
          await this._persistUnitCompletion(unit.unitName, unitResult);
        } catch (persistError) {
          console.warn(`⚠️ [resume] 单元 ${unit.unitName} 落盘失败:`, persistError?.message || persistError);
        }

        try {
          await this._emitUnitReport(unitResult, session.config);
        } catch (unitReportError) {
          console.warn(`⚠️ [resume] 单元 ${unit.unitName} 阶段包生成失败:`, unitReportError?.message || unitReportError);
        }
      }

      // 🔧 修复短板②：恢复跑完生成完整报告（旧单元结果 + 新跑结果 + 全量 token）
      await this._finalizeResumedSession(sessionId, allResults, options);

      return this.currentSession;

    } catch (error) {
      console.error('恢复检测过程中发生错误:', error);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      SessionStorage.updateStatus(sessionId, SessionStatus.FAILED, error.message);
      this.currentSession = SessionStorage.load(sessionId);
      this.notifyStatusChange(SessionStatus.FAILED);
      
      throw error;
    }
  }

  /**
   * 🔧 断点续检收尾：恢复会话跑完后生成完整最终报告（修复旧 resume 路径无报告的短板②）。
   * 合并 IndexedDB 载入的旧单元结果 + 新跑结果 + 全量 token 统计 → 最终 ZIP + 报告区。
   *
   * @param {string} sessionId - 会话 ID
   * @param {Array} allResults - 旧单元结果 + 新跑单元结果的合集
   * @param {Object} options - resumeFromSession 的 options（含 onReportGenerated）
   */
  async _finalizeResumedSession(sessionId, allResults, options) {
    // Complete session
    SessionStorage.updateStatus(sessionId, SessionStatus.COMPLETED);
    SessionStorage.updateProgress(sessionId, { percentage: 100 });

    // 清理断点数据（已完成，断点数据不再需要）
    try {
      await resumeStore.clearSession(sessionId);
    } catch (clearError) {
      console.warn('⚠️ [resume] 清理断点数据失败:', clearError?.message || clearError);
    }

    // token 统计（含回放的历史记录 = 全量）
    const tokenStats = tokenStatisticsService.endSession();
    let tokenStatisticsXLSX = null;
    if (tokenStats) {
      const { detectUserLanguage } = await import('../utils/languageDetector.js');
      const userLang = detectUserLanguage();
      const locale = userLang === 'zh' ? 'zh' : 'en';
      tokenStatisticsXLSX = await tokenStatisticsService.generateXLSXBuffer(tokenStats, locale);
    }

    // 最终包：_unitReports 已含旧单元（载入重建）与新单元（_emitUnitReport 缓存）
    const defectReports = this._unitReports.slice();
    const cachedNames = new Set(defectReports.map((r) => r.groupName));
    for (const result of allResults) {
      if (!cachedNames.has(result.groupName)) {
        try {
          defectReports.push(await this._buildUnitXlsxReport(result));
        } catch (e) {
          console.warn(`⚠️ [resume 最终包] 单元 ${result.groupName} 报告补齐失败:`, e?.message || e);
        }
      }
    }

    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    // 空保护：无任何单元结果且无 token 统计时不出空包（旧会话已被完整处理的原行为）
    if (defectReports.length > 0 || tokenStatisticsXLSX) {
      await zipPackageService.packageAndDownload({
        defectReports: defectReports,
        tokenStatistics: tokenStatisticsXLSX,
        fileName: `report_${timestamp}_resumed`
      });
      console.log('✅ [resume] 恢复会话的完整最终包已生成下载');
    } else {
      console.log('[resume] 无可交付结果（旧会话已完整处理），跳过打包');
    }

    // 报告区（localStorage unifiedReport），结构与 startDetection 保持一致
    if (options?.onReportGenerated) {
      const now = new Date();
      const allDefects = [];
      const allFileResults = [];
      let totalFilesScanned = 0;
      for (const result of allResults) {
        const batchResults = (result.batches || []).flatMap((batch) => batch.results || []);
        totalFilesScanned += batchResults.length;
        batchResults.forEach((r) => {
          if (r.defects && r.defects.length > 0) {
            allDefects.push(...deduplicateDefects(r.defects));
          }
          allFileResults.push({
            file: r.filePath || r.file?.path,
            filePath: r.filePath || r.file?.path,
            defects: r.defects || []
          });
        });
      }
      options.onReportGenerated({
        groupName: 'all',
        groupPath: '.',
        filesScanned: totalFilesScanned,
        defectsFound: allDefects.length,
        batches: allResults.flatMap((r) => r.batches || []),
        groups: allResults,
        sessionId,
        timestamp: now.getTime(),
        createdAt: now.toISOString(),
        status: 'completed',
        defects: allDefects,
        results: allFileResults,
        tokenStats: tokenStats
      });
    }

    this.currentSession = SessionStorage.load(sessionId);
    this.notifyStatusChange(SessionStatus.COMPLETED);
    resourceMonitorService.stopMonitoring();
    console.log('恢复的检测完成（含完整报告交付）');
  }

  /**
   * Get session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Session or null
   */
  getSession(sessionId) {
    return SessionStorage.load(sessionId);
  }

  /**
   * Delete session by ID
   * @param {string} sessionId - Session ID
   * @returns {boolean} - Success status
   */
  deleteSession(sessionId) {
    return SessionStorage.delete(sessionId);
  }

  /**
   * Get session statistics
   * @returns {Object} - Session statistics
   */
  getSessionStats() {
    return SessionStorage.getStats();
  }

  /**
   * Cleanup old sessions
   * @returns {Object} - Cleanup results
   */
  cleanupOldSessions() {
    return SessionStorage.cleanupOldSessions();
  }
}

// Export singleton instance
export const detectionOrchestrator = new DetectionOrchestratorImpl();

// Export factory function
export const createDetectionOrchestrator = () => {
  return new DetectionOrchestratorImpl();
};
