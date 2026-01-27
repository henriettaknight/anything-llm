/**
 * 术语映射表
 * 基于实际检测结果自动提取的高频术语
 * 
 * 数据来源：分析了 31 个 CSV 文件，共 240 条检测记录
 * 生成时间：2026-01-26
 */

/**
 * 缺陷类别术语映射
 * 来源：实际检测结果中的 Category 字段
 */
export const CATEGORY_TERMS = {
  'MEMF': {
    zh: 'MEMF',
    en: 'Use After Free / Memory Fault',
    description: '内存释放后继续使用',
    frequency: 159
  },
  'AUTO': {
    zh: 'AUTO',
    en: 'Uninitialized Variable',
    description: '未初始化/未赋值使用',
    frequency: 55
  },
  'LEAK': {
    zh: 'LEAK',
    en: 'Memory/Resource Leak',
    description: '资源/内存泄漏',
    frequency: 10
  },
  'CLASS': {
    zh: 'CLASS',
    en: 'Class Design Flaw',
    description: '类设计缺陷',
    frequency: 3
  },
  'PERF': {
    zh: 'PERF',
    en: 'Performance Issue',
    description: '性能问题',
    frequency: 3
  },
  'DEPR': {
    zh: 'DEPR',
    en: 'Deprecated API Usage',
    description: '废弃API使用',
    frequency: 2
  },
  'OSRES': {
    zh: 'OSRES',
    en: 'OS Resource Management',
    description: '系统资源管理',
    frequency: 1
  },
  'ARRAY': {
    zh: 'ARRAY',
    en: 'Array Out of Bounds',
    description: '越界/无效访问',
    frequency: 1
  },
  'STL': {
    zh: 'STL',
    en: 'STL Container Misuse',
    description: 'STL容器误用',
    frequency: 0
  },
  'THREAD': {
    zh: 'THREAD',
    en: 'Thread Safety Issue',
    description: '线程安全问题',
    frequency: 0
  }
};

/**
 * 风险等级术语映射
 */
export const RISK_LEVELS = {
  '高': { zh: '高', en: 'High' },
  '中': { zh: '中', en: 'Medium' },
  '低': { zh: '低', en: 'Low' },
  'high': { zh: '高', en: 'High' },
  'medium': { zh: '中', en: 'Medium' },
  'low': { zh: '低', en: 'Low' },
  'High': { zh: '高', en: 'High' },
  'Medium': { zh: '中', en: 'Medium' },
  'Low': { zh: '低', en: 'Low' }
};

/**
 * 置信度术语映射
 */
export const CONFIDENCE_LEVELS = {
  '高': { zh: '高', en: 'High' },
  '中': { zh: '中', en: 'Medium' },
  '低': { zh: '低', en: 'Low' },
  'high': { zh: '高', en: 'High' },
  'medium': { zh: '中', en: 'Medium' },
  'low': { zh: '低', en: 'Low' },
  'High': { zh: '高', en: 'High' },
  'Medium': { zh: '中', en: 'Medium' },
  'Low': { zh: '低', en: 'Low' }
};

/**
 * 高频技术术语映射
 * 来源：从 240 条检测记录中提取，出现频率 >= 5 次
 * 按频率排序
 */
export const TECH_TERMS = {
  // Top 25 高频术语（出现 >= 5 次）
  '空指针解引用导致崩溃': { zh: '空指针解引用导致崩溃', en: 'null pointer dereference causing crash', frequency: 40 },
  '崩溃': { zh: '崩溃', en: 'crash', frequency: 39 },
  '返回': { zh: '返回', en: 'return', frequency: 35 },
  '运行时崩溃': { zh: '运行时崩溃', en: 'runtime crash', frequency: 33 },
  '空指针解引用': { zh: '空指针解引用', en: 'null pointer dereference', frequency: 28 },
  '时调用': { zh: '时调用', en: 'when calling', frequency: 27 },
  '未定义行为': { zh: '未定义行为', en: 'undefined behavior', frequency: 25 },
  '导致': { zh: '导致', en: 'cause / lead to', frequency: 22 },
  '传入': { zh: '传入', en: 'pass in', frequency: 18 },
  '可能崩溃': { zh: '可能崩溃', en: 'may crash', frequency: 12 },
  '可能因': { zh: '可能因', en: 'may due to', frequency: 12 },
  '进而崩溃': { zh: '进而崩溃', en: 'then crash', frequency: 11 },
  '调用': { zh: '调用', en: 'call', frequency: 10 },
  '随后在': { zh: '随后在', en: 'then at', frequency: 8 },
  '未初始化使用': { zh: '未初始化使用', en: 'uninitialized use', frequency: 8 },
  '而导致空指针解引用': { zh: '而导致空指针解引用', en: 'leading to null pointer dereference', frequency: 6 },
  '随后': { zh: '随后', en: 'then', frequency: 6 },
  '时触发': { zh: '时触发', en: 'when triggered', frequency: 5 },
  '可能导致空指针解引用': { zh: '可能导致空指针解引用', en: 'may cause null pointer dereference', frequency: 5 },
  '仍为': { zh: '仍为', en: 'still is', frequency: 5 },
  '致崩溃': { zh: '致崩溃', en: 'cause crash', frequency: 5 },
  '例如': { zh: '例如', en: 'for example', frequency: 5 },
  
  // 补充常用技术术语
  '空指针': { zh: '空指针', en: 'null pointer' },
  '未初始化': { zh: '未初始化', en: 'uninitialized' },
  '未初始化变量': { zh: '未初始化变量', en: 'uninitialized variable' },
  '内存泄漏': { zh: '内存泄漏', en: 'memory leak' },
  '资源泄漏': { zh: '资源泄漏', en: 'resource leak' },
  '数组越界': { zh: '数组越界', en: 'array out of bounds' },
  '缓冲区溢出': { zh: '缓冲区溢出', en: 'buffer overflow' },
  '悬空指针': { zh: '悬空指针', en: 'dangling pointer' },
  '野指针': { zh: '野指针', en: 'wild pointer' },
  '双重释放': { zh: '双重释放', en: 'double free' },
  '释放后使用': { zh: '释放后使用', en: 'use after free' },
  '整数溢出': { zh: '整数溢出', en: 'integer overflow' },
  '除零错误': { zh: '除零错误', en: 'division by zero' },
  '死锁': { zh: '死锁', en: 'deadlock' },
  '竞态条件': { zh: '竞态条件', en: 'race condition' },
  '线程安全': { zh: '线程安全', en: 'thread safe' },
  '互斥锁': { zh: '互斥锁', en: 'mutex' },
  '构造函数': { zh: '构造函数', en: 'constructor' },
  '析构函数': { zh: '析构函数', en: 'destructor' },
  '成员变量': { zh: '成员变量', en: 'member variable' },
  '成员函数': { zh: '成员函数', en: 'member function' },
  '虚函数': { zh: '虚函数', en: 'virtual function' },
  '智能指针': { zh: '智能指针', en: 'smart pointer' },
  '文件句柄': { zh: '文件句柄', en: 'file handle' },
  '套接字': { zh: '套接字', en: 'socket' },
  
  // Unreal Engine 术语
  '蓝图': { zh: '蓝图', en: 'Blueprint' },
  '组件': { zh: '组件', en: 'Component' },
  'Actor': { zh: 'Actor', en: 'Actor' },
  'Pawn': { zh: 'Pawn', en: 'Pawn' },
  'Widget': { zh: 'Widget', en: 'Widget' },
  'Controller': { zh: 'Controller', en: 'Controller' }
};

