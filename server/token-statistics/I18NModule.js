/**
 * I18NModule
 * Handles internationalization and localization
 */

class I18NModule {
  constructor() {
    this.supportedLocales = {
      'zh-CN': '简体中文',
      'en-US': 'English',
      'ja-JP': '日本語',
      'ko-KR': '한국어',
    };

    this.defaultLocale = 'en-US';

    this.translations = {
      'zh-CN': {
        // Report UI
        'token_statistics_report': 'Token使用统计报告',
        'session_id': '会话ID',
        'generated_at': '生成时间',
        'module_statistics': '模块统计',
        'global_statistics': '全局统计',
        'no_module_data': '暂无模块数据',
        'metric': '指标',
        'value': '数值',
        // Module-level CSV headers
        'record_type': '记录类型',
        'record_id': '记录ID',
        'date': '日期',
        'period_type': '周期类型',
        'module_id': '模块ID',
        'module_name': '模块名称',
        'file_count': '文件数量',
        'total_lines': '总行数',
        'code_lines': '代码行数',
        'comment_lines': '注释行数',
        'input_tokens': '输入Token',
        'output_tokens': '输出Token',
        'total_tokens': 'Token总计',
        'avg_tokens_per_line': '平均Token/行',
        'deepseek_cost_usd': 'DeepSeek费用(USD)',
        'claude_cost_usd': 'Claude费用(USD)',
        'cost_difference': '费用差异',
        'status': '状态',
        // File-level CSV headers
        'file_id': '文件ID',
        'file_path': '文件路径',
        'file_name': '文件名',
        'file_type': '文件类型',
        'operation_type': '操作类型',
        'tokens_per_line': 'Token/行',
        'cost_per_line_usd': '每行成本(USD)',
        // Enum values
        'module': '模块',
        'summary': '汇总',
        'completed': '已完成',
        'read': '读取',
        'analyze': '分析',
        'generate': '生成',
        'modify': '修改',
        'delete': '删除',
        'global_statistics': '全局统计',
        'day': '日',
      },
      'en-US': {
        // Report UI
        'token_statistics_report': 'Token Statistics Report',
        'session_id': 'Session ID',
        'generated_at': 'Generated At',
        'module_statistics': 'Module Statistics',
        'global_statistics': 'Global Statistics',
        'no_module_data': 'No module data available',
        'metric': 'Metric',
        'value': 'Value',
        // Module-level CSV headers
        'record_type': 'Record Type',
        'record_id': 'Record ID',
        'date': 'Date',
        'period_type': 'Period Type',
        'module_id': 'Module ID',
        'module_name': 'Module Name',
        'file_count': 'File Count',
        'total_lines': 'Total Lines',
        'code_lines': 'Code Lines',
        'comment_lines': 'Comment Lines',
        'input_tokens': 'Input Tokens',
        'output_tokens': 'Output Tokens',
        'total_tokens': 'Total Tokens',
        'avg_tokens_per_line': 'Avg Tokens/Line',
        'deepseek_cost_usd': 'DeepSeek Cost (USD)',
        'claude_cost_usd': 'Claude Cost (USD)',
        'cost_difference': 'Cost Difference',
        'status': 'Status',
        // File-level CSV headers
        'file_id': 'File ID',
        'file_path': 'File Path',
        'file_name': 'File Name',
        'file_type': 'File Type',
        'operation_type': 'Operation Type',
        'tokens_per_line': 'Tokens/Line',
        'cost_per_line_usd': 'Cost Per Line (USD)',
        // Enum values
        'module': 'Module',
        'summary': 'Summary',
        'completed': 'Completed',
        'read': 'Read',
        'analyze': 'Analyze',
        'generate': 'Generate',
        'modify': 'Modify',
        'delete': 'Delete',
        'global_statistics': 'Global Statistics',
        'day': 'Day',
      },
      'ja-JP': {
        // Report UI
        'token_statistics_report': 'トークン使用統計レポート',
        'session_id': 'セッションID',
        'generated_at': '生成日時',
        'module_statistics': 'モジュール統計',
        'global_statistics': 'グローバル統計',
        'no_module_data': 'モジュールデータがありません',
        'metric': '指標',
        'value': '値',
        // Module-level CSV headers
        'record_type': 'レコードタイプ',
        'record_id': 'レコードID',
        'date': '日付',
        'period_type': '期間タイプ',
        'module_id': 'モジュールID',
        'module_name': 'モジュール名',
        'file_count': 'ファイル数',
        'total_lines': '総行数',
        'code_lines': 'コード行数',
        'comment_lines': 'コメント行数',
        'input_tokens': '入力トークン',
        'output_tokens': '出力トークン',
        'total_tokens': '総トークン',
        'avg_tokens_per_line': '平均トークン/行',
        'deepseek_cost_usd': 'DeepSeekコスト(USD)',
        'claude_cost_usd': 'Claudeコスト(USD)',
        'cost_difference': 'コスト差',
        'status': 'ステータス',
        // File-level CSV headers
        'file_id': 'ファイルID',
        'file_path': 'ファイルパス',
        'file_name': 'ファイル名',
        'file_type': 'ファイルタイプ',
        'operation_type': '操作タイプ',
        'tokens_per_line': 'トークン/行',
        'cost_per_line_usd': '行あたりコスト(USD)',
        // Enum values
        'module': 'モジュール',
        'summary': 'サマリー',
        'completed': '完了',
        'read': '読取',
        'analyze': '分析',
        'generate': '生成',
        'modify': '変更',
        'delete': '削除',
        'global_statistics': 'グローバル統計',
        'day': '日',
      },
      'ko-KR': {
        // Report UI
        'token_statistics_report': '토큰 사용 통계 보고서',
        'session_id': '세션 ID',
        'generated_at': '생성 시간',
        'module_statistics': '모듈 통계',
        'global_statistics': '전역 통계',
        'no_module_data': '모듈 데이터가 없습니다',
        'metric': '지표',
        'value': '값',
        // Module-level CSV headers
        'record_type': '레코드 유형',
        'record_id': '레코드 ID',
        'date': '날짜',
        'period_type': '기간 유형',
        'module_id': '모듈 ID',
        'module_name': '모듈 이름',
        'file_count': '파일 수',
        'total_lines': '총 라인 수',
        'code_lines': '코드 라인 수',
        'comment_lines': '주석 라인 수',
        'input_tokens': '입력 토큰',
        'output_tokens': '출력 토큰',
        'total_tokens': '총 토큰',
        'avg_tokens_per_line': '평균 토큰/라인',
        'deepseek_cost_usd': 'DeepSeek 비용(USD)',
        'claude_cost_usd': 'Claude 비용(USD)',
        'cost_difference': '비용 차이',
        'status': '상태',
        // File-level CSV headers
        'file_id': '파일 ID',
        'file_path': '파일 경로',
        'file_name': '파일 이름',
        'file_type': '파일 유형',
        'operation_type': '작업 유형',
        'tokens_per_line': '토큰/라인',
        'cost_per_line_usd': '라인당 비용(USD)',
        // Enum values
        'module': '모듈',
        'summary': '요약',
        'completed': '완료',
        'read': '읽기',
        'analyze': '분석',
        'generate': '생성',
        'modify': '수정',
        'delete': '삭제',
        'global_statistics': '전역 통계',
        'day': '일',
      },
    };
  }

