/**
 * @fileoverview HTML Report Template Generator
 * Generates integrated HTML report with defect and token statistics
 */

export function generateIntegratedReport(data) {
  const {
    totalFiles,
    totalDefects,
    defectRate,
    defectReports,
    defectTypeCounts,
    tokenStats,
    sessionId
  } = data;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>代码检测完整报告</title>
  <style>
${getStyles()}
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 代码检测完整报告</h1>
    <div class="meta">
      生成时间：${new Date().toLocaleString('zh-CN')}${sessionId ? ` | 会话ID: ${sessionId}` : ''}
    </div>
  </div>
  
  <div class="tabs">
    <div class="tab active" onclick="switchTab('defects')">
      🐛 缺陷统计
    </div>
    <div class="tab" onclick="switchTab('tokens')">
      📊 Token 统计
    </div>
  </div>
  
  <div id="defects-tab" class="tab-content active">
${generateDefectsTab({ totalFiles, totalDefects, defectRate, defectReports, defectTypeCounts })}
  </div>
  
  <div id="tokens-tab" class="tab-content">
${tokenStats ? generateTokensTab(tokenStats, defectReports) : '<p style="text-align:center;padding:40px;">暂无 Token 统计数据</p>'}
  </div>
  
  <script>
    function switchTab(tabName) {
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      document.getElementById(tabName + '-tab').classList.add('active');
      event.target.classList.add('active');
    }
  </script>
</body>
</html>`;
}

function getStyles() {
  return `    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .header h1 {
      font-size: 28px;
      margin-bottom: 8px;
    }
    
    .header .meta {
      font-size: 14px;
      opacity: 0.9;
    }
    
    .tabs {
      background: white;
      border-bottom: 2px solid #e9ecef;
      display: flex;
      padding: 0 40px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    .tab {
      padding: 15px 30px;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.3s;
      font-weight: 500;
      color: #666;
    }
    
    .tab:hover {
      color: #667eea;
      background: #f8f9fa;
    }
    
    .tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
      background: #f8f9fa;
    }
    
    .tab-content {
      display: none;
      padding: 40px;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    .tab-content.active {
      display: block;
    }
    
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    
    #tokens-tab .summary-cards {
      grid-template-columns: repeat(7, 1fr);
    }
    
    .card {
      background: white;
      color: #2c3e50;
      padding: 25px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      border: 1px solid #e9ecef;
    }
    
    .card.green { border-left: 4px solid #4CAF50; }
    .card.orange { border-left: 4px solid #ff9800; }
    .card.blue { border-left: 4px solid #2196F3; }
    .card.purple { border-left: 4px solid #9C27B0; }
    .card.red { border-left: 4px solid #FF6B6B; }
    .card.teal { border-left: 4px solid #00BCD4; }
    .card.indigo { border-left: 4px solid #3F51B5; }
    
    .card-title {
      font-size: 13px;
      color: #6c757d;
      margin-bottom: 10px;
    }
    
    .card-value {
      font-size: 32px;
      font-weight: bold;
      word-break: break-all;
      line-height: 1.2;
    }
    
    #tokens-tab .card-value {
      font-size: clamp(20px, 3vw, 32px);
    }
    
    .card-unit {
      font-size: 14px;
      color: #95a5a6;
      margin-left: 5px;
    }
    
    h2 {
      color: #1a1a1a;
      font-size: 20px;
      margin: 30px 0 20px 0;
      padding-left: 12px;
      border-left: 4px solid #667eea;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    thead { background: #f8f9fa; }
    
    th {
      padding: 14px 12px;
      text-align: left;
      font-weight: 600;
      color: #555;
      border-bottom: 2px solid #dee2e6;
      font-size: 13px;
    }
    
    td {
      padding: 12px;
      border-bottom: 1px solid #e9ecef;
      font-size: 14px;
      color: #333;
    }
    
    tbody tr:hover { background: #f8f9fa; }
    
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-danger { background: #f8d7da; color: #721c24; }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #dee2e6;
      text-align: center;
      color: #666;
      font-size: 14px;
    }
    
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a !important; color: #e0e0e0 !important; }
      .header { background: linear-gradient(135deg, #4a5568 0%, #2d3748 100%) !important; }
      .tabs { background: #2d3748 !important; border-bottom-color: #4a5568 !important; }
      .tab { color: #a0aec0 !important; }
      .tab:hover { color: #667eea !important; background: #374151 !important; }
      .tab.active { color: #667eea !important; background: #374151 !important; }
      .card { background: #2d3748 !important; color: #e0e0e0 !important; border-color: #4a5568 !important; }
      .card-title { color: #a0aec0 !important; }
      .card-value { color: #e0e0e0 !important; }
      .card-unit { color: #718096 !important; }
      h2 { color: #e0e0e0 !important; }
      table { background: #2d3748 !important; }
      thead { background: #374151 !important; }
      th { color: #e0e0e0 !important; border-bottom-color: #4a5568 !important; }
      td { color: #e0e0e0 !important; border-bottom-color: #4a5568 !important; }
      td strong { color: #f0f0f0 !important; }
      tbody tr:hover { background: #374151 !important; }
      tbody tr:hover td { color: #f0f0f0 !important; }
      tr[style*="background"] { background: #374151 !important; }
      tr[style*="background"] td { color: #f0f0f0 !important; }
      .badge-success { background: #2d5016 !important; color: #9ae6b4 !important; }
      .badge-warning { background: #5f370e !important; color: #fbd38d !important; }
      .badge-danger { background: #63171b !important; color: #fc8181 !important; }
      .footer { border-top-color: #4a5568 !important; color: #a0aec0 !important; }
    }`;
}

function generateDefectsTab({ totalFiles, totalDefects, defectRate, defectReports, defectTypeCounts }) {
  // 确保 defectTypeCounts 有值
  const safeDefectTypeCounts = defectTypeCounts || {};
  
  return `    <div class="summary-cards">
      <div class="card green">
        <div class="card-title">检测文件数</div>
        <div class="card-value">${totalFiles}<span class="card-unit">个</span></div>
      </div>
      
      <div class="card orange">
        <div class="card-title">发现缺陷数</div>
        <div class="card-value">${totalDefects}<span class="card-unit">个</span></div>
      </div>
      
      <div class="card blue">
        <div class="card-title">检测模块数</div>
        <div class="card-value">${defectReports.length}<span class="card-unit">个</span></div>
      </div>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>模块名</th>
          <th>检测文件数</th>
          <th>总缺陷数</th>
          <th>AUTO</th>
          <th>CLASS</th>
          <th>DEPR</th>
          <th>LEAK</th>
          <th>MEMF</th>
          <th>OSRES</th>
          <th>PERF</th>
          <th>STL</th>
        </tr>
      </thead>
      <tbody>
        ${defectReports.map(report => {
          // 从 CSV 内容中解析缺陷类型
          const defectsByType = report.defectsByType || parseDefectsFromCSV(report.csvContent);
          
          return `
        <tr>
          <td><strong>${report.groupName}</strong></td>
          <td>${report.filesScanned || 0}</td>
          <td>${report.defectsFound || 0}</td>
          <td>${defectsByType.AUTO || 0}</td>
          <td>${defectsByType.CLASS || 0}</td>
          <td>${defectsByType.DEPR || 0}</td>
          <td>${defectsByType.LEAK || 0}</td>
          <td>${defectsByType.MEMF || 0}</td>
          <td>${defectsByType.OSRES || 0}</td>
          <td>${defectsByType.PERF || 0}</td>
          <td>${defectsByType.STL || 0}</td>
        </tr>
        `;
        }).join('')}
        <tr style="background: #f8f9fa; font-weight: bold;">
          <td>总计</td>
          <td>${totalFiles}</td>
          <td>${totalDefects}</td>
          <td>${safeDefectTypeCounts.AUTO || 0}</td>
          <td>${safeDefectTypeCounts.CLASS || 0}</td>
          <td>${safeDefectTypeCounts.DEPR || 0}</td>
          <td>${safeDefectTypeCounts.LEAK || 0}</td>
          <td>${safeDefectTypeCounts.MEMF || 0}</td>
          <td>${safeDefectTypeCounts.OSRES || 0}</td>
          <td>${safeDefectTypeCounts.PERF || 0}</td>
          <td>${safeDefectTypeCounts.STL || 0}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

// 从 CSV 内容中解析缺陷类型统计
function parseDefectsFromCSV(csvContent) {
  if (!csvContent) return {};
  
  const lines = csvContent.split('\n');
  const defectsByType = {};
  
  // 跳过标题行，从第二行开始
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // 解析 CSV 行，Category 是第二列
    const match = line.match(/^\d+,([A-Z]+),/);
    if (match) {
      const category = match[1];
      defectsByType[category] = (defectsByType[category] || 0) + 1;
    }
  }
  
  return defectsByType;
}

function generateTokensTab(tokenStats, defectReports) {
  // 如果没有 tokenStats，显示提示信息
  if (!tokenStats || !tokenStats.totalTokens) {
    return `    <div style="text-align:center;padding:60px 40px;">
      <div style="font-size:48px;margin-bottom:20px;opacity:0.5;">📊</div>
      <h3 style="color:#666;font-size:20px;margin-bottom:10px;">暂无 Token 统计数据</h3>
      <p style="color:#999;font-size:14px;">Token 统计数据将在检测完成后显示</p>
    </div>`;
  }

  const totalDuration = tokenStats.duration || 0;
  const avgSpeed = tokenStats.filesProcessed > 0 
    ? Math.round(totalDuration / tokenStats.filesProcessed / 1000) 
    : 0;

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes}分${remainingSeconds}秒` : `${seconds}秒`;
  };

  const calculateCost = (provider) => {
    const promptTokens = tokenStats.totalPromptTokens;
    const completionTokens = tokenStats.totalCompletionTokens;
    
    let cost = 0;
    if (provider === 'deepseek') {
      cost = (promptTokens / 1000 * 0.0001) + (completionTokens / 1000 * 0.0002);
    } else if (provider === 'claude') {
      cost = (promptTokens / 1000 * 0.003) + (completionTokens / 1000 * 0.015);
    }
    
    return cost.toFixed(2);
  };

  // 从 tokenStats.fileRecords 中按模块分组统计
  const moduleStats = {};
  if (tokenStats.fileRecords && Array.isArray(tokenStats.fileRecords)) {
    tokenStats.fileRecords.forEach(fileRecord => {
      const moduleName = fileRecord.moduleName || 'root';
      if (!moduleStats[moduleName]) {
        moduleStats[moduleName] = {
          filesCount: 0,
          totalLines: 0,
          codeLines: 0,
          commentLines: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          duration: 0
        };
      }
      
      const stats = moduleStats[moduleName];
      stats.filesCount++;
      stats.totalLines += fileRecord.totalLines || 0;
      stats.codeLines += fileRecord.codeLines || 0;
      stats.commentLines += fileRecord.commentLines || 0;
      stats.promptTokens += fileRecord.promptTokens || 0;
      stats.completionTokens += fileRecord.completionTokens || 0;
      stats.totalTokens += fileRecord.totalTokens || 0;
      stats.duration += fileRecord.processingTime || 0;
    });
  }

  // 使用 moduleStats 的键作为模块列表
  const modules = Object.keys(moduleStats).length > 0 
    ? Object.keys(moduleStats) 
    : [];

  return `    <div class="summary-cards">
      <div class="card blue">
        <div class="card-title">总耗时</div>
        <div class="card-value">${formatDuration(totalDuration)}</div>
      </div>
      
      <div class="card green">
        <div class="card-title">总文件数</div>
        <div class="card-value">${tokenStats.filesProcessed}<span class="card-unit">个</span></div>
      </div>
      
      <div class="card orange">
        <div class="card-title">总代码行数</div>
        <div class="card-value">${(tokenStats.totalLines || 0).toLocaleString()}<span class="card-unit">行</span></div>
      </div>
      
      <div class="card purple">
        <div class="card-title">Token 消耗/个</div>
        <div class="card-value">${tokenStats.totalTokens.toLocaleString()}</div>
      </div>
      
      <div class="card red">
        <div class="card-title">DeepSeek 费用</div>
        <div class="card-value">$${calculateCost('deepseek')}<span class="card-unit">USD</span></div>
      </div>
      
      <div class="card teal">
        <div class="card-title">Claude 费用</div>
        <div class="card-value">$${calculateCost('claude')}<span class="card-unit">USD</span></div>
      </div>
      
      <div class="card indigo">
        <div class="card-title">平均处理速度</div>
        <div class="card-value">${avgSpeed}<span class="card-unit">秒/文件</span></div>
      </div>
    </div>
    
    <h2>📊 模块处理信息</h2>
    ${modules.length > 0 ? `<table>
      <thead>
        <tr>
          <th>模块</th>
          <th>文件数</th>
          <th>总行数</th>
          <th>耗时</th>
          <th>代码行</th>
          <th>注释行</th>
          <th>输入Token</th>
          <th>输出Token</th>
          <th>Token总计</th>
          <th>Token/行</th>
        </tr>
      </thead>
      <tbody>
        ${modules.map(moduleName => {
          const stats = moduleStats[moduleName];
          
          const tokenPerLine = stats.totalLines > 0 ? (stats.totalTokens / stats.totalLines).toFixed(2) : '-';
          const durationDisplay = stats.duration > 0 ? formatDuration(stats.duration) : '-';
          const totalLinesDisplay = stats.totalLines > 0 ? stats.totalLines.toLocaleString() : '0';
          const codeLinesDisplay = stats.codeLines > 0 ? stats.codeLines.toLocaleString() : '0';
          const commentLinesDisplay = stats.commentLines > 0 ? stats.commentLines.toLocaleString() : '0';
          
          return `
        <tr>
          <td><strong>${moduleName}</strong></td>
          <td>${stats.filesCount}</td>
          <td>${totalLinesDisplay}</td>
          <td>${durationDisplay}</td>
          <td>${codeLinesDisplay}</td>
          <td>${commentLinesDisplay}</td>
          <td>${stats.promptTokens.toLocaleString()}</td>
          <td>${stats.completionTokens.toLocaleString()}</td>
          <td>${stats.totalTokens.toLocaleString()}</td>
          <td>${tokenPerLine}</td>
        </tr>
          `;
        }).join('')}
        <tr style="background: #f8f9fa; font-weight: bold;">
          <td>总计</td>
          <td>${tokenStats.filesProcessed}</td>
          <td>${(tokenStats.totalLines || 0).toLocaleString()}</td>
          <td>${formatDuration(totalDuration)}</td>
          <td>${(tokenStats.totalCodeLines || 0).toLocaleString()}</td>
          <td>${(tokenStats.totalCommentLines || 0).toLocaleString()}</td>
          <td>${tokenStats.totalPromptTokens.toLocaleString()}</td>
          <td>${tokenStats.totalCompletionTokens.toLocaleString()}</td>
          <td>${tokenStats.totalTokens.toLocaleString()}</td>
          <td>${tokenStats.summary?.avgTokensPerLine?.toFixed(2) || '-'}</td>
        </tr>
      </tbody>
    </table>` : `<p style="text-align:center;padding:40px;color:#999;">暂无模块处理信息</p>`}
  </div>`;
}
