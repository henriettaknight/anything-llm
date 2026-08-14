/**
 * Smart Translation Page
 * 三栏布局：左 Sidebar / 中 翻译对话 / 右 术语+检索
 */

import React, { useState, useCallback, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import UserButton from "@/components/UserMenu/UserButton";
import TranslationContainer from "@/components/Translation/Container";
import RightPanel from "@/components/Translation/RightPanel";
import useUser from "@/hooks/useUser";

export default function Translation() {
  const { user } = useUser();
  const isMobile = window.innerWidth < 768;
  const [terms, setTerms] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [translating, setTranslating] = useState(false);

  // 通过 ref 把 RightPanel 的状态更新能力暴露给 Container
  const rightPanelRef = useRef(null);

  const onTerms = useCallback((hits) => setTerms(hits), []);
  const onChunks = useCallback((hits) => setChunks(hits), []);
  const onTranslatingChange = useCallback((v) => setTranslating(v), []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      {!isMobile && <Sidebar />}
      {/* 用户按钮浮在 Sidebar logo 行右侧（仅翻译页，替代全局右上角浮窗） */}
      <UserButton className="absolute top-[14px] left-[210px] z-50" />

      <div className="flex-1 flex overflow-hidden">
        <TranslationContainer
          onTerms={onTerms}
          onChunks={onChunks}
          onTranslatingChange={onTranslatingChange}
        />
        {!isMobile && (
            <div className="w-[340px] border-l border-theme-sidebar-border bg-theme-bg-secondary overflow-hidden flex flex-col">
            <RightPanel
              terms={terms}
              chunks={chunks}
              translating={translating}
            />
          </div>
        )}
      </div>
    </div>
  );
}
