import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import paths from "@/utils/paths";
import { Tooltip } from "react-tooltip";

export default function ApplicationsMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleAutoDetectionClick = () => {
    navigate(paths.autodetection?.home?.() || "/auto-detection");
  };

  return (
    <div className="flex flex-col gap-y-2">
      <button
        onClick={handleAutoDetectionClick}
        className="flex items-center gap-x-2 px-3 py-2 rounded-lg text-theme-text-secondary hover:bg-theme-bg-secondary transition-all duration-200 w-full text-left text-sm border-2 border-theme-sidebar-border"
      >
        <div className="flex-shrink-0 w-4 h-4 rounded bg-theme-accent-primary ml-0"></div>
        <span className="truncate">{t("autodetection.title", "Auto Detection")}</span>
      </button>
    </div>
  );
}
