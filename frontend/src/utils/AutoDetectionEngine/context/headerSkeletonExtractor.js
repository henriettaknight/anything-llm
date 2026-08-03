/**
 * @fileoverview Header Declaration Skeleton Extractor
 * 从 C/C++ 头文件中抽取"声明骨架"，供大文件分块检测时注入模型上下文，
 * 让模型看到成员变量的**真实类型**（如自研容器 TArrayPod），避免按 std:: 语义臆断
 * 而产生"成员函数不存在/类型不匹配"类 COMPILE 误报。
 *
 * 保留：namespace / class / struct 头与继承列表、成员变量声明、方法签名、
 *       typedef / using、enum（枚举体整体保留）。
 * 剔除：函数体（含内联实现）、注释、#include / #define / #pragma 等预处理指令。
 *
 * 设计要点：
 * - 纯函数、无 IO、无副作用，便于单测。
 * - 单遍线性扫描 + 括号深度跟踪，不做完整语法解析（O(n)，23KB 头文件耗时可忽略）。
 * - 不追求 100% 语法正确：目标只是让模型看清"某成员是什么类型"。
 * - 异常安全：内部 try/catch 兜底，任何异常均返回 ''，绝不抛给检测主流程。
 */

/** 骨架字符上限，超出后按优先级裁剪 */
export const MAX_SKELETON_CHARS = 6000;

/** 裁剪优先级：数值越小越优先保留 */
const PRIORITY = {
  /** namespace / class / struct 头、继承列表、闭合括号等结构行 */
  STRUCTURE: 0,
  /** 成员变量声明——对类型判断贡献最大 */
  FIELD: 1,
  /** typedef / using / enum */
  ALIAS: 2,
  /** 方法签名——对类型判断贡献最低，最先裁剪 */
  METHOD: 3
};

/** 结构行关键字 */
const RE_STRUCT_HEAD = /^\s*(template\s*<|namespace\b|class\b|struct\b|union\b)/;
/** 访问修饰符 */
const RE_ACCESS = /^\s*(public|protected|private)\s*:/;
/** typedef / using / enum */
const RE_ALIAS = /^\s*(typedef\b|using\b|enum\b)/;
/** 预处理指令 */
const RE_PREPROC = /^\s*#/;
/** 方法签名启发式：含有 `(` 且不像是变量初始化 */
const RE_METHODISH = /\(/;

/**
 * 剥离块注释与行注释，保留字符串/字符字面量内的内容不被误伤。
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inLine = false;
  let inBlock = false;
  let inStr = false;
  let inChar = false;

  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';

    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && c2 === '/') {
        inBlock = false;
        i += 2;
      } else {
        // 保留换行，维持行号结构与行切分正确
        if (c === '\n') out += c;
        i += 1;
      }
      continue;
    }
    if (inStr) {
      out += c;
      if (c === '\\' && c2) {
        out += c2;
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i += 1;
      continue;
    }
    if (inChar) {
      out += c;
      if (c === '\\' && c2) {
        out += c2;
        i += 2;
        continue;
      }
      if (c === "'") inChar = false;
      i += 1;
      continue;
    }

    if (c === '/' && c2 === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === "'") {
      inChar = true;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 统计一行中花括号的净深度变化（忽略字符串/字符字面量内的括号）。
 * @param {string} line
 * @returns {{delta: number, opens: number, closes: number}}
 */
function braceDelta(line) {
  let opens = 0;
  let closes = 0;
  let inStr = false;
  let inChar = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') {
        i += 1;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (inChar) {
      if (c === '\\') {
        i += 1;
      } else if (c === "'") {
        inChar = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "'") {
      inChar = true;
      continue;
    }
    if (c === '{') opens += 1;
    else if (c === '}') closes += 1;
  }
  return { delta: opens - closes, opens, closes };
}

/**
 * 统计一行中小括号的净深度变化（忽略字符串/字符字面量内的括号）。
 * @param {string} line
 * @returns {number}
 */
function parenDelta(line) {
  let d = 0;
  let inStr = false;
  let inChar = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') i += 1;
      else if (c === '"') inStr = false;
      continue;
    }
    if (inChar) {
      if (c === '\\') i += 1;
      else if (c === "'") inChar = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "'") { inChar = true; continue; }
    if (c === '(') d += 1;
    else if (c === ')') d -= 1;
  }
  return d;
}