  /**
   * Detect locale from browser language
   * @param {string} browserLanguage - Browser language string
   * @returns {string} Detected locale
   */
  detectLocale(browserLanguage) {
    if (!browserLanguage) {
      return this.defaultLocale;
    }

    // Try exact match first
    if (this.supportedLocales[browserLanguage]) {
      return browserLanguage;
    }

    // Try language code only (e.g., 'zh' from 'zh-CN')
    const languageCode = browserLanguage.split('-')[0];
    for (const locale of Object.keys(this.supportedLocales)) {
      if (locale.startsWith(languageCode)) {
        return locale;
      }
    }

    return this.defaultLocale;
  }

  /**
   * Translate a key
   * @param {string} key - Translation key
   * @param {string} locale - Target locale
   * @param {Object} params - Parameters for interpolation
   * @returns {string} Translated string
   */
  translate(key, locale, params = {}) {
    const localeTranslations = this.translations[locale] || this.translations[this.defaultLocale];
    let translation = localeTranslations[key] || key;

    // Simple parameter interpolation
    for (const [param, value] of Object.entries(params)) {
      translation = translation.replace(`{${param}}`, value);
    }

    return translation;
  }

  /**
   * Translate CSV headers
   * @param {Array<string>} headers - Array of header keys
   * @param {string} locale - Target locale
   * @returns {Array<string>} Translated headers
   */
  translateCSVHeaders(headers, locale) {
    return headers.map(header => this.translate(header, locale));
  }

  /**
   * Translate enum value
   * @param {string} field - Field name
   * @param {string} value - Value to translate
   * @param {string} locale - Target locale
   * @returns {string} Translated value
   */
  translateEnumValue(field, value, locale) {
    const key = value.toLowerCase().replace(/\s+/g, '_');
    return this.translate(key, locale);
  }

  /**
   * Format date according to locale
   * @param {Date} date - Date to format
   * @param {string} locale - Target locale
   * @returns {string} Formatted date
   */
  formatDate(date, locale) {
    return new Intl.DateTimeFormat(locale).format(date);
  }

  /**
   * Format number according to locale
   * @param {number} num - Number to format
   * @param {string} locale - Target locale
   * @returns {string} Formatted number
   */
  formatNumber(num, locale) {
    return new Intl.NumberFormat(locale).format(num);
  }

  /**
   * Format currency according to locale
   * @param {number} amount - Amount to format
   * @param {string} locale - Target locale
   * @returns {string} Formatted currency
   */
  formatCurrency(amount, locale) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }
}

module.exports = I18NModule;
