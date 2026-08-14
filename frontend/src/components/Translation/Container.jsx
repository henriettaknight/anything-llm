/**
 * Translation Container
 * 中间栏：顶部词库下拉 + 消息流 + 输入框
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { listGlossaries, streamTranslate } from "@/models/translation";

export default function TranslationContainer({
  onTerms,
  onChunks,
  onTranslatingChange,
}) {
  const [glossaries, setGlossaries] = useState([]);
  const [glossaryId, setGlossaryId] = useState("default");
  const [sourceText, setSourceText] = useState("");
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [translating, setTranslating] = useState(false);
  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    listGlossaries()
      .then((data) => {
        setGlossaries(data.glossaries || []);
        if (data.defaultId) setGlossaryId(data.defaultId);
      })
      .catch((e) => console.error("listGlossaries failed:", e));
  }, []);

  useEffect(() => {
    onTranslatingChange?.(translating);
  }, [translating, onTranslatingChange]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = sourceText.trim();
    if (!text || translating) return;

    // 把用户消息加入流
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSourceText("");
    setTranslating(true);

    // 给 AI 预留一条空消息，流式追加
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    let assistantBuf = "";

    await streamTranslate({
      sourceText: text,
      glossaryId,
      onTerms: (hits) => onTerms?.(hits),
      onChunks: (hits) => onChunks?.(hits),
      onToken: (token) => {
        assistantBuf += token;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: assistantBuf };
          return next;
        });
      },
      onDone: () => setTranslating(false),
      onError: (err) => {
        console.error("translate error:", err);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = {
              role: "assistant",
              content: `⚠️ 翻译失败：${err.message}`,
            };
          }
          return next;
        });
        setTranslating(false);
      },
    });
  }, [sourceText, translating, glossaryId, onTerms, onChunks]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-theme-bg-primary">
      {/* 顶部词库选择条 */}
      <div className="px-4 py-3 border-b border-theme-sidebar-border flex items-center gap-3 bg-theme-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-theme-text-primary">
            🌐 智能翻译
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-theme-text-secondary">词库:</label>
          <select
            value={glossaryId}
            onChange={(e) => setGlossaryId(e.target.value)}
            disabled={translating}
            className="px-2 py-1 text-sm rounded border border-theme-sidebar-border bg-theme-bg-primary text-theme-text-primary"
          >
            {glossaries.length === 0 && <option value="default">默认</option>}
            {glossaries.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}（{g.termCount} 条）
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-theme-text-secondary">
            <h2 className="text-xl font-semibold mb-2 text-theme-text-primary">
              智能翻译
            </h2>
            <p className="text-sm">输入中文原文，自动注入术语 + RAGFlow 检索</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words text-sm ${
                m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-theme-bg-secondary text-theme-text-primary border border-theme-sidebar-border"
              }`}
            >
              {m.content || (m.role === "assistant" && translating ? "…" : "")}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t border-theme-sidebar-border p-3 bg-theme-bg-secondary">
        <div className="flex items-end gap-2">
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="输入要翻译的中文原文，回车发送（Shift+Enter 换行）..."
            rows={2}
            disabled={translating}
            className="flex-1 px-3 py-2 text-sm rounded border border-theme-sidebar-border bg-theme-bg-primary text-theme-text-primary resize-none focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSend}
            disabled={translating || !sourceText.trim()}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {translating ? "翻译中..." : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
