/**
 * Right Panel
 * 右侧栏：Tab 切换 术语命中 / RAGFlow 检索
 */

import React, { useState, useMemo } from "react";

export default function RightPanel({ terms, chunks, translating }) {
  const [tab, setTab] = useState("terms");

  return (
    <div className="flex flex-col h-full">
      {/* Tab 头 */}
      <div className="flex border-b border-theme-sidebar-border">
        <button
          onClick={() => setTab("terms")}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "terms"
              ? "bg-theme-bg-primary text-theme-text-primary border-b-2 border-blue-500"
              : "text-theme-text-secondary hover:text-theme-text-primary"
          }`}
        >
          术语命中 ({terms.length})
        </button>
        <button
          onClick={() => setTab("chunks")}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "chunks"
              ? "bg-theme-bg-primary text-theme-text-primary border-b-2 border-blue-500"
              : "text-theme-text-secondary hover:text-theme-text-primary"
          }`}
        >
          RAGFlow 检索 ({chunks.length})
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === "terms" ? (
          <TermsView terms={terms} translating={translating} />
        ) : (
          <ChunksView chunks={chunks} translating={translating} />
        )}
      </div>
    </div>
  );
}

function TermsView({ terms, translating }) {
  const groups = useMemo(() => {
    const g = { m: [], p: [], r: [] };
    (terms || []).forEach((t) => {
      const bucket = g[t.lv] || g.p;
      bucket.push(t);
    });
    return g;
  }, [terms]);

  if (!terms || terms.length === 0) {
    return (
      <EmptyHint
        translating={translating}
        emptyText="暂无术语命中"
        loadingText="正在抽取术语..."
      />
    );
  }

  const titles = {
    m: "必须遵守 (m)",
    p: "优先使用 (p)",
    r: "参考 (r)",
  };

  return (
    <>
      {["m", "p", "r"].map((lv) => {
        if (!groups[lv].length) return null;
        return (
          <div key={lv} className="mb-3">
            <div className="text-xs font-semibold text-theme-text-secondary mb-1">
              {titles[lv]} · {groups[lv].length} 条
            </div>
            {groups[lv].map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-theme-bg-primary border border-theme-sidebar-border mb-1"
              >
                <span className="text-theme-text-primary">{t.zh}</span>
                <span className="text-theme-text-secondary">→</span>
                <span className="text-theme-text-primary flex-1">{t.en}</span>
                <span
                  className={`px-1 rounded text-[10px] ${
                    lv === "m"
                      ? "bg-red-500/20 text-red-400"
                      : lv === "p"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {lv.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function ChunksView({ chunks, translating }) {
  if (!chunks || chunks.length === 0) {
    return (
      <EmptyHint
        translating={translating}
        emptyText="暂无检索片段"
        loadingText="正在检索 RAGFlow..."
      />
    );
  }
  return (
    <>
      {chunks.map((c, i) => (
        <div
          key={i}
          className="text-xs p-2 rounded bg-theme-bg-primary border border-theme-sidebar-border"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-theme-text-secondary">
              score: {c.score?.toFixed(2) ?? "-"}
            </span>
            <span className="text-theme-text-secondary truncate ml-2">
              📄 {c.source}
            </span>
          </div>
          <div className="text-theme-text-primary whitespace-pre-wrap break-words">
            {c.content}
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyHint({ translating, emptyText, loadingText }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-theme-text-secondary text-xs">
      {translating ? loadingText : emptyText}
    </div>
  );
}
