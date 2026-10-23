import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import FtsSprite from "@/models/fts_sprite";

// FTS 精灵导航入口开关（构建时注入，默认隐藏）。
// 隐藏后精灵功能不受影响：后端按 workspace 名称「FTS精灵」或 slug「fts_sprite」识别，
// 管理员手动创建该 workspace 并添加成员即可使用。
// 开启：VITE_FTS_SPRITE_NAV_ENABLED=true（开启后，入口会自动创建 workspace 并为用户授权）
const FTS_SPRITE_NAV_ENABLED =
  import.meta.env.VITE_FTS_SPRITE_NAV_ENABLED === "true";

const MENU_BUTTON_CLS =
  "flex items-center gap-x-2 px-3 py-2 rounded-lg text-theme-text-secondary hover:bg-theme-bg-secondary transition-all duration-200 w-full text-left text-sm border-2 border-theme-sidebar-border";

export default function ApplicationsMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [enteringSprite, setEnteringSprite] = useState(false);

  const handleAutoDetectionClick = () => {
    navigate(paths.autodetection?.home?.() || "/auto-detection");
  };

  // FTS 精灵：workspace 不存在时管理员自动创建，普通用户提示联系管理员
  const handleFtsSpriteClick = async () => {
    if (enteringSprite) return;
    setEnteringSprite(true);
    const { slug, error, message } = await FtsSprite.ensureWorkspace();
    setEnteringSprite(false);
    if (error || !slug) {
      showToast(message || "精灵暂时无法进入，请稍后再试", "warning", { clear: true });
      return;
    }
    navigate(paths.workspace.chat(slug));
  };

  return (
    <div className="flex flex-col gap-y-2">
      <button onClick={handleAutoDetectionClick} className={MENU_BUTTON_CLS}>
        <div className="flex-shrink-0 w-4 h-4 rounded bg-theme-accent-primary ml-0"></div>
        <span className="truncate">{t("autodetection.title", "Auto Detection")}</span>
      </button>
      {FTS_SPRITE_NAV_ENABLED && (
        <button
          onClick={handleFtsSpriteClick}
          disabled={enteringSprite}
          className={`${MENU_BUTTON_CLS} disabled:opacity-60 disabled:cursor-wait`}
        >
          <div className="flex-shrink-0 w-4 h-4 rounded-full bg-theme-accent-primary ml-0"></div>
          <span className="truncate">{t("ftsSprite.title", "FTS精灵")}</span>
        </button>
      )}
    </div>
  );
}