/**
 * 把跨行的函数签名/模板声明合并成单个逻辑行，避免骨架里出现
 * `unsigned int param2, int& result);` 这类无主语的孤立片段。
 * 仅在小括号未闭合时续接，遇到预处理指令则中断合并（宏分支不参与）。
 * @param {string[]} lines
 * @returns {string[]}
 */
function joinContinuedSignatures(lines) {
  const out = [];
  let buf = null;
  let pending = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (buf === null) {
      if (RE_PREPROC.test(trimmed)) {
        out.push(raw);
        continue;
      }
      const d = parenDelta(trimmed);
      if (d > 0) {
        buf = trimmed;
        pending = d;
      } else {
        out.push(raw);
      }
      continue;
    }

    // 合并中：预处理指令不并入，直接冲刷缓冲
    if (RE_PREPROC.test(trimmed)) {
      out.push(buf);
      buf = null;
      pending = 0;
      out.push(raw);
      continue;
    }

    buf += (buf.endsWith('(') || trimmed.startsWith(')') ? '' : ' ') + trimmed;
    pending += parenDelta(trimmed);
    if (pending <= 0) {
      out.push(buf);
      buf = null;
      pending = 0;
    }
  }
  if (buf !== null) out.push(buf);
  return out;
}

/**
 * 判定一行的裁剪优先级。
 * @param {string} trimmed 已 trim 的行内容
 * @returns {number}
 */
function classifyLine(trimmed) {
  if (RE_STRUCT_HEAD.test(trimmed) || RE_ACCESS.test(trimmed) || trimmed === '}' || trimmed === '};') {
    return PRIORITY.STRUCTURE;
  }
  if (RE_ALIAS.test(trimmed)) return PRIORITY.ALIAS;
  if (RE_METHODISH.test(trimmed)) return PRIORITY.METHOD;
  return PRIORITY.FIELD;
}

/**
 * 从头文件内容中提取「声明骨架」。
 *
 * @param {string} headerContent 头文件全文
 * @param {{maxChars?: number}} [options] 可选项；maxChars 缺省为 MAX_SKELETON_CHARS
 * @returns {string} 骨架文本；内容为空、无有效声明或发生异常时返回 ''
 */
