const { BrowserWindow } = require("electron")
const path = require("path")

class WindowManager {
	constructor() {
		this.mainWindow = null
	}

	createWindow() {
		this.mainWindow = new BrowserWindow({
			width: 1200,
			height: 800,
			show: false, // Don't show initially, show when ready
			icon: path.join(__dirname, "..", "assets", "cline-icon.png"),
			titleBarStyle: "hiddenInset",
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				enableRemoteModule: false,
				preload: path.join(__dirname, "..", "preload.js"),
				webSecurity: true,
			},
			title: "Cline Desktop",
		})

		// Load the actual Cline webview UI from assets directory
		const htmlPath = path.join(__dirname, "..", "assets", "index.html")

		try {
			console.log("Loading index.html from:", htmlPath)
			console.log("Current working directory:", process.cwd())
			console.log("__dirname:", __dirname)
		} catch (err) {
			// Ignore console errors
		}

		this.mainWindow.loadFile(htmlPath)

		// Show window when ready
		this.mainWindow.once("ready-to-show", () => {
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.show()
				console.log("✅ Electron app window shown")
			}
		})

		this.setupWebviewHandling()
		this.setupConsoleLogging()
		this.setupDevTools()

		return this.mainWindow
	}

	setupWebviewHandling() {
		// Set up webview message handling
		this.mainWindow.webContents.on("dom-ready", () => {
			try {
				console.log("DOM ready, injecting standalone setup")
			} catch (logErr) {
				// Ignore console errors
			}

			// Wait a moment for the page to fully load
			setTimeout(() => {
				this.injectStandaloneSetup()
			}, 100)
		})
	}

	setupConsoleLogging() {
		// Also listen for console messages from the webview
		this.mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
			// Log all console messages from the webview
			const levelMap = { 0: "LOG", 1: "INFO", 2: "WARN", 3: "ERROR" }
			console.log(`[Webview ${levelMap[level] || "UNKNOWN"}] ${message}`)
		})
	}

	setupDevTools() {
		// Open DevTools for debugging (uncomment for development)
		this.mainWindow.webContents.openDevTools()
	}

	injectStandaloneSetup() {
		// Inject the standalone setup before the app initializes
		this.mainWindow.webContents.executeJavaScript(`
      window.__is_standalone__ = true;
      window.WEBVIEW_PROVIDER_TYPE = 'sidebar';
      window.clineClientId = 'electron-client-${Date.now()}';
      window.__grpc_ready__ = false; // Initially not ready
      
      // Set up initial state that would normally come from gRPC
      window.__initial_state__ = {
        version: "1.0.0",
        clineMessages: [],
        taskHistory: [], // This will be populated by the actual task loading
        shouldShowAnnouncement: false,
        autoApprovalSettings: {
          enabled: false,
          actions: {
            readFiles: false,
            readFilesExternally: false,
            editFiles: false,
            editFilesExternally: false,
            executeSafeCommands: false,
            executeAllCommands: false,
            useBrowser: false,
            useMcp: false
          },
          maxRequests: 10,
          enableNotifications: true,
          favorites: [],
          version: 1
        },
        browserSettings: {},
        chatSettings: {
          mode: 'PLAN',
          preferredLanguage: 'en',
          openAiReasoningEffort: 'low'
        },
        platform: 'darwin',
        telemetrySetting: 'unset',
        distinctId: '',
        planActSeparateModelsSetting: true,
        enableCheckpointsSetting: true,
        mcpRichDisplayEnabled: true,
        globalClineRulesToggles: {},
        localClineRulesToggles: {},
        localCursorRulesToggles: {},
        localWindsurfRulesToggles: {},
        localWorkflowToggles: {},
        globalWorkflowToggles: {},
        shellIntegrationTimeout: 4000,
        terminalReuseEnabled: true,
        terminalOutputLineLimit: 500,
        defaultTerminalProfile: 'default',
        apiConfiguration: {
          apiProvider: 'gemini',
          apiModelId: 'gemini-2.5-pro',
          geminiApiKey: 'AIzaSyA-NTWUFYIJlcthhzAxqZgjxHWdSDU40jI',
          geminiBaseUrl: undefined,
          requestTimeoutMs: 30000
        },
        isNewUser: false,
        welcomeViewCompleted: true,
        mcpResponsesCollapsed: false
      };
      
      // Add custom styles for standalone mode
      const style = document.createElement('style');
      style.textContent = \`
        body { 
          margin: 0; 
          padding: 0; 
          overflow: hidden; 
          background-color: #1E1E1E;
          color: #D4D4D4;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #root {
          height: 100vh;
          width: 100vw;
          background-color: #1E1E1E;
        }
        /* Draggable title bar region */
        .cline-titlebar-drag {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 28px;
          -webkit-app-region: drag;
          z-index: 10000;
          pointer-events: auto;
        }
        /* Ensure interactive elements in the drag region are not draggable */
        .cline-titlebar-drag button,
        .cline-titlebar-drag input,
        .cline-titlebar-drag select,
        .cline-titlebar-drag textarea,
        .cline-titlebar-drag a,
        .cline-titlebar-drag [role="button"],
        .cline-titlebar-drag .no-drag {
          -webkit-app-region: no-drag;
        }
        /* VSCode Dark Theme Variables */
        :root {
          --vscode-editor-background: #1E1E1E;
          --vscode-editor-foreground: #D4D4D4;
          --vscode-activityBar-background: #2D2D30;
          --vscode-activityBar-foreground: #FFFFFF;
          --vscode-sideBar-background: #252526;
          --vscode-sideBar-foreground: #CCCCCC;
          --vscode-statusBar-background: #007ACC;
          --vscode-statusBar-foreground: #FFFFFF;
          --vscode-input-background: #3C3C3C;
          --vscode-input-foreground: #CCCCCC;
          --vscode-button-background: #0E639C;
          --vscode-button-foreground: #FFFFFF;
          --vscode-dropdown-background: #3C3C3C;
          --vscode-dropdown-foreground: #CCCCCC;
          --vscode-list-hoverBackground: #2A2D2E;
          --vscode-list-activeSelectionBackground: #094771;
          --vscode-list-activeSelectionForeground: #FFFFFF;
          --vscode-panel-background: #1E1E1E;
          --vscode-panel-border: #2D2D30;
          --vscode-tab-activeBackground: #1E1E1E;
          --vscode-tab-inactiveBackground: #2D2D30;
          --vscode-breadcrumb-background: #252526;
          --vscode-scrollbar-shadow: rgba(0,0,0,0.6);
          --vscode-widget-shadow: rgba(0,0,0,0.36);
          --vscode-icon-foreground: #cccccc;
          --vscode-textLink-foreground: #3794ff;
          --vscode-textLink-activeForeground: #3794ff;
          --vscode-descriptionForeground: #CCCCCC;
          --vscode-errorForeground: #f14c4c;
          --vscode-focusBorder: #007fd4;
          --vscode-selection-background: #094771;
          --vscode-badge-background: #4d4d4d;
          --vscode-badge-foreground: #ffffff;
          --vscode-progressBar-background: #0e70c0;
          --vscode-breadcrumb-foreground: #cccccccc;
          --vscode-scrollbar-shadow: #000000;
          --vscode-scrollbarSlider-background: #797979;
          --vscode-scrollbarSlider-hoverBackground: #646464;
          --vscode-scrollbarSlider-activeBackground: #bfbfbf;
          --vscode-toolbar-hoverBackground: #5a5d5e50;
          --vscode-dropdown-border: #3c3c3c;
          --vscode-checkbox-background: #1e1e1e;
          --vscode-checkbox-foreground: #f0f0f0;
          --vscode-checkbox-border: #6c6c6c;
          --vscode-tree-indentGuidesStroke: #585858;
          --vscode-list-inactiveSelectionBackground: #37373d;
          --vscode-list-inactiveSelectionForeground: #cccccc;
          --vscode-list-focusBackground: #062f4a;
          --vscode-list-focusForeground: #cccccc;
          --vscode-quickInputList-focusBackground: #094771;
          --vscode-quickInputList-focusForeground: #ffffff;
          --vscode-contrastActiveBorder: #f38518;
          --vscode-inputValidation-warningBorder: #ffcc00;
          --vscode-settings-dropdownListBorder: #454545;
          --vscode-editorGroup-border: #2d2d30;
          --vscode-panelTitle-activeBorder: #e7e7e7;
          --vscode-panelTitle-activeForeground: #e7e7e7;
          --vscode-panelTitle-inactiveForeground: #e7e7e799;
          --vscode-banner-background: #0e4b99;
        }
        
        /* Additional fixes for checkbox visibility */
        vscode-checkbox {
          --checkbox-background: var(--vscode-checkbox-background, #1e1e1e) !important;
          --checkbox-border: var(--vscode-checkbox-border, #6c6c6c) !important;
          --checkbox-foreground: var(--vscode-checkbox-foreground, #f0f0f0) !important;
        }
        
        vscode-checkbox::part(control) {
          background: var(--vscode-checkbox-background, #1e1e1e) !important;
          border: 1px solid var(--vscode-checkbox-border, #6c6c6c) !important;
          color: var(--vscode-checkbox-foreground, #f0f0f0) !important;
        }
        
        vscode-checkbox[checked]::part(control) {
          background: var(--vscode-checkbox-background, #1e1e1e) !important;
          border-color: var(--vscode-focusBorder, #007fd4) !important;
        }
      \`;
      document.head.appendChild(style);
      
      // Create draggable title bar element
      const titleBar = document.createElement('div');
      titleBar.className = 'cline-titlebar-drag';
      titleBar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(titleBar);
      
      console.log('✅ Added draggable title bar region (28px height)');
      
      // Function to adjust content spacing
      function adjustContentSpacing() {
        const root = document.getElementById('root');
        if (root) {
          const firstChild = root.firstElementChild;
          if (firstChild) {
            // Add transform translateY(28px) to move content down
            firstChild.style.transform = 'translateY(28px)';
            // Set height to calc(100% - 28px) instead of using transform
            firstChild.style.height = 'calc(100% - 28px)';
          }
        }
      }
      
      // Try to adjust spacing after a delay (when React has likely loaded)
      setTimeout(adjustContentSpacing, 1000);
      setTimeout(adjustContentSpacing, 3000);
      setTimeout(adjustContentSpacing, 5000);
      
      // Also try when DOM changes (React re-renders)
      const observer = new MutationObserver(() => {
        adjustContentSpacing();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      
      ${this.getReactLoadingScript()}
    `)
	}

	getReactLoadingScript() {
		return `
      console.log('Injected client ID:', window.clineClientId);
      console.log('Injected initial state:', window.__initial_state__);
      
      // Add logging to track React app loading
      console.log('Checking if React elements are loading...');
      
      // Check if the root element exists
      const rootElement = document.getElementById('root');
      console.log('Root element found:', !!rootElement);
      if (rootElement) {
        console.log('Root element content:', rootElement.innerHTML.length > 0 ? 'Has content' : 'Empty');
      }
      
      // Monitor for React rendering
      let checkCount = 0;
      const checkReactLoading = () => {
        checkCount++;
        const root = document.getElementById('root');
        if (root) {
          console.log('Check #' + checkCount + ' - Root content length:', root.innerHTML.length);
          console.log('Check #' + checkCount + ' - Root first child:', root.firstChild ? root.firstChild.tagName : 'None');
          console.log('Check #' + checkCount + ' - Root innerHTML:', root.innerHTML.substring(0, 200));
          
          // Look for React-rendered elements
          const reactElements = root.querySelectorAll('div, span, [class]');
          console.log('Check #' + checkCount + ' - Elements found:', reactElements.length);
          
          // Check for any elements with classes
          const elementsWithClasses = root.querySelectorAll('[class]');
          console.log('Check #' + checkCount + ' - Elements with classes:', elementsWithClasses.length);
          
          if (reactElements.length > 0 || root.innerHTML.length > 100) {
            console.log('✅ React app appears to be loaded!');
            return;
          }
        }
        
        if (checkCount < 20) {
          setTimeout(checkReactLoading, 500);
        } else {
          console.error('❌ React app failed to load after 10 seconds');
          
          // Check for JavaScript errors
          console.log('Checking for script loading errors...');
          const scripts = Array.from(document.querySelectorAll('script'));
          scripts.forEach((script, index) => {
            console.log('Script ' + index + ':', script.src || 'inline', script.type);
          });
          
          // Check CSS loading
          const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
          links.forEach((link, index) => {
            console.log('CSS ' + index + ':', link.href);
          });
        }
      };
      
      // Start checking after a short delay
      setTimeout(checkReactLoading, 1000);
    `
	}

	signalGrpcReady() {
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.executeJavaScript(`
        window.__grpc_ready__ = true;
        console.log('🎉 gRPC client is ready!');
        
        // Dispatch a custom event to notify waiting calls
        window.dispatchEvent(new CustomEvent('grpc-ready'));
        
        // Real gRPC communication - no forced state injection
        console.log('📡 gRPC client ready - waiting for real state from backend');
      `)
		}
	}

	getMainWindow() {
		return this.mainWindow
	}

	destroy() {
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.destroy()
			this.mainWindow = null
		}
	}
}

module.exports = WindowManager
