// server/utils/translation/pythonBridge.js
//
// spawn Python 子进程调 wrapper，从 stdin 传 JSON，从 stdout 解析 JSON。
//
// 失败降级：返回 { glossary: "", term_total: 0, hits: [] }，
// 让翻译流程在没有术语约束的情况下也能继续走。

const { spawn } = require("node:child_process");
const path = require("node:path");

const WRAPPER_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "python",
  "translation",
  "extract_terms_wrapper.py"
);

// Dockerfile 装的是 python3-pip（只暴露 python3 命令），本地 dev 通常同时有 python/python3。
// 默认 python3 兼容容器环境；如本机 python3 不存在，可通过 TRANSLATION_PYTHON_BIN 覆盖。
const PYTHON_BIN = process.env.TRANSLATION_PYTHON_BIN || "python3";

/**
 * 抽取术语
 * @param {string} sourceText 待译中文原文
 * @returns {Promise<{glossary: string, term_total: number, mandatory_count: number, preferred_count: number, hits: Array<{zh: string, en: string, lv: string, forbidden: string[]}>}>}
 */
function extractTerms(sourceText) {
  const empty = {
    glossary: "",
    term_total: 0,
    mandatory_count: 0,
    preferred_count: 0,
    hits: [],
  };

  if (!sourceText || !sourceText.trim()) {
    return Promise.resolve(empty);
  }

  const payload = JSON.stringify({ source_text: sourceText });

  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [WRAPPER_PATH], {
      cwd: path.dirname(WRAPPER_PATH),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", (err) => {
      console.error(
        "[translation.pythonBridge] spawn failed:",
        err?.message || err
      );
      resolve(empty);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(
          `[translation.pythonBridge] python exit ${code}: ${stderr || "(no stderr)"}`
        );
        resolve(empty);
        return;
      }
      try {
        const out = JSON.parse(stdout);
        resolve(out);
      } catch (e) {
        console.error(
          "[translation.pythonBridge] parse stdout failed:",
          e?.message || e,
          "raw:",
          stdout.slice(0, 200)
        );
        resolve(empty);
      }
    });

    // 给 stdin 写入 UTF-8 字节（不加 BOM）
    try {
      child.stdin.write(Buffer.from(payload, "utf-8"));
      child.stdin.end();
    } catch (e) {
      console.error(
        "[translation.pythonBridge] stdin write failed:",
        e?.message || e
      );
      // 不立即 resolve，等 close 事件兜底
    }
  });
}

module.exports = { extractTerms };
