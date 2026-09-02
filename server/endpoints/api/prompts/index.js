const { Router } = require("express");
const { readFileSync, statSync } = require("fs");
const { join } = require("path");

/**
 * GET /api/prompts/ue-static-defect?type=ue_cpp|ue_blueprint|cpp|ts|ts_famegame
 * Get the static defect detection prompt template for the given project type.
 *
 * For TypeScript projects the prompt is composed of multiple files
 * (a generic kernel + per-project context + optional category packages)
 * concatenated in order. See doc/TS项目检测接入方案.md §3.13.
 */
function apiPromptsEndpoints(router) {
  if (!router) return;

  // 每个 type → 多个 prompt 文件（按顺序拼接，用分隔注释隔开）
  const PROMPT_FILES = {
    ue_cpp:       ['ue5_cpp_prompt.md'],
    ue_blueprint: ['ue5_blueprint_prompt.md'],
    cpp:          ['cpp_prompt.md'],
    ts:           ['ts_prompt.md'],
    ts_famegame:  ['ts_prompt.md', 'ts_contexts/famegame.md', 'ts_contexts/_tauri.md'],
  };

  router.get("/prompts/ue-static-defect", (req, res) => {
    try {
      // Get project type from query parameter, default to 'ue_cpp'
      const projectType = req.query.type || 'ue_cpp';
      const files = PROMPT_FILES[projectType];

      if (!files) {
        return res.status(400).json({
          error: "Invalid project type",
          message: "Project type must be one of: " + Object.keys(PROMPT_FILES).join(', '),
          received: projectType,
        });
      }

      // Try multiple possible base directories for the prompts folder
      const possibleBaseDirs = [
        join(__dirname, `../../../../frontend/src/utils/AutoDetectionEngine/prompts`),
        join(process.cwd(), `../frontend/src/utils/AutoDetectionEngine/prompts`),
        join(process.cwd(), `frontend/src/utils/AutoDetectionEngine/prompts`),
      ];

      const parts = [];
      let successBaseDir = null;
      let promptMtime = null;
      for (const fileName of files) {
        let loaded = false;
        for (const baseDir of possibleBaseDirs) {
          try {
            const p = join(baseDir, fileName);
            const content = readFileSync(p, "utf-8");
            parts.push(`<!-- ===== ${fileName} ===== -->\n\n${content}`);
            if (!successBaseDir) successBaseDir = baseDir;
            if (!promptMtime) promptMtime = statSync(p).mtime.toISOString();
            console.log("✓ Successfully loaded prompt from:", p);
            loaded = true;
            break;
          } catch (err) {
            // try next base dir
            continue;
          }
        }
        if (!loaded) {
          console.error(`❌ Failed to load ${fileName} from any path`);
          return res.status(500).json({
            error: "Failed to load prompt template",
            fileName: fileName,
            triedPaths: possibleBaseDirs,
            cwd: process.cwd(),
          });
        }
      }

      const promptContent = parts.join("\n\n");
      console.log(`✓ Prompt composed size: ${promptContent.length} bytes`);
      console.log(`✓ Project type: ${projectType} (composed of ${files.length} file(s))`);

      return res
        .status(200)
        .set({
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "no-store, max-age=0",
          "X-Prompt-Path": successBaseDir || "",
          "X-Prompt-Mtime": promptMtime || "",
        })
        .send(promptContent);
    } catch (error) {
      console.error("❌ Error reading prompt file:", error);
      return res.status(500).json({
        error: "Error reading prompt file",
        details: error.message,
      });
    }
  });
}

module.exports = { apiPromptsEndpoints };
