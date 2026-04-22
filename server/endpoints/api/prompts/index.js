const { Router } = require("express");
const { readFileSync, statSync } = require("fs");
const { join } = require("path");

/**
 * GET /api/prompts/ue-static-defect?type=ue_cpp|ue_blueprint
 * Get the UE5 static defect detection prompt template
 */
function apiPromptsEndpoints(router) {
  if (!router) return;

  router.get("/prompts/ue-static-defect", (req, res) => {
    try {
      // Get project type from query parameter, default to 'ue_cpp'
      const projectType = req.query.type || 'ue_cpp';
      
      // Validate project type
      if (!['ue_cpp', 'ue_blueprint'].includes(projectType)) {
        return res.status(400).json({
          error: "Invalid project type",
          message: "Project type must be 'ue_cpp' or 'ue_blueprint'",
          received: projectType,
        });
      }

      // Determine prompt file name based on project type
      const promptFileName = projectType === 'ue_blueprint' 
        ? 'ue5_blueprint_prompt.md' 
        : 'ue5_cpp_prompt.md';

      console.log(`📝 Loading prompt for project type: ${projectType} (${promptFileName})`);

      // Try multiple possible paths for the prompt file
      const possiblePaths = [
        join(__dirname, `../../../../frontend/src/utils/AutoDetectionEngine/prompts/${promptFileName}`),
        join(process.cwd(), `../frontend/src/utils/AutoDetectionEngine/prompts/${promptFileName}`),
        join(process.cwd(), `frontend/src/utils/AutoDetectionEngine/prompts/${promptFileName}`),
      ];

      let promptContent = null;
      let successPath = null;
      let promptMtime = null;

      for (const filePath of possiblePaths) {
        try {
          promptContent = readFileSync(filePath, "utf-8");
          successPath = filePath;
          promptMtime = statSync(filePath).mtime.toISOString();
          console.log("✓ Successfully loaded prompt from:", filePath);
          break;
        } catch (err) {
          console.log("✗ Failed to load from:", filePath);
          continue;
        }
      }

      if (!promptContent) {
        console.error(`❌ Failed to load ${promptFileName} from any path`);
        return res.status(500).json({
          error: "Failed to load prompt template",
          projectType: projectType,
          fileName: promptFileName,
          triedPaths: possiblePaths,
          cwd: process.cwd(),
        });
      }

      console.log(`✓ Prompt file size: ${promptContent.length} bytes`);
      console.log(`✓ Project type: ${projectType}`);
      if (promptMtime) {
        console.log(`✓ Prompt mtime: ${promptMtime}`);
      }

      return res
        .status(200)
        .set({
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "no-store, max-age=0",
          "X-Prompt-Path": successPath || "",
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