/**
 * 常用短语映射
 * 来源：从检测结果中提取的高频短语（出现 >= 3 次）
 */
export const COMMON_PHRASES = {
  // Top 43 常见短语
  '导致崩溃': { zh: '导致崩溃', en: 'cause crash', frequency: 44 },
  '未初始化使用': { zh: '未初始化使用', en: 'uninitialized use', frequency: 23 },
  '未定义行为': { zh: '未定义行为', en: 'undefined behavior', frequency: 23 },
  '导致未定义行': { zh: '导致未定义行', en: 'cause undefined', frequency: 9 },
  
  // 常用动词短语
  '如果': { zh: '如果', en: 'if' },
  '建议': { zh: '建议', en: 'recommend / suggest' },
  '修复': { zh: '修复', en: 'fix' },
  '检查': { zh: '检查', en: 'check' },
  '确保': { zh: '确保', en: 'ensure' },
  '避免': { zh: '避免', en: 'avoid' },
  '使用': { zh: '使用', en: 'use' },
  '可能导致': { zh: '可能导致', en: 'may cause' },
  '需要': { zh: '需要', en: 'need' },
  '应该': { zh: '应该', en: 'should' },
  '必须': { zh: '必须', en: 'must' },
  '可以': { zh: '可以', en: 'can' },
  '不能': { zh: '不能', en: 'cannot' },
  '正确': { zh: '正确', en: 'correct' },
  '错误': { zh: '错误', en: 'error' },
  '警告': { zh: '警告', en: 'warning' },
  '注意': { zh: '注意', en: 'note' },
  '重要': { zh: '重要', en: 'important' },
  '推荐': { zh: '推荐', en: 'recommended' },
  '可选': { zh: '可选', en: 'optional' },
  
  // 常用句式
  '在调用': { zh: '在调用', en: 'when calling' },
  '在使用': { zh: '在使用', en: 'when using' },
  '在访问': { zh: '在访问', en: 'when accessing' },
  '在初始化': { zh: '在初始化', en: 'when initializing' },
  '在释放': { zh: '在释放', en: 'when releasing' },
  '在分配': { zh: '在分配', en: 'when allocating' },
  '添加检查': { zh: '添加检查', en: 'add check' },
  '添加判断': { zh: '添加判断', en: 'add validation' },
  '添加保护': { zh: '添加保护', en: 'add protection' },
  '初始化为': { zh: '初始化为', en: 'initialize to' },
  '设置为': { zh: '设置为', en: 'set to' },
  '赋值为': { zh: '赋值为', en: 'assign to' }
};

/**
 * 获取所有映射表的统计信息
 */
export function getMappingStatistics() {
  return {
    categories: Object.keys(CATEGORY_TERMS).length,
    risks: Object.keys(RISK_LEVELS).length / 3, // 去重（中英文）
    confidence: Object.keys(CONFIDENCE_LEVELS).length / 3,
    techTerms: Object.keys(TECH_TERMS).length,
    commonPhrases: Object.keys(COMMON_PHRASES).length,
    total: Object.keys(CATEGORY_TERMS).length + 
           Object.keys(TECH_TERMS).length + 
           Object.keys(COMMON_PHRASES).length,
    dataSource: {
      csvFiles: 31,
      totalRecords: 240,
      extractedDate: '2026-01-26'
    }
  };
}

/**
 * 导出所有映射表（用于调试和分析）
 */
export const ALL_MAPPINGS = {
  categories: CATEGORY_TERMS,
  risks: RISK_LEVELS,
  confidence: CONFIDENCE_LEVELS,
  techTerms: TECH_TERMS,
  commonPhrases: COMMON_PHRASES
};
