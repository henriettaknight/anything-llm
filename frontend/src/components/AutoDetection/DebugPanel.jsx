import React, { useState, useEffect } from 'react';

/**
 * Debug Panel for Direct AI Mode Testing
 * Shows current AI mode configuration and status
 */
export default function DebugPanel() {
  const [aiModeInfo, setAiModeInfo] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDebugInfo = async () => {
      try {
        // Get AI mode info
        const { getAIModeInfo } = await import('@/utils/AutoDetectionEngine/config/aiModeConfig.js');
        const modeInfo = getAIModeInfo();
        setAiModeInfo(modeInfo);

        // Get engine status
        const AutoDetectionEngine = (await import('@/utils/AutoDetectionEngine/index.js')).default;
        const engine = new AutoDetectionEngine();
        await engine.initialize();
        
        setEngineStatus({
          initialized: engine.initialized,
          hasLogging: !!engine.logging,
          hasMonitoring: !!engine.monitoring,
          hasOrchestrator: !!engine.orchestrator
        });
      } catch (error) {
        console.error('Error loading debug info:', error);
        setAiModeInfo({ error: error.message });
      } finally {
        setLoading(false);
      }
    };

    loadDebugInfo();
  }, []);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading debug info...</div>;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white p-4 rounded-lg shadow-lg text-xs max-w-sm z-50 font-mono">
      <div className="mb-3 pb-3 border-b border-gray-700">
        <h3 className="font-bold text-yellow-400 mb-2">🔧 Direct AI Mode Debug</h3>
      </div>

      {/* AI Mode Info */}
      <div className="mb-3">
        <div className="text-gray-300 mb-1">AI Mode Configuration:</div>
        {aiModeInfo?.error ? (
          <div className="text-red-400">{aiModeInfo.error}</div>
        ) : (
          <div className="space-y-1">
            <div className="text-gray-200">
              Mode: <span className={aiModeInfo?.mode === 'direct' ? 'text-green-400 font-bold' : 'text-blue-400'}>
                {aiModeInfo?.mode}
              </span>
            </div>
            <div className="text-gray-200">Dev: <span className="text-cyan-400">{String(aiModeInfo?.isDevelopment)}</span></div>
            <div className="text-gray-200">Prod: <span className="text-cyan-400">{String(aiModeInfo?.isProduction)}</span></div>
            {aiModeInfo?.mode === 'direct' && aiModeInfo?.config && (
              <>
                <div className="text-gray-200">URL: <span className="text-cyan-400 break-all">{aiModeInfo?.config?.url}</span></div>
                <div className="text-gray-200">Model: <span className="text-cyan-400">{aiModeInfo?.config?.model}</span></div>
              </>
            )}
            {aiModeInfo?.mode === 'llm' && aiModeInfo?.config && (
              <div className="text-gray-200">Workspace: <span className="text-cyan-400">{aiModeInfo?.config?.workspace}</span></div>
            )}
          </div>
        )}
      </div>

      {/* Engine Status */}
      {engineStatus && (
        <div className="mb-3 pb-3 border-t border-gray-700 pt-3">
          <div className="text-gray-300 mb-1">Engine Status:</div>
          <div className="space-y-1">
            <div className="text-gray-200">
              Initialized: <span className={engineStatus.initialized ? 'text-green-400' : 'text-red-400'}>
                {String(engineStatus.initialized)}
              </span>
            </div>
            <div className="text-gray-200">
              Logging: <span className={engineStatus.hasLogging ? 'text-green-400' : 'text-red-400'}>
                {String(engineStatus.hasLogging)}
              </span>
            </div>
            <div className="text-gray-200">
              Monitoring: <span className={engineStatus.hasMonitoring ? 'text-green-400' : 'text-red-400'}>
                {String(engineStatus.hasMonitoring)}
              </span>
            </div>
            <div className="text-gray-200">
              Orchestrator: <span className={engineStatus.hasOrchestrator ? 'text-green-400' : 'text-red-400'}>
                {String(engineStatus.hasOrchestrator)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Status Indicator */}
      <div className="pt-3 border-t border-gray-700">
        {aiModeInfo?.mode === 'direct' ? (
          <div className="text-green-400 font-bold">✓ Direct Mode Active</div>
        ) : (
          <div className="text-blue-400 font-bold">→ LLM Mode Active</div>
        )}
      </div>
    </div>
  );
}
