/**
 * Auto Detection Page
 * Main page for automatic code defect detection
 */

import React from "react";
import Sidebar from "@/components/Sidebar";
import AutoDetectionContainer from "@/components/AutoDetection/Container";
import useUser from "@/hooks/useUser";

export default function AutoDetection() {
  const { user } = useUser();
  const isMobile = window.innerWidth < 768;

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      {!isMobile && <Sidebar />}
      <AutoDetectionContainer />
    </div>
  );
}
