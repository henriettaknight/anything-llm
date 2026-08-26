// server/utils/translation/glossaryManager.js
//
// 词库管理：
// - 扫描 server/storage/glossaries/*.jsonl
// - 每行格式 {"src": "灵力", "tgt": "Spiritual Power", "type": "mandatory"}
// - 永远把 Python 脚本内置词库作为 default 项返回
//
// 失败/目录不存在时降级返回仅 default。

const fs = require("fs");
const path = require("path");

const GLOSSARY_DIR = path.resolve(__dirname, "../../storage/glossaries");

// Python 脚本内置术语条数（与 ragflow_code_组件_术语抽取.py 的 _GLOSSARY 一致）
const BUILTIN_TERM_COUNT = 968;

function safeId(name) {
  return name
    .toLowerCase()
    .replace(/\.jsonl$/i, "")
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let count = 0;
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        JSON.parse(trimmed);
        count++;
      } catch (_) {
        // 跳过非 JSON 行（注释等）
      }
    }
    return count;
  } catch (_) {
    return 0;
  }
}

function listGlossaries() {
  const result = [
    {
      id: "default",
      name: "仙侠小说术语库 v1（内置）",
      termCount: BUILTIN_TERM_COUNT,
      source: "ragflow_code_组件_术语抽取.py",
      builtin: true,
    },
  ];

  try {
    if (!fs.existsSync(GLOSSARY_DIR)) {
      return result;
    }
    const entries = fs.readdirSync(GLOSSARY_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile() || !/\.jsonl$/i.test(ent.name)) continue;
      const fullPath = path.join(GLOSSARY_DIR, ent.name);
      const id = safeId(ent.name);
      if (result.some((g) => g.id === id)) continue; // 去重
      const termCount = countLines(fullPath);
      if (termCount === 0) continue;
      result.push({
        id,
        name: ent.name.replace(/\.jsonl$/i, ""),
        termCount,
        source: fullPath,
        builtin: false,
      });
    }
  } catch (err) {
    console.error("[glossaryManager] listGlossaries failed:", err.message);
  }

  return result;
}

module.exports = { listGlossaries, GLOSSARY_DIR };
