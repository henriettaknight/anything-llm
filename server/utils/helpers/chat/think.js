// server/utils/helpers/chat/think.js
//
// Ollama 思考模式（thinking）开关。
//
// 背景：
//   gemma4-31b 默认开启思考，会先生成数百 token 的思维链再输出正文。
//   实测（192.168.6.101, num_ctx=8192）：同一句短翻译，开启思考 8.33s / 350 token，
//   关闭后 0.50s / 16 token —— 输出 token 减少 95%，端到端提速约 16 倍。
//
// 生效范围（重要）：
//   Ollama 的 /v1 兼容接口**不识别** think 字段（实测无效），只有原生 /api/chat 的
//   顶层 think 才有效。因此本开关只在两条走原生协议的路径上生效：
//     1. AiProviders/ollama（对话 + server 模式代码检测）
//     2. endpoints/directAiProxy（direct 模式代码检测）
//   非 Ollama provider（openai/azure/...）收到 think 会直接忽略，无副作用。
//
// 优先级：场景专项 > 全局兜底。
//   OLLAMA_THINK              全局兜底，默认 true
//   OLLAMA_THINK_TRANSLATION  翻译，默认 false（短任务，思考 token 远超译文本身）
//   OLLAMA_THINK_CODEREVIEW   代码检测，默认 true（思维链有助于推理缺陷，
//                             改动前需先用 gui.h 等样本做 A/B 验证召回率）

/** 场景 → 专项环境变量名 */
const THINK_ENV_BY_SCENE = {
  translation: "OLLAMA_THINK_TRANSLATION",
  codereview: "OLLAMA_THINK_CODEREVIEW",
};

/**
 * 每个场景的**内置默认值**。
 * 翻译是短任务，思考 token 数远超译文本身，默认关闭；
 * 代码检测与对话保持开启（思维链有助推理缺陷；改动前需用 gui.h 样本做 A/B 验证）。
 */
const SCENE_DEFAULTS = {
  translation: false,
  codereview: true,
  chat: true,
};

/**
 * 宽松解析布尔值，无法识别时返回 fallback。
 * @param {string|boolean|number|null|undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * 解析当前场景是否开启思考。
 * 优先级：场景专项 env > 场景内置默认 > 全局 OLLAMA_THINK 兜底。
 * @param {"chat"|"translation"|"codereview"} [scene="chat"] - 调用场景
 * @returns {boolean}
 */
function resolveThink(scene = "chat") {
  const sceneEnv = THINK_ENV_BY_SCENE[scene];
  const sceneDefault =
    SCENE_DEFAULTS[scene] ?? toBool(process.env.OLLAMA_THINK, true);
  if (sceneEnv && process.env[sceneEnv] !== undefined) {
    // 场景变量存在但取值无法识别时，回退到该场景的内置默认
    return toBool(process.env[sceneEnv], sceneDefault);
  }
  return sceneDefault;
}

module.exports = { resolveThink, toBool };
