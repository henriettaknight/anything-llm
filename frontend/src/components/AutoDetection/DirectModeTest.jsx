import React, { useState } from 'react';

/**
 * Direct Mode Connection Test
 * Tests the connection to the direct AI server
 */
export default function DirectModeTest() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    setResult(null);

    try {
      const { getAIConfig } = await import('@/utils/AutoDetectionEngine/config/aiModeConfig.js');
      const config = getAIConfig();

      if (config.mode !== 'direct') {
        setResult({
          success: false,
          message: 'Not in direct mode',
          config
        });
        setTesting(false);
        return;
      }

      // Test connection to AI server
      const url = `${config.url}/v1/chat/completions`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: 'Hello, this is a connection test. Please respond with "OK".'
            }
          ],
          temperature: 0.3,
          max_tokens: 10
        })
      });

      if (response.ok) {
        const data = await response.json();
        setResult({
          success: true,
          message: 'Connection successful!',
          response: data,
          config
        });
      } else {
        const errorText = await response.text();
        setResult({
          success: false,
          message: `Connection failed: ${response.status} ${response.statusText}`,
          error: errorText,
          config
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Connection error: ${error.message}`,
        error: error.stack
      });
    } finally {
      setTesting(false);
    }
  };

  const cleanupSessions = () => {
    setCleaning(true);
    try {
      let count = 0;
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('autoDetection_session_') || 
            key === 'autoDetection_activeSession' ||
            key.startsWith('session_')) {
          console.log('Removing:', key);
          localStorage.removeItem(key);
          count++;
        }
      });
      setResult({
        success: true,
        message: `Cleaned up ${count} session(s) from localStorage`
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Cleanup error: ${error.message}`
      });
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6">
      <h2 className="text-xl font-semibold text-theme-text-primary mb-4">
        🔌 Direct AI Mode Connection Test
      </h2>

      <div className="flex gap-2">
        <button
          onClick={testConnection}
          disabled={testing}
          className="px-4 py-2 bg-theme-accent-primary text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        <button
          onClick={cleanupSessions}
          disabled={cleaning}
          className="px-4 py-2 bg-red-600 text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {cleaning ? 'Cleaning...' : 'Cleanup Sessions'}
        </button>
      </div>

      {result && (
        <div className={`mt-4 p-4 rounded ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className={`font-semibold mb-2 ${result.success ? 'text-green-800' : 'text-red-800'}`}>
            {result.success ? '✓ Success' : '✗ Failed'}
          </div>
          <div className={`text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
            {result.message}
          </div>

          {result.config && (
            <div className="mt-3 text-xs text-gray-600">
              <div className="font-semibold mb-1">Configuration:</div>
              <div>Mode: {result.config.mode}</div>
              {result.config.url && <div>URL: {result.config.url}</div>}
              {result.config.model && <div>Model: {result.config.model}</div>}
            </div>
          )}

          {result.response && (
            <div className="mt-3 text-xs text-gray-600">
              <div className="font-semibold mb-1">Response:</div>
              <pre className="bg-gray-100 p-2 rounded overflow-auto max-h-40">
                {JSON.stringify(result.response, null, 2)}
              </pre>
            </div>
          )}

          {result.error && (
            <div className="mt-3 text-xs text-red-600">
              <div className="font-semibold mb-1">Error Details:</div>
              <pre className="bg-red-100 p-2 rounded overflow-auto max-h-40">
                {result.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
