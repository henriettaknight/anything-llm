// FTS 精灵：调试面板（服务端 FTS_SPRITE_DEBUG=true 时才会收到数据）。
// 展示工作流中间结果；数据只存在于当前页面内存中，不落库，刷新后消失。
// 支持一键复制全部调试信息（含最终回答）或单个分段，方便贴到工单 / 对话中排查。
import { useState } from "react";
import { CaretDown, CaretRight, Bug, Copy, Check } from "@phosphor-icons/react";
import useCopyText from "@/hooks/useCopyText";
import showToast from "@/utils/toast";

const SECTIONS = [
  ["question", "玩家问题"],
  ["intent", "意图识别（Intent Resolver）"],
  ["route", "路由"],
  ["decision_context", "决策上下文（Option Selection）"],
  ["knowledge_context", "知识路由（Knowledge Lore Router）"],
  ["lore_queries", "Lore 检索 Query"],
  ["lore_hits", "Lore 检索结果"],
  ["lore_context", "LORE KNOWLEDGE"],
  ["response_context", "RESPONSE CONTEXT"],
  ["meta", "耗时与告警"],
];

function format(value) {
  if (typeof value === "string") return value || "（空）";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 拼成便于粘贴阅读的纯文本（Markdown 风格） */
function buildCopyText(debug, answer) {
  const route = debug.route || debug.meta?.route || "-";
  const total = debug.meta?.timings_ms?.total;
  const lines = [
    "# FTS精灵调试信息",
    `路由: ${route}${typeof total === "number" ? ` | 工作流耗时: ${total}ms` : ""}`,
    `复制时间: ${new Date().toLocaleString()}`,
    "",
  ];
  for (const [key, title] of SECTIONS) {
    if (debug[key] === undefined) continue;
    const isText = typeof debug[key] === "string";
    lines.push(`## ${title}`, isText ? "" : "```json", format(debug[key]), isText ? "" : "```", "");
  }
  if (answer) lines.push("## 最终回答", "", answer, "");
  return lines.join("\n");
}

function CopyButton({ getText, label, title }) {
  const { copyText, copied } = useCopyText();
  const onClick = async (e) => {
    e.stopPropagation();
    const ok = await copyText(getText());
    if (!ok) showToast("复制失败，请手动选择文本复制", "error", { clear: true });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || "复制"}
      className="flex items-center gap-x-1 text-xs text-theme-text-secondary hover:text-theme-text-primary shrink-0"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {label && <span>{copied ? "已复制" : label}</span>}
    </button>
  );
}

function Section({ title, value }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-theme-sidebar-border first:border-t-0">
      <div className="flex items-center gap-x-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-x-1 flex-1 text-left py-1 text-xs text-theme-text-secondary hover:text-theme-text-primary"
        >
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
          {title}
        </button>
        <CopyButton getText={() => format(value)} title={`复制「${title}」`} />
      </div>
      {open && (
        <pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto p-2 mb-1 rounded bg-theme-bg-secondary text-theme-text-primary">
          {format(value)}
        </pre>
      )}
    </div>
  );
}

export default function FtsSpriteDebugPanel({ debug, answer = "" }) {
  const [open, setOpen] = useState(false);
  if (!debug || typeof debug !== "object") return null;

  const route = debug.route || debug.meta?.route || "-";
  const total = debug.meta?.timings_ms?.total;
  const warnings = debug.meta?.warnings?.length || 0;
  const sections = SECTIONS.filter(([key]) => debug[key] !== undefined);

  return (
    <div className="w-full mb-3 rounded-lg border border-dashed border-theme-sidebar-border px-3 py-2">
      <div className="flex items-center gap-x-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-x-2 flex-1 min-w-0 text-left text-xs text-theme-text-secondary hover:text-theme-text-primary"
        >
          <Bug size={14} className="shrink-0" />
          <span className="truncate">
            精灵调试信息 · 路由 {route}
            {typeof total === "number" ? ` · 工作流 ${total}ms` : ""}
            {warnings ? ` · ${warnings} 条告警` : ""}
          </span>
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
        </button>
        <CopyButton
          getText={() => buildCopyText(debug, answer)}
          label="复制调试信息"
          title="复制全部调试信息（含最终回答）"
        />
      </div>
      {open && (
        <div className="mt-2">
          {sections.map(([key, title]) => (
            <Section key={key} title={title} value={debug[key]} />
          ))}
        </div>
      )}
    </div>
  );
}
