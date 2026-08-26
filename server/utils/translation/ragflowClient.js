// server/utils/translation/ragflowClient.js
//
// RAGFlow 检索客户端。从 validate_ragflow_demo.py 的 RagflowClient.retrieval() 搬迁。
// 只保留 retrieval（POST /api/v1/retrieval），其他游戏剧透逻辑（filter_chunks/is_discovered
// /check_leak）不搬。
//
// 失败降级：网络/鉴权/解析任意一步失败都返回空数组，不阻塞翻译主流程。

const DEFAULT_TOP_K = 5;

/**
 * RAGFlow 检索
 * @param {string} question - 检索 query（一般是待译原文整段）
 * @param {string[]} datasetIds - 数据集 ID 列表
 * @param {number} [topK=5] - 返回前 N 条最相似片段
 * @returns {Promise<Array<{content: string, score: number, source: string}>>}
 */
async function retrieval(question, datasetIds, topK = DEFAULT_TOP_K) {
  const baseUrl = (process.env.RAGFLOW_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.RAGFLOW_API_KEY || "";

  if (!baseUrl || !apiKey || !Array.isArray(datasetIds) || datasetIds.length === 0) {
    return [];
  }
  if (!question || !question.trim()) return [];

  try {
    const resp = await fetch(`${baseUrl}/api/v1/retrieval`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        dataset_ids: datasetIds,
        top_k: topK,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      console.error(
        `[translation.ragflowClient] retrieval failed: HTTP ${resp.status} ${resp.statusText}`
      );
      return [];
    }

    const data = await resp.json();
    const chunks =
      (data?.data?.chunks && Array.isArray(data.data.chunks) && data.data.chunks) ||
      (Array.isArray(data?.data) ? data.data : []);

    // 标准化字段：RAGFlow 不同版本字段名略有差异
    return chunks
      .map((c) => ({
        content: c.content || c.text || "",
        score:
          typeof c.similarity === "number"
            ? c.similarity
            : typeof c.score === "number"
              ? c.score
              : 0,
        source: c.document_name || c.doc_name || c.document_keyword || "(unknown)",
      }))
      .filter((c) => c.content);
  } catch (err) {
    console.error("[translation.ragflowClient] retrieval error:", err?.message || err);
    return [];
  }
}

/**
 * 拼装 RAGFlow 检索片段为 prompt 段落
 * @param {Array<{content: string, score: number, source: string}>} chunks
 * @returns {string} 空数组时返回空字符串
 */
function formatChunksForPrompt(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return "";
  const lines = chunks.map(
    (c, i) => `[片段${i + 1}]\n${c.content}`
  );
  return lines.join("\n\n");
}

module.exports = { retrieval, formatChunksForPrompt };
