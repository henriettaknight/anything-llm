/**
 * @fileoverview 机制校验层（误报治理第 4 层，确定性程序化过滤）
 *
 * 与 Prompt 硬规则（第 1 层）互补：第 1 层依赖模型遵守率（实证 ~40% 违规），
 * 本层是确定性代码，不受模型遵守率影响。核心两条：
 *   A. COMPILE 兜底：本项目当前可正常构建，凡主张"编译失败/编译错误/无法编译"的
 *      COMPILE 缺陷一律降级为 P3 并标记"待人工验证"（残留转为标记明确的存疑项）。
 *   B. 事实库联动降级：主张基于 UE 已知合法写法（TWeakObjectPtr 支持 operator->、
 *      UPROPERTY 支持定长数组、return void 表达式合法、UENUM+namespace 标准写法等）
 *      的缺陷，confidence 最高只能标 Medium。
 *
 * 纯函数，不依赖其他模块（仅复用 normalizeRiskLevel），便于 Node 单测直接抽取。
 */

import { normalizeRiskLevel } from './riskLevel.js';

/**
 * COMPILE 兜底：命中以下字样即视为"主张项目无法编译"，强制降级。
 * 严格限定为"编译失败/编译错误/无法编译"类表述，避免误杀真实类型错误。
 */
const COMPILE_BLOCK_PATTERNS = [
  /编译失败/,
  /编译错误/,
  /无法编译/,
  /编译不通过/,
  /不能编译/,
];

/**
 * 事实库已知合法写法：命中且 confidence 为 High 时联动降级为 Medium。
 */
const KNOWN_LEGIT_PATTERNS = [
  /TWeakObjectPtr/,
  /弱引用/,
  /UPROPERTY/,
  /定长数组/,
  /return\s+void/,
  /UENUM/,
];

/** 收集缺陷文本（多字段拼接），用于模式匹配 */
function collectDefectText(defect) {
  return [
    defect.risk,
    defect.howToTrigger,
    defect.suggestedFix,
    defect.description,
    defect.title,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 对单个缺陷做机制校验与降级。
 * 直接修改并返回同一对象（mutate），调用方无需重新赋值。
 * @param {Object} defect
 * @returns {Object} 同一个 defect（可能已被降级/标记）
 */
export function applyMechanismValidation(defect) {
  if (!defect || typeof defect !== 'object') return defect;

  const text = collectDefectText(defect);
  const category = String(defect.category || '').toUpperCase();
  const currentLevel = normalizeRiskLevel(defect.riskLevel);
  const conf = String(defect.confidence || '').toLowerCase();

  let note = defect.mechanismNote || '';
  const appendNote = (msg) => {
    note = note ? `${note}；${msg}` : msg;
  };

  // A. COMPILE 兜底：项目可构建是确定性事实
  if (category === 'COMPILE' && COMPILE_BLOCK_PATTERNS.some((re) => re.test(text))) {
    // 仅当原等级高于 P3（或为空）才降级，避免重复标记已为 P3/Info 的项
    if (currentLevel === '' || ['P0', 'P1', 'P2'].includes(currentLevel)) {
      defect.riskLevel = normalizeRiskLevel('P3');
    }
    appendNote('COMPILE 兜底：项目可正常构建，需人工验证');
  }

  // B. 事实库联动降级
  if (KNOWN_LEGIT_PATTERNS.some((re) => re.test(text)) && conf === 'high') {
    defect.confidence = 'Medium';
    appendNote('事实库校验：主张基于 UE 合法写法，置信度降级为 Medium');
  }

  if (note) defect.mechanismNote = note;
  return defect;
}

export default applyMechanismValidation;
