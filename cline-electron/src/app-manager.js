const { app, ipcMain, dialog } = require("electron")
const WindowManager = require("./window-manager")
const GrpcClientManager = require("./grpc-client-manager")
const IpcHandler = require("./ipc-handler")
const StateManager = require("./state-manager")

class AppManager {
	constructor() {
		this.windowManager = new WindowManager()
		this.grpcClientManager = new GrpcClientManager()
		this.ipcHandler = new IpcHandler()
		this.stateManager = new StateManager()
		this.hostBridgeServer = null
	}

	async initialize() {
		// Set up app event handlers first
		this.setupAppEventHandlers()

		// Wait for app to be ready
		await app.whenReady()

		try {
			// Create the Electron window
			const mainWindow = this.windowManager.createWindow()

			// Set up the main window reference for gRPC client manager
			this.grpcClientManager.setMainWindow(mainWindow)

			// Initialize IPC handler with dependencies
			this.ipcHandler.initialize(this.grpcClientManager, this.stateManager, () => this.windowManager.getMainWindow())

			// Set up IPC handlers for dialogs
			this.setupDialogHandlers()

			// This function will act as the bridge from the backend to the webview.
			// It replaces the stubbed postMessage and provides a direct communication channel.
			const postMessageToWebview = (message) => {
				const window = this.windowManager.getMainWindow()
				if (window && !window.isDestroyed()) {
					// The webview's preload script listens for 'grpc-response' to pass
					// messages to the UI. We use this existing channel.
					// The message object from the Controller is already in the correct format.
					window.webContents.send("grpc-response", message)
				}
				return Promise.resolve(true)
			}

			// Import the necessary functions from the refactored standalone module
			const { activateStandalone, startProtobusService } = require("../../dist-standalone/standalone")
			const ElectronHostBridgeServer = require("../host-bridge-server")

			// Activate the standalone Cline backend directly within this main process.
			// We pass our real postMessage function to the Controller.
			const { controller, hostBridgeProvider } = activateStandalone(postMessageToWebview)

			// Start the gRPC server in this same process. It will use the
			// activated controller instance.
			startProtobusService(controller, hostBridgeProvider)

			// Store references for IPC handling
			global.clineController = controller
			global.clineHostBridge = hostBridgeProvider

			// Signal that gRPC is ready to the webview
			this.windowManager.signalGrpcReady()

			// Start the Host Bridge server
			try {
				console.log("🌉 Starting Host Bridge server...")
				this.hostBridgeServer = new ElectronHostBridgeServer(this.windowManager.getMainWindow())
				await this.hostBridgeServer.start()
				console.log("✅ Host Bridge server started successfully")
			} catch (error) {
				console.error("❌ Failed to start Host Bridge server:", error)
			}

			// Initialize gRPC clients after server starts
			setTimeout(() => {
				this.grpcClientManager.initializeGrpcClients()
			}, 3000)

			try {
				console.log("🎉 Cline Electron app is ready!")
				console.log("📡 Cline Core and Host Bridge are running in the main process.")
			} catch (logErr) {
				// Ignore console errors
			}
		} catch (error) {
			try {
				console.error("❌ Failed to start Cline app:", error)
			} catch (logErr) {
				// Ignore console errors
			}
			app.quit()
		}
	}

	setupDialogHandlers() {
		// Handle warning dialog requests from renderer
		ipcMain.handle("show-warning-dialog", async (event, { message, options, items }) => {
			console.log("📢 Showing warning dialog:", { message, options, items })

			const mainWindow = this.windowManager.getMainWindow()
			if (!mainWindow) {
				console.error("No main window available for dialog")
				return undefined
			}

			try {
				// Convert to Electron dialog options
				const dialogOptions = {
					type: "warning",
					message: message,
					buttons: items.length > 0 ? ["Cancel", ...items] : ["Cancel"],
					defaultId: items.length > 0 ? 1 : 0, // Default to first action button
					cancelId: 0, // Cancel button is always at index 0
				}

				if (options.modal) {
					dialogOptions.modal = true
				}

				console.log("📢 Dialog options:", dialogOptions)

				const result = await dialog.showMessageBox(mainWindow, dialogOptions)
				console.log("📢 Dialog result:", result)

				// Return the selected item or undefined for cancel
				if (result.response === 0) {
					// Cancel was clicked
					return undefined
				} else if (result.response > 0 && items.length > 0) {
					// An action button was clicked
					return items[result.response - 1]
				}

				return undefined
			} catch (error) {
				console.error("Failed to show dialog:", error)
				return undefined
			}
		})
	}

	setupAppEventHandlers() {
		app.on("window-all-closed", () => {
			// Since the server runs in the main process, it will be terminated automatically.
			if (this.hostBridgeServer) {
				this.hostBridgeServer.stop()
			}
			if (process.platform !== "darwin") {
				app.quit()
			}
		})

		app.on("activate", () => {
			if (require("electron").BrowserWindow.getAllWindows().length === 0) {
				this.windowManager.createWindow()
			}
		})

		// Handle app termination
		process.on("SIGINT", () => {
			console.log("🛑 Received SIGINT, shutting down gracefully...")
			if (this.hostBridgeServer) {
				this.hostBridgeServer.stop()
			}
			process.exit(0)
		})

		process.on("SIGTERM", () => {
			console.log("🛑 Received SIGTERM, shutting down gracefully...")
			if (this.hostBridgeServer) {
				this.hostBridgeServer.stop()
			}
			process.exit(0)
		})
	}

	// Getter methods for access to managers
	getWindowManager() {
		return this.windowManager
	}

	getGrpcClientManager() {
		return this.grpcClientManager
	}

	getIpcHandler() {
		return this.ipcHandler
	}

	getStateManager() {
		return this.stateManager
	}
}

module.exports = AppManager
