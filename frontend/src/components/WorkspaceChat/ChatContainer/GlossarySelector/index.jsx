// frontend/src/components/WorkspaceChat/ChatContainer/GlossarySelector/index.jsx
//
// 术语库选择条（注入到翻译 workspace 的 ChatContainer 顶部）。
//
// 功能：
//   - 列出 /translation/glossaries 返回的可用术语库
//   - 受控组件：受控于父组件的 glossaryId
//   - onChange 时回调父组件，父组件把 glossaryId 透传到 stream-chat 请求体

import { useEffect, useState } from "react";
import { listGlossaries } from "@/models/translation";

export default function GlossarySelector({ value, onChange }) {
  const [glossaries, setGlossaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listGlossaries();
        if (cancelled) return;
        const items = Array.isArray(list?.glossaries) ? list.glossaries : [];
        setGlossaries(items);
        if (!value && items.length > 0 && items[0]?.id) {
          onChange(items[0].id);
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

  if (loading) {
    return (
      <div className="text-xs text-theme-text-secondary px-3 py-2">
        加载术语库…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-500 px-3 py-2">术语库加载失败: {error}</div>
    );
  }

  if (glossaries.length === 0) {
    return (
      <div className="text-xs text-theme-text-secondary px-3 py-2">
        未配置术语库
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-theme-bg-chat-input rounded-lg border border-theme-border">
      <span className="text-xs text-theme-text-secondary shrink-0">
        术语库
      </span>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-transparent text-sm text-theme-text-primary border-0 outline-none cursor-pointer"
      >
        {glossaries.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name || g.id}
          </option>
        ))}
      </select>
    </div>
  );
}
