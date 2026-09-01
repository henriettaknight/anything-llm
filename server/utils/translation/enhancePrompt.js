// server/utils/translation/enhancePrompt.js
//
// 翻译的**检索增强**：把术语抽取与翻译记忆检索的结果拼进用户消息。
//
// 这里是翻译唯一的自定义环节。LLM 调用、流式、落库、协议适配全部交给原生的
// streamChatWithWorkspace，因此翻译自动获得：
//   - provider 自动适配（workspace.chatProvider / 系统 LLM_PROVIDER）
//   - 思考开关（按 translation 场景解析，默认关闭）
//   - 统一 token 统计与用量落库
//   - 统一的历史/线程/改名行为
//
// 术语抽取（Python）或翻译记忆检索（RAGFlow）失败时**不阻断翻译**，
// 退化为"直接翻译原文"，只丢失术语约束与记忆参考。

const { extractTerms } = require("./pythonBridge");
const { retrieval } = require("./ragflowClient");
const { buildTranslationPrompt } = require("./promptBuilder");
const { listGlossaries } = require("./glossaryManager");

/**
 * 生成增强后的用户消息与翻译元信息。
 * @param {string} sourceText - 待译原文
 * @param {string[]} [glossaryIds=["default"]] - 术语库 ID 数组，靠后覆盖靠前
 * @returns {Promise<{prompt: string, translationMeta: Object|null}>}
 */
async function enhanceTranslationPrompt(sourceText, glossaryIds = ["default"]) {
  const ids =
    Array.isArray(glossaryIds) && glossaryIds.length > 0
      ? glossaryIds
      : ["default"];

  let termsResult = {
    glossary: "",
    hits: [],
    glossary_used: ids,
    all_terms: [],
  };
  try {
    termsResult = await extractTerms(sourceText, ids);
  } catch (err) {
    console.error("[translation] extractTerms failed:", err?.message || err);
  }

  let chunks = [];
  try {
    const datasetId = process.env.RAGFLOW_DATASET_ID || "";
    chunks = await retrieval(sourceText, datasetId ? [datasetId] : [], 5);
  } catch (err) {
    console.error("[translation] retrieval failed:", err?.message || err);
  }

  const prompt = buildTranslationPrompt({
    glossaryText: termsResult.glossary,
    chunks,
    sourceText,
  });

  const glossaries = listGlossaries() || [];
  const usedIds = Array.isArray(termsResult.glossary_used)
    ? termsResult.glossary_used
    : ids;
  const glossaryNames = usedIds.map((gid) => {
    const matched = glossaries.find((g) => g.id === gid);
    return matched?.name || gid;
  });

  return {
    prompt,
    translationMeta: {
      glossaryIds: usedIds,
      glossaryNames,
      hitCount: termsResult.hits?.length || 0,
      retrievalCount: chunks?.length || 0,
      terms: termsResult.hits || [],
      chunks: chunks || [],
      allTerms: Array.isArray(termsResult.all_terms)
        ? termsResult.all_terms
        : [],
    },
  };
}

module.exports = { enhanceTranslationPrompt };
