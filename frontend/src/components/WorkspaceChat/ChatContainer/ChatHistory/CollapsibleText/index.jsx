import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { TRANSLATION_COLLAPSED_MAX_HEIGHT } from "@/utils/translation/constants";

/**
 * 长文本折叠容器。只在内容实际超出阈值时才显示折叠控件，
 * 短消息完全不受影响（无按钮、无遮罩、无高度限制）。
 *
 * @param {Object} props
 * @param {string} props.html - 已 sanitize 的 HTML（保持与原生一致的渲染方式）
 * @param {string} props.rawText - 原始文本，用于统计行数/字数
 * @param {boolean} [props.defaultExpanded=false] - 初始是否展开
 */
export default function CollapsibleText({
  html = "",
  rawText = "",
  defaultExpanded = false,
}) {
  const contentRef = useRef(null);
  const [isOverflow, setIsOverflow] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // overflow:hidden 下 scrollHeight 仍是完整内容高度，可安全测量
    const check = () =>
      setIsOverflow(el.scrollHeight > TRANSLATION_COLLAPSED_MAX_HEIGHT + 8);
    check();
    // 字体/主题加载后尺寸可能变化，用 ResizeObserver 兜底
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [html]);

  const collapsed = isOverflow && !expanded;
  const lineCount = rawText ? rawText.split("\n").length : 0;
  const charCount = rawText?.length || 0;

  return (
    <div className="relative w-full">
      <div
        ref={contentRef}
        className="overflow-hidden transition-[max-height] duration-200 ease-in-out"
        style={
          collapsed
            ? { maxHeight: `${TRANSLATION_COLLAPSED_MAX_HEIGHT}px` }
            : undefined
        }
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {collapsed && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-theme-bg-chat to-transparent" />
      )}
      {isOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1 flex items-center gap-x-1 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
        >
          {expanded ? (
            <>
              收起
              <CaretUp size={12} weight="bold" />
            </>
          ) : (
            <>
              展开全文（共 {lineCount} 行 / {charCount} 字）
              <CaretDown size={12} weight="bold" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
