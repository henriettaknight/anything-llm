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
const {
  buildTranslationUserPrompt,
  buildTranslationSystemAddendum,
} = require("./promptBuilder");
const { listGlossaries } = require("./glossaryManager");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");

/**
 * 收集「待译原文」。
 *
 * ⚠️ 原文有两个来源：
 *   1. 用户在输入框手打的文字（message）
 *   2. 用户以附件形式上传的文件（parsed files，正文落在 [CONTEXT n] 里）
 *
 * 术语抽取与翻译记忆检索**必须**基于两者合并后的全文：
 * 只取 message 时，一旦原文全在附件里（输入框只留一句「翻译」），
 * 抽取输入就是一句指令，命中数必然为 0。
 *
 * 注意：这里只用于「检索增强」的入参，**不会**拼接进 user message
 * （user message 仍严格等于用户原文，见 buildTranslationUserPrompt）。
 *
 * @param {string} message - 用户在输入框提交的原文
 * @param {{workspace?: Object, thread?: Object|null, user?: Object|null}} [ctx]
 * @returns {Promise<{text: string, attachmentCount: number}>}
 */
async function collectSourceText(message, ctx = {}) {
  const { workspace = null, thread = null, user = null } = ctx;
  const parts = [];
  if (typeof message === "string" && message.trim()) parts.push(message.trim());

  let attachmentCount = 0;
  try {
    if (workspace?.id) {
      const files = await WorkspaceParsedFiles.getContextFiles(
        workspace,
        thread || null,
        user || null
      );
      for (const file of files || []) {
        if (!file?.pageContent) continue;
        parts.push(file.pageContent);
        attachmentCount++;
      }
    }
  } catch (err) {
    // 附件读取失败不阻断翻译，退化为只用 message 检索（行为与修复前一致）。
    console.error(
      "[translation] collectSourceText failed:",
      err?.message || err
    );
  }

  return { text: parts.join("\n\n"), attachmentCount };
}

/**
 * 生成翻译所需的 user message、system 追加段与翻译元信息。
 *
 * 职责划分：
 *   - prompt          → 提交给大模型的 user message，**仅用户原文**，无任何拼接
 *   - systemAddendum  → 追加到 system prompt 尾部的术语表 / 翻译记忆
 *                       （按原文动态抽取，不能写死进 workspace.openAiPrompt）
 *   - translationMeta → 术语命中数等元信息，随 metrics 回传前端并落库
 *
 * @param {string} sourceText - 用户在输入框提交的原文（待译原文可能还在附件里）
 * @param {string[]} [glossaryIds=["default"]] - 术语库 ID 数组，靠后覆盖靠前
 * @param {{workspace?: Object, thread?: Object|null, user?: Object|null}} [ctx] -
 *        用于读取本次会话挂载的附件全文（原文以附件形式上传时必需）
 * @returns {Promise<{prompt: string, systemAddendum: string, translationMeta: Object|null}>}
 */
async function enhanceTranslationPrompt(
  sourceText,
  glossaryIds = ["default"],
  ctx = {}
) {
  const ids =
    Array.isArray(glossaryIds) && glossaryIds.length > 0
      ? glossaryIds
      : ["default"];

  // 检索用的原文 = 输入框文字 + 附件全文；
  // 提交给模型的 user message 仍只是输入框文字（见下方 buildTranslationUserPrompt）。
  const { text: retrievalText, attachmentCount } = await collectSourceText(
    sourceText,
    ctx
  );

  let termsResult = {
    glossary: "",
    hits: [],
    glossary_used: ids,
    all_terms: [],
  };
  try {
    termsResult = await extractTerms(retrievalText, ids);
  } catch (err) {
    console.error("[translation] extractTerms failed:", err?.message || err);
  }

  let chunks = [];
  try {
    const datasetId = process.env.RAGFLOW_DATASET_ID || "";
    chunks = await retrieval(retrievalText, datasetId ? [datasetId] : [], 5);
  } catch (err) {
    console.error("[translation] retrieval failed:", err?.message || err);
  }

  const prompt = buildTranslationUserPrompt({ sourceText });
  const systemAddendum = buildTranslationSystemAddendum({
    glossaryText: termsResult.glossary,
    chunks,
    attachmentCount,
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
    systemAddendum,
    translationMeta: {
      glossaryIds: usedIds,
      glossaryNames,
      hitCount: termsResult.hits?.length || 0,
      retrievalCount: chunks?.length || 0,
      // 待译原文里附件的份数：>0 表示原文来自 [CONTEXT n] 而非输入框。
      attachmentCount,
      terms: termsResult.hits || [],
      chunks: chunks || [],
      allTerms: Array.isArray(termsResult.all_terms)
        ? termsResult.all_terms
        : [],
    },
  };
}

module.exports = { enhanceTranslationPrompt, collectSourceText };
