// frontend/src/components/WorkspaceChat/ChatContainer/GlossarySelector/index.jsx
//
// 术语库多选下拉（翻译 workspace 用）
//
// 功能：
//   - 列出 /translation/glossaries 返回的可用术语库
//   - checkbox 多选，受控于父组件的 glossaryIds（string[]）
//   - 点击外面收起下拉
//   - 选中顺序 = 优先级，靠后覆盖靠前
//     UI 上按列表顺序勾选；不做拖拽排序（避免复杂度）
//   - 默认勾选 ["default"]

import { useEffect, useState, useRef } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { listGlossaries } from "@/models/translation";

export default function GlossarySelector({ value = [], onChange }) {
  const [glossaries, setGlossaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // 加载词库列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listGlossaries();
        if (cancelled) return;
        const items = Array.isArray(list?.glossaries) ? list.glossaries : [];
        setGlossaries(items);
        // 默认勾选 default（如果 value 为空）
        if ((!value || value.length === 0) && items.length > 0 && items[0]?.id) {
          onChange([items[0].id]);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "load glossaries failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点击外面收起
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id) => {
    if (!id) return;
    if (value.includes(id)) {
      // 不能取消最后一个（至少保留一个）
      if (value.length <= 1) return;
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const selectedNames = glossaries
    .filter((g) => value.includes(g.id))
    .map((g) => g.name || g.id);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-x-2 px-3 py-1.5 rounded-md border border-theme-border bg-theme-bg-chat-input text-xs text-theme-text-primary hover:bg-theme-bg-secondary transition-colors"
      >
        <span className="text-theme-text-secondary">术语库：</span>
        <span className="truncate max-w-[280px]">
          {selectedNames.length > 0 ? selectedNames.join("、") : "未选择"}
        </span>
        <CaretDown size={12} className="text-theme-text-secondary" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[260px] max-w-[360px] bg-theme-bg-secondary border border-theme-border rounded-md shadow-xl max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-xs text-theme-text-secondary">
              加载中...
            </div>
          )}
          {error && (
            <div className="px-3 py-2 text-xs text-red-500">{error}</div>
          )}
          {!loading && !error && glossaries.length === 0 && (
            <div className="px-3 py-2 text-xs text-theme-text-secondary">
              暂无词库
            </div>
          )}
          {!loading && !error && glossaries.length > 0 && (
            <ul className="py-1">
              {glossaries.map((g) => {
                const checked = value.includes(g.id);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => toggle(g.id)}
                      className="w-full flex items-center gap-x-2 px-3 py-2 text-left hover:bg-theme-bg-chat-input transition-colors"
                    >
                      <span
                        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                          checked
                            ? "bg-theme-action-bg border-theme-action-bg"
                            : "border-theme-border"
                        }`}
                      >
                        {checked && <Check size={12} className="text-white" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <div className="text-xs text-theme-text-primary truncate">
                          {g.name}
                        </div>
                        <div className="text-[10px] text-theme-text-secondary">
                          {g.termCount} 条
                          {g.builtin ? " · 内置" : ""}
                        </div>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {value.length > 0 && (
            <div className="border-t border-theme-border px-3 py-1.5 text-[10px] text-theme-text-secondary">
              顺序：{value.join(" → ")}（靠后覆盖靠前）
            </div>
          )}
        </div>
      )}
    </div>
  );
}
