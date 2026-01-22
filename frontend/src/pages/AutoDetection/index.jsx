/**
 * Auto Detection Page
 * Main page for automatic code defect detection
 */

import React from "react";
import Sidebar from "@/components/Sidebar";
import AutoDetectionContainer from "@/components/AutoDetection/Container";
import DebugPanel from "@/components/AutoDetection/DebugPanel";
import DirectModeTest from "@/components/AutoDetection/DirectModeTest";
import useUser from "@/hooks/useUser";

export default function AutoDetection() {
  const { user } = useUser();
  const isMobile = window.innerWidth < 768;

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      {!isMobile && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        {process.env.NODE_ENV === 'development' && (
          <div className="p-4 border-b border-theme-sidebar-border">
            <DirectModeTest />
          </div>
        )}
        <div className="flex-1 overflow-auto">
          <AutoDetectionContainer />
        </div>
      </div>
      {process.env.NODE_ENV === 'development' && <DebugPanel />}
    </div>
  );
}
