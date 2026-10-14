// FTS 精灵：工作流进度文字（意图识别 / 检索 / 组织回答…），只在等待回答时显示。
export default function FtsSpriteStatusLine({ text }) {
  if (!text) return null;
  return (
    <span className="mt-1 text-sm text-theme-text-secondary animate-pulse">
      {text}
    </span>
  );
}
