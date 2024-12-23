import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import React, { useCallback, useEffect, useState } from 'react';
import { useSettings } from './useSettings';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Types and interfaces moved to top
interface ProviderStatus {
  name: string;
  enabled: boolean;
  isLocal: boolean;
  isRunning: boolean | null;
  error?: string;
  lastChecked: Date;
  responseTime?: number;
  url: string | null;
}

interface SystemInfo {
  os: string;
  browser: string;
  screen: string;
  language: string;
  timezone: string;
  memory: string;
  cores: number;
  deviceType: string;
  colorDepth: string;
  pixelRatio: number;
  online: boolean;
  cookiesEnabled: boolean;
  doNotTrack: boolean;
}

interface IProviderConfig {
  name: string;
  settings: {
    enabled: boolean;
    baseUrl?: string;
  };
}

interface CommitData {
  commit: string;
  version?: string;
}

const DebugView: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { version } = useExtensionState();
  const { providers, isLatestBranch } = useSettings();
  const [activeProviders, setActiveProviders] = useState<ProviderStatus[]>([]);
  const [updateMessage, setUpdateMessage] = useState<string>('');
  const [systemInfo] = useState<SystemInfo>(getSystemInfo());
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Constants
  const GITHUB_URLS = {
    original: 'https://github.com/cline/cline',
    fork: 'https://github.com/viasky657/clineOpenAIAPIPromptCache',
    commitJson: (branch: string) =>
      `https://raw.githubusercontent.com/cline/cline/${branch}/package.json`,
  };

  const LOCAL_PROVIDERS = ['Ollama', 'LMStudio', 'OpenAILike'];

  // Helper Functions
  function getSystemInfo(): SystemInfo {
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getBrowserInfo = (): string => {
      const ua = navigator.userAgent;
      let browser = 'Unknown';
      if (ua.includes('Firefox/')) browser = 'Firefox';
      else if (ua.includes('Chrome/')) {
        if (ua.includes('Edg/')) browser = 'Edge';
        else if (ua.includes('OPR/')) browser = 'Opera';
        else browser = 'Chrome';
      } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
        browser = 'Safari';
      }
      const match = ua.match(new RegExp(`${browser}\\/([\\d.]+)`));
      const version = match ? ` ${match[1]}` : '';
      return `${browser}${version}`;
    };

    const getOperatingSystem = (): string => {
      const ua = navigator.userAgent;
      if (ua.includes('Win')) return 'Windows';
      if (ua.includes('Mac')) {
        if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
        return 'macOS';
      }
      if (ua.includes('Linux')) return 'Linux';
      if (ua.includes('Android')) return 'Android';
      return navigator.platform || 'Unknown';
    };

    const getDeviceType = (): string => {
      const ua = navigator.userAgent;
      if (ua.includes('Mobile')) return 'Mobile';
      if (ua.includes('Tablet')) return 'Tablet';
      return 'Desktop';
    };

    const getMemoryInfo = (): string => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        return `${formatBytes(memory.jsHeapSizeLimit)} (Used: ${formatBytes(memory.usedJSHeapSize)})`;
      }
      return 'Not available';
    };

    return {
      os: getOperatingSystem(),
      browser: getBrowserInfo(),
      screen: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      memory: getMemoryInfo(),
      cores: navigator.hardwareConcurrency || 0,
      deviceType: getDeviceType(),
      //add new fields below if needed:
      colorDepth: `${window.screen.colorDepth}-bit`,
      pixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
      cookiesEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack === '1',
    };
  }

  const checkProviderStatus = async (url: string | null, providerName: string): Promise<ProviderStatus> => {
    if (!url) {
      console.log(`[Debug] No URL provided for ${providerName}`);
      return {
        name: providerName,
        enabled: false,
        isLocal: true,
        isRunning: false,
        error: 'No URL configured',
        lastChecked: new Date(),
        url: null,
      };
    }

    const startTime = performance.now();

    try {
      if (providerName.toLowerCase() === 'ollama') {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'text/plain,application/json' },
          });
          clearTimeout(timeoutId);

          const text = await response.text();
          if (text.includes('Ollama is running')) {
            return {
              name: providerName,
              enabled: false,
              isLocal: true,
              isRunning: true,
              lastChecked: new Date(),
              responseTime: performance.now() - startTime,
              url,
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (errorMessage.includes('aborted')) {
            return {
              name: providerName,
              enabled: false,
              isLocal: true,
              isRunning: false,
              error: 'Connection timeout',
              lastChecked: new Date(),
              responseTime: performance.now() - startTime,
              url,
            };
          }
        }
      }

      const checkUrls = [`${url}/api/health`, url.endsWith('v1') ? `${url}/models` : `${url}/v1/models`];
      const results = await Promise.all(
        checkUrls.map(async (checkUrl) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(checkUrl, {
              signal: controller.signal,
              headers: { Accept: 'application/json' },
            });
            clearTimeout(timeoutId);

            return response.ok;
          } catch (error) {
            return false;
          }
        }),
      );

      const isRunning = results.some((result) => result);

      return {
        name: providerName,
        enabled: false,
        isLocal: true,
        isRunning,
        lastChecked: new Date(),
        responseTime: performance.now() - startTime,
        url,
      };
    } catch (error) {
      return {
        name: providerName,
        enabled: false,
        isLocal: true,
        isRunning: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
        responseTime: performance.now() - startTime,
        url,
      };
    }
  };

  const updateProviderStatuses = async () => {
    if (!providers) return;

    try {
      const entries = Object.entries(providers) as [string, IProviderConfig][];
      const statuses = await Promise.all(
        entries
          .filter(([, provider]) => LOCAL_PROVIDERS.includes(provider.name))
          .map(async ([, provider]) => {
            const envVarName = `REACT_APP_${provider.name.toUpperCase()}_URL`;
            let settingsUrl = provider.settings.baseUrl;
            if (settingsUrl?.trim().length === 0) settingsUrl = undefined;
            const url = settingsUrl || process.env[envVarName] || null;
            const status = await checkProviderStatus(url, provider.name);
            return {
              ...status,
              enabled: provider.settings.enabled ?? false,
            };
          }),
      );
      setActiveProviders(statuses);
    } catch (error) {
      console.error('[Debug] Failed to update provider statuses:', error);
    }
  };

  useEffect(() => {
    updateProviderStatuses();
    const interval = setInterval(updateProviderStatuses, 30000);
    return () => clearInterval(interval);
  }, [providers]);

  const handleCheckForUpdate = useCallback(async () => {
    if (isCheckingUpdate) return;

    try {
      setIsCheckingUpdate(true);
      setUpdateMessage('Checking for updates...');

      const branchToCheck = isLatestBranch ? 'main' : 'stable';
      const localCommitResponse = await fetch(GITHUB_URLS.commitJson(branchToCheck));

      if (!localCommitResponse.ok) {
        throw new Error('Failed to fetch version info');
      }

      const packageJson = await localCommitResponse.json();
      const latestVersion = packageJson.version;

      if (latestVersion !== version) {
        setUpdateMessage(
          `Update available from ${branchToCheck} branch!\n` +
          `Current: v${version}\n` +
          `Latest: v${latestVersion}`,
        );
      } else {
        setUpdateMessage(`You are on the latest version (v${version}) from the ${branchToCheck} branch`);
      }
    } catch (error) {
      setUpdateMessage('Failed to check for updates');
      console.error('[Debug] Update check failed:', error);
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [isCheckingUpdate, isLatestBranch, version]);

  const handleCopyToClipboard = useCallback(() => {
    const debugInfo = {
      System: systemInfo,
      Providers: activeProviders.map((provider) => ({
        name: provider.name,
        enabled: provider.enabled,
        isLocal: provider.isLocal,
        running: provider.isRunning,
        error: provider.error,
        lastChecked: provider.lastChecked,
        responseTime: provider.responseTime,
        url: provider.url,
      })),
      Version: {
        version: `v${version}`,
        branch: isLatestBranch ? 'main' : 'stable',
      },
      Timestamp: new Date().toISOString(),
    };

    navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2))
      .then(() => {
        toast.success('Debug information copied to clipboard!');
      })
      .catch(error => {
        toast.error(`Failed to copy: ${error.message}`);
      });
  }, [activeProviders, systemInfo, isLatestBranch, version]);

  return (
    <React.Fragment>
      <ToastContainer position="top-right" theme="dark" />
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
      }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--vscode-panel-border)",
        }}>
          <h3 style={{ margin: 0, fontSize: "14px" }}>Debug</h3>
          <VSCodeButton onClick={onDone}>Done</VSCodeButton>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <VSCodeButton onClick={handleCopyToClipboard}>
              Copy Debug Info
            </VSCodeButton>
            <VSCodeButton 
              onClick={handleCheckForUpdate}
              disabled={isCheckingUpdate}
            >
              {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
            </VSCodeButton>
          </div>

          {updateMessage && (
            <div style={{
              padding: "8px",
              marginBottom: "12px",
              backgroundColor: "var(--vscode-textBlockQuote-background)",
              border: updateMessage.includes('Update available') ? 
                "1px solid var(--vscode-notificationsWarningIcon-foreground)" : 
                "1px solid var(--vscode-panel-border)",
              borderRadius: "4px",
            }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px" }}>{updateMessage}</pre>
              {updateMessage.includes('Update available') && (
                <div style={{ marginTop: "8px", fontSize: "12px" }}>
                  <p style={{ margin: "4px 0", fontWeight: "500" }}>To update:</p>
                  <ol style={{ margin: "4px 0 0 20px", padding: 0 }}>
                    <li>Pull changes: <code>git pull upstream main</code></li>
                    <li>Install dependencies: <code>pnpm install</code></li>
                    <li>Restart the application</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: "13px" }}>System Information</h4>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "8px",
              padding: "8px",
              backgroundColor: "var(--vscode-textBlockQuote-background)",
              borderRadius: "4px",
            }}>
              {Object.entries(systemInfo).map(([key, value]) => (
                <div key={key} style={{ fontSize: "12px" }}>
                  <div style={{ color: "var(--vscode-textPreformat-foreground)", marginBottom: "2px" }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </div>
                  <div>{String(value)}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 style={{ margin: "0 0 8px 0", fontSize: "13px" }}>Local LLM Status</h4>
            <div style={{
              backgroundColor: "var(--vscode-textBlockQuote-background)",
              borderRadius: "4px",
            }}>
              {activeProviders.map((provider, index) => (
                <div key={provider.name} style={{
                  padding: "8px",
                  borderBottom: index < activeProviders.length - 1 ? 
                    "1px solid var(--vscode-panel-border)" : "none",
                }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "4px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: !provider.enabled ? "var(--vscode-charts-grey)" :
                          provider.isRunning ? "var(--vscode-testing-iconPassed)" :
                          "var(--vscode-testing-iconFailed)",
                      }} />
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: "500" }}>{provider.name}</div>
                        {provider.url && (
                          <div style={{ fontSize: "11px", opacity: 0.8 }}>{provider.url}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "4px", fontSize: "11px" }}>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "10px",
                        backgroundColor: provider.enabled ? 
                          "var(--vscode-testing-iconPassed)" : "var(--vscode-charts-grey)",
                        opacity: 0.2,
                      }}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {provider.enabled && (
                        <span style={{
                          padding: "2px 6px",
                          borderRadius: "10px",
                          backgroundColor: provider.isRunning ?
                            "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)",
                          opacity: 0.2,
                        }}>
                          {provider.isRunning ? 'Running' : 'Not Running'}
                        </span>
                      )}
                    </div>
                  </div>
                  {provider.error && (
                    <div style={{
                      marginTop: "4px",
                      padding: "4px 8px",
                      backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                      border: "1px solid var(--vscode-inputValidation-errorBorder)",
                      borderRadius: "4px",
                    }}>
                      <span style={{ fontWeight: "500" }}>Error:</span> {provider.error}
                    </div>
                  )}
                </div>
              ))}
              {activeProviders.length === 0 && (
                <div style={{
                  padding: "12px",
                  textAlign: "center",
                  fontSize: "12px",
                  opacity: 0.8,
                }}>
                  No local LLMs configured
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
};

export default DebugView;