export function extractHeaderSkeleton(headerContent, options) {
  try {
    if (!headerContent || typeof headerContent !== 'string') return '';
    const maxChars = options && Number.isFinite(options.maxChars) && options.maxChars > 0
      ? options.maxChars
      : MAX_SKELETON_CHARS;

    const src = stripComments(headerContent);
    const lines = joinContinuedSignatures(src.split('\n'));

    /** @type {Array<{text: string, priority: number}>} */
    const kept = [];

    let depth = 0;
    /** 进入函数体时记录的"体外深度"；为 null 表示当前不在函数体内 */
    let bodySkipDepth = null;
    /** enum 体内：整体保留 */
    let enumDepth = null;
    /** 处理反斜杠续行的预处理指令 */
    let inPreprocContinuation = false;
    /**
     * 上一行是否是「尚未遇到 `{` 的 class/struct/namespace/enum 头」。
     * 用于处理 `class Gui: public IVisBase` 与 `{` 分处两行（常见于 #ifdef 分支声明）的写法，
     * 否则那个独立的 `{` 会被误判成内联函数体，导致整个类被跳过。
     */
    let pendingScopeHead = null; // null | 'struct' | 'enum'

    for (let idx = 0; idx < lines.length; idx += 1) {
      const raw = lines[idx];
      const trimmed = raw.trim();

      // --- 预处理指令：整条跳过（含反斜杠续行） ---
      if (inPreprocContinuation) {
        inPreprocContinuation = trimmed.endsWith('\\');
        continue;
      }
      if (RE_PREPROC.test(trimmed)) {
        inPreprocContinuation = trimmed.endsWith('\\');
        continue;
      }

      const { delta } = braceDelta(raw);

      // --- 已在被跳过的函数体内 ---
      if (bodySkipDepth !== null) {
        const after = depth + delta;
        depth = after;
        if (after <= bodySkipDepth) {
          bodySkipDepth = null; // 函数体结束
        }
        continue;
      }

      // --- enum 体内：整体保留 ---
      if (enumDepth !== null) {
        const after = depth + delta;
        if (trimmed) kept.push({ text: trimmed, priority: PRIORITY.ALIAS });
        depth = after;
        if (after <= enumDepth) enumDepth = null;
        continue;
      }

      if (!trimmed) continue;

      const isEnum = /^\s*(typedef\s+)?enum\b/.test(trimmed);
      const isStructHead = RE_STRUCT_HEAD.test(trimmed);
      const priority = classifyLine(trimmed);

      if (delta > 0) {
        // 本行打开了一个作用域。
        // 若上一行是「悬挂的 class/struct/enum 头」，则本行的 `{` 属于那个类型作用域，
        // 而不是内联函数体。
        const scopeKind = pendingScopeHead || (isEnum ? 'enum' : (isStructHead ? 'struct' : null));
        pendingScopeHead = null;

        if (scopeKind === 'enum') {
          // 枚举：保留整体（本行若还带内容也一并保留）
          if (trimmed !== '{') kept.push({ text: trimmed, priority: PRIORITY.ALIAS });
          enumDepth = depth;
          depth += delta;
          continue;
        }

        if (scopeKind === 'struct') {
          // class / struct / namespace：保留头部，继续深入类体
          if (trimmed !== '{') kept.push({ text: trimmed, priority: PRIORITY.STRUCTURE });
          depth += delta;
          continue;
        }

        // 其余打开作用域的行视为「内联函数体」：保留签名，丢弃函数体
        const signature = trimmed.replace(/\s*\{.*$/, '').trim();
        if (signature) {
          kept.push({ text: `${signature};`, priority: RE_METHODISH.test(signature) ? PRIORITY.METHOD : priority });
        }
        bodySkipDepth = depth;
        depth += delta;
        continue;
      }

      if (delta < 0) {
        pendingScopeHead = null;
        depth += delta;
        if (depth < 0) depth = 0;
        // 作用域闭合行（如 `};`）保留，维持结构可读
        kept.push({ text: trimmed, priority: PRIORITY.STRUCTURE });
        continue;
      }

      // --- delta === 0 ---
      // 「class Foo : public Bar」这类**未以分号结尾**的类型头，其 `{` 在下一行。
      // 标记为悬挂头，供下一行判定使用（前向声明 `class IControl;` 以分号结尾，不算）。
      if ((isStructHead || isEnum) && !trimmed.endsWith(';')) {
        pendingScopeHead = isEnum ? 'enum' : 'struct';
        // 补上开括号，保持骨架的嵌套结构可读（原文中 `{` 在下一行）
        kept.push({ text: `${trimmed} {`, priority: PRIORITY.STRUCTURE });
        continue;
      }
      pendingScopeHead = null;

      // 单行内联实现（花括号在同一行内闭合，delta 为 0），如 `int f() { return 1; }`
      // 或 `virtual void Foo() {}`：只保留签名，丢弃函数体。
      // 注意排除聚合初始化 `int a[] = {1,2};` —— 其 `{` 前有 `=`。
      const braceAt = trimmed.indexOf('{');
      if (braceAt > 0 && !isStructHead && !isEnum && RE_METHODISH.test(trimmed.slice(0, braceAt))
          && !/=\s*$/.test(trimmed.slice(0, braceAt).trim())) {
        const signature = trimmed.slice(0, braceAt).trim();
        if (signature) {
          kept.push({ text: `${signature};`, priority: PRIORITY.METHOD });
          continue;
        }
      }

      // 深度不变的普通声明行
      kept.push({ text: trimmed, priority });
    }

    if (kept.length === 0) return '';

    return renderWithBudget(kept, maxChars);
  } catch {
    // 提取失败静默降级为「无骨架」，绝不影响检测主流程
    return '';
  }
}

/**
 * 按体积预算渲染骨架：超限时按优先级由低到高（METHOD → ALIAS → FIELD）裁剪，
 * 结构行始终保留，并在末尾追加省略标记，避免模型误以为类定义已完整。
 * @param {Array<{text: string, priority: number}>} kept
 * @param {number} maxChars
 * @returns {string}
 */
function renderWithBudget(kept, maxChars) {
  const render = (items) => items.map((it) => it.text).join('\n');

  const full = render(kept);
  if (full.length <= maxChars) return full;

  const NOTE = '\n// ...（声明骨架因体积上限已省略部分低优先级声明）';
  const budget = Math.max(0, maxChars - NOTE.length);

  // 逐级裁剪：优先丢弃优先级最低的类别；同一类别内**从后往前**逐条丢弃，
  // 尽量多保留该类别的前部内容，而不是整类一次性丢光。
  const dropOrder = [PRIORITY.METHOD, PRIORITY.ALIAS, PRIORITY.FIELD];
  const items = kept.slice();
  let size = full.length;

  for (const p of dropOrder) {
    for (let i = items.length - 1; i >= 0 && size > budget; i -= 1) {
      if (items[i] && items[i].priority === p) {
        size -= items[i].text.length + 1; // +1 为换行符
        items[i] = null;
      }
    }
    if (size <= budget) break;
  }

  const remained = items.filter(Boolean);
  let body = render(remained);

  // 极端情况（结构行本身就超预算）：硬截断到预算内最后一个完整行
  if (body.length > budget) {
    const sliced = body.slice(0, budget);
    const lastNewline = sliced.lastIndexOf('\n');
    body = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
  }
  return `${body}${NOTE}`;
}

/**
 * 扫描整文件，生成「文件级结构骨架」：列出所有 namespace / class / struct / union / enum 的
 * 头部绝对行号及其 `{` 开、`}` 闭的绝对行号范围。
 *
 * 用途（方案 4）：超大 .h 自身分块时，每一块只看到局部，模型看不到「这个类定义从哪行到哪行」「当前块属于哪个类」。
 * 注入该结构骨架后，跨多块的同一个类定义能被模型正确关联，避免类尾部/下一成员被误判为孤立声明。
 *
 * 与 {@link extractHeaderSkeleton}（声明骨架，关注成员类型）不同：本结构骨架**只关心作用域范围**，
 * 不关心内部成员细节，体积很小（O(行数) 单遍扫描），即使 2 万行文件也仅几百行摘要。
 *
 * @param {string} fileContent 整文件内容
 * @returns {{summary: string, ranges: Array<{kind:string,name:string,headLine:number,openLine:number,closeLine:number}>, lines: Array<{line:number,scope:string}>}}
 */
export function buildFileStructureSkeleton(fileContent) {
  const lines = String(fileContent ?? '').split('\n');
  const total = lines.length;
  const ranges = [];
  const scopeAtLine = new Array(total + 1).fill(''); // 1-based：某行所处的"最内层类/命名空间"名称

  // 栈：记录正在解析的作用域 { kind, name, headLine, openLine }
  const stack = [];
  // 待匹配开括号的悬挂头（class X : public Y 与 { 分处两行时）
  let pendingHead = null; // { kind, name, headLine }
  // 嵌套深度：{ 增 1，} 减 1。仅当深度从 >0 回到 0 时才关闭当前栈顶作用域，
  // 这样内联函数体 { ... } 不会误把外层 class 当成闭合（修复 #ifdef 分支同名类场景）。
  let depth = 0;
  let inBlockComment = false;
  let inString = false;

  const RE_HEAD = /^\s*(template\s*<[^>]*>\s*)?(namespace|class|struct|union|enum)\b\s+([A-Za-z_]\w*)/;

  for (let i = 0; i < total; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    // 轻量预处理：剥离注释与字符串，避免 // } 误判
    let processed = '';
    let j = 0;
    const n = raw.length;
    while (j < n) {
      const c = raw[j];
      const c2 = j + 1 < n ? raw[j + 1] : '';
      if (inBlockComment) {
        if (c === '*' && c2 === '/') { inBlockComment = false; j += 2; continue; }
        j += 1; continue;
      }
      if (inString) {
        if (c === '\\') { j += 2; continue; }
        if (c === '"') inString = false;
        j += 1; continue;
      }
      if (c === '/' && c2 === '/') break; // 行注释，余下忽略
      if (c === '/' && c2 === '*') { inBlockComment = true; j += 2; continue; }
      if (c === '"') { inString = true; j += 1; continue; }
      processed += c;
      j += 1;
    }

    // 记录当前行所处的内层作用域名（在深度变化前，本行仍属于上一状态）
    scopeAtLine[lineNo] = stack.length ? stack[stack.length - 1].name : '';

    // 统计本行花括号净变化
    let opens = 0, closes = 0;
    for (const ch of processed) {
      if (ch === '{') opens += 1;
      else if (ch === '}') closes += 1;
    }

    const head = processed.match(RE_HEAD);
    const trimmed = processed.trim();

    // 无条件累计嵌套深度（无论是否 head/pendingHead）：{ 增 1，} 减 1。
    // 普通函数体 { } 也计入，确保内联函数不会误关外层 class。
    depth += opens - closes;

    // 处理悬挂头的开括号：遇到 { 且 pendingHead 存在 → 入栈（#ifdef 分支同名类后者覆盖前者，最终只一个）
    if (pendingHead && opens > 0) {
      const openLine = lineNo;
      ranges.push({ kind: pendingHead.kind, name: pendingHead.name, headLine: pendingHead.headLine, openLine, closeLine: 0 });
      stack.push({ ...pendingHead, openLine });
      pendingHead = null;
    }

    if (head) {
      const kind = head[2];
      const name = head[3];
      if (opens > 0) {
        // 同行带 {：直接入栈
        ranges.push({ kind, name, headLine: lineNo, openLine: lineNo, closeLine: 0 });
        stack.push({ kind, name, headLine: lineNo, openLine: lineNo });
      } else if (!trimmed.endsWith(';')) {
        // 悬挂头：{ 在下一行（前向声明以 ; 结尾，不算）
        pendingHead = { kind, name, headLine: lineNo };
      }
      // 前向声明 class X; 忽略
    }

    // 处理闭合括号：只有深度回到 0 时才关闭栈顶作用域
    if (closes > 0 && depth <= 0) {
      depth = 0;
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const rec = ranges.find(r => r.headLine === top.headLine && r.openLine === top.openLine && r.closeLine === 0);
        if (rec) rec.closeLine = lineNo;
        stack.pop();
      }
    }
  }

  // 生成摘要文本（仅列出有有效范围的作用域）
  const valid = ranges.filter(r => r.closeLine > 0 && r.closeLine >= r.openLine);
  const summaryLines = valid.map(r => `${r.kind} ${r.name}：第 ${r.headLine} 行定义，${r.openLine === r.headLine ? '本行' : `第 ${r.openLine} 行`} 起体，第 ${r.closeLine} 行结束`);
  const summary = summaryLines.length
    ? `文件结构范围（绝对行号）：\n${summaryLines.join('\n')}`
    : '文件结构范围（绝对行号）：未识别到命名空间/类/结构体作用域。';

  return { summary, ranges: valid, lines: scopeAtLine.map((scope, idx) => ({ line: idx, scope })) };
}

/**
 * 给定分块 [startLine, endLine]，返回该块「主要所处的类/命名空间」名称（取覆盖最多的内层作用域）。
 * @param {Array<{line:number,scope:string}>} lineScopes buildFileStructureSkeleton 的输出 .lines
 * @param {number} startLine 分块起始绝对行号（1-based）
 * @param {number} endLine 分块结束绝对行号（1-based）
 * @returns {string}
 */
export function locateScopeForChunk(lineScopes, startLine, endLine) {
  const counts = {};
  for (let ln = startLine; ln <= endLine && ln < lineScopes.length; ln += 1) {
    const s = lineScopes[ln] && lineScopes[ln].scope;
    if (s) counts[s] = (counts[s] || 0) + 1;
  }
  let best = '';
  let bestN = 0;
  for (const [scope, cnt] of Object.entries(counts)) {
    if (cnt > bestN) { bestN = cnt; best = scope; }
  }
  return best;
}
