const { Router } = require("express");
const { readFileSync } = require("fs");
const { join } = require("path");

/**
 * GET /api/prompts/ue-static-defect
 * Get the UE5 C++ static defect detection prompt template
 */
function apiPromptsEndpoints(router) {
  if (!router) return;

  router.get("/prompts/ue-static-defect", (req, res) => {
    try {
      // Try multiple possible paths for the prompt file
      const possiblePaths = [
        join(__dirname, "../../../../frontend/src/utils/AutoDetectionEngine/prompts/ue5_cpp_prompt.md"),
        join(process.cwd(), "../frontend/src/utils/AutoDetectionEngine/prompts/ue5_cpp_prompt.md"),
        join(process.cwd(), "frontend/src/utils/AutoDetectionEngine/prompts/ue5_cpp_prompt.md"),
      ];

      let promptContent = null;
      let successPath = null;

      for (const filePath of possiblePaths) {
        try {
          promptContent = readFileSync(filePath, "utf-8");
          successPath = filePath;
          console.log("✓ Successfully loaded prompt from:", filePath);
          break;
        } catch (err) {
          console.log("✗ Failed to load from:", filePath);
          continue;
        }
      }

      if (!promptContent) {
        console.error("❌ Failed to load prompt from any path");
        return res.status(500).json({
          error: "Failed to load prompt template",
          triedPaths: possiblePaths,
          cwd: process.cwd(),
        });
      }

      console.log("✓ Prompt file size:", promptContent.length, "bytes");

      return res
        .status(200)
        .set({
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
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
