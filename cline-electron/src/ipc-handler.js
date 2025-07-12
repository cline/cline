const { ipcMain } = require("electron")

class IpcHandler {
	constructor() {
		this.grpcClientManager = null
		this.stateManager = null
		this.getMainWindow = null
	}

	initialize(grpcClientManager, stateManager, getMainWindowFn) {
		this.grpcClientManager = grpcClientManager
		this.stateManager = stateManager
		this.getMainWindow = getMainWindowFn
		this.setupIpcHandlers()
	}

	setupIpcHandlers() {
		ipcMain.on("vscode-message", async (event, message) => {
			// console.log('📨 IPC message received:', message.type, JSON.stringify(message).substring(0, 200)); // Disabled to reduce console noise

			if (message.type === "grpc_request") {
				await this.handleGrpcRequest(message.grpc_request)
			}
		})
	}

	async handleGrpcRequest(grpcRequest) {
		const { service, method, request_id, is_streaming, message: request } = grpcRequest
		// console.log('📨 gRPC request:', service, method, 'streaming:', is_streaming, 'request:', request); // Disabled to reduce console noise

		// Special logging for state service requests
		if (service === "cline.StateService" && method === "subscribeToState") {
			console.log("🎯 STATE SERVICE REQUEST DETECTED!")
		}

		// Use the in-process backend directly instead of separate gRPC client
		const controller = global.clineController
		const mainWin = this.getMainWindow()

		if (!controller) {
			const errorResponse = {
				type: "grpc_response",
				grpc_response: {
					request_id: request_id,
					message: null,
					is_streaming: false,
					error: "Backend controller not initialized",
				},
			}

			if (mainWin && !mainWin.isDestroyed()) {
				mainWin.webContents.send("grpc-response", errorResponse)
			}
			return
		}

		try {
			if (service === "cline.StateService" && method === "subscribeToState") {
				await this.handleStateSubscription(controller, request_id, mainWin)
			} else if (service === "cline.TaskService") {
				await this.handleTaskService(controller, method, request_id, request, mainWin)
			} else {
				await this.handleOtherServices(service, method, request_id, request, is_streaming, mainWin)
			}
		} catch (grpcError) {
			console.error("gRPC call error:", grpcError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: grpcError.message || "gRPC call failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleStateSubscription(controller, request_id, mainWin) {
		console.log("📡 Handling state subscription directly with backend controller")

		// Create a streaming response handler
		const responseStream = async (response, isLast = false) => {
			// console.log('📡 Sending state response to webview:', response); // Disabled to reduce console noise
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: response,
						is_streaming: !isLast,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
			}
		}

		// Call the backend state subscription method directly
		// Use the controller's getStateToPostToWebview method to get the current state
		console.log("📡 Getting initial state from controller")
		const initialState = await controller.getStateToPostToWebview()
		const stateJson = JSON.stringify(initialState)
		console.log("📡 Initial state JSON length:", stateJson.length)

		// Send the initial state
		await responseStream({ stateJson })

		// Set up event-driven state updates (like VSCode extension)
		console.log("📡 Setting up event-driven state updates")

		// Store the subscription info globally so we can send updates
		global.stateSubscriptions = global.stateSubscriptions || []
		const subscription = {
			request_id: request_id,
			responseStream: responseStream,
			controller: controller,
			mainWindow: mainWin,
		}
		global.stateSubscriptions.push(subscription)

		// Store the response stream globally for this controller
		controller._electronStateStream = {
			responseStream,
			mainWindow: mainWin,
			request_id,
		}

		// Hook into the controller's postStateToWebview method
		const originalPostStateToWebview = controller.postStateToWebview
		controller.postStateToWebview = async function () {
			// For Electron, skip the original method and handle directly
			if (this._electronStateStream) {
				try {
					if (this._electronStateStream.mainWindow && !this._electronStateStream.mainWindow.isDestroyed()) {
						const currentState = await this.getStateToPostToWebview()
						const stateJson = JSON.stringify(currentState)
						await this._electronStateStream.responseStream({ stateJson })
						console.log("📡 Sent event-driven state update")
					}
				} catch (error) {
					console.error("📡 Error sending Electron state update:", error)
				}
			} else {
				// Fall back to original method for VSCode extension
				await originalPostStateToWebview.call(this)
			}
		}

		console.log("📡 Hooked into controller postStateToWebview method")
		console.log("📡 Registered state stream for controller:", controller.id)

		console.log("📡 State subscription established with fully event-driven updates")
	}

	async handleTaskService(controller, method, request_id, request, mainWin) {
		if (method === "newTask") {
			await this.handleNewTask(controller, request_id, request, mainWin)
		} else if (method === "clearTask") {
			await this.handleClearTask(controller, request_id, mainWin)
		} else if (method === "cancelTask") {
			await this.handleCancelTask(controller, request_id, mainWin)
		} else if (method === "askResponse") {
			await this.handleAskResponse(controller, request_id, request, mainWin)
		} else {
			// Forward other task methods to gRPC server
			this.grpcClientManager.forwardToGrpcServer("cline.TaskService", method, request_id, request, false)
		}
	}

	async handleNewTask(controller, request_id, request, mainWin) {
		console.log("📡 TASK SERVICE REQUEST DETECTED!")
		console.log("📡 Handling new task creation directly with backend controller")
		console.log("📡 Task request:", request)

		// Extract task data from request
		const { text, images = [], files = [] } = request
		console.log("📡 Creating new task with text:", text)

		try {
			// Call the controller's newTask method directly
			console.log("📡 About to call controller.clearTask() and controller.initTask()")
			console.log("📡 Controller object:", !!controller)
			try {
				console.log("📡 Calling controller.clearTask...")
				await controller.clearTask()
				console.log("📡 Calling controller.initTask...")
				await controller.initTask(text, images, files)
				console.log("📡 Task initialization completed")
			} catch (serviceError) {
				console.error("📡 Error in task service method:", serviceError)
				console.error("📡 Error stack:", serviceError.stack)
				throw serviceError
			}

			console.log("📡 Task created successfully")

			// Send successful response back to webview
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: { success: true },
						is_streaming: false,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
				console.log("📡 Task response sent to webview")
			}

			// State updates will be triggered automatically via event-driven mechanism
		} catch (taskError) {
			console.error("📡 Task creation failed:", taskError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: taskError.message || "Task creation failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleClearTask(controller, request_id, mainWin) {
		console.log("📡 TASK CLEAR REQUEST DETECTED!")
		console.log("📡 Handling task clearing directly with backend controller")

		try {
			console.log("📡 Calling controller.clearTask...")
			await controller.clearTask()
			console.log("📡 Task cleared successfully")

			// Send successful response back to webview
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: { success: true },
						is_streaming: false,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
				console.log("📡 Task clear response sent to webview")
			}

			// State updates will be triggered automatically via event-driven mechanism
		} catch (clearError) {
			console.error("📡 Task clearing failed:", clearError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: clearError.message || "Task clearing failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleCancelTask(controller, request_id, mainWin) {
		console.log("📡 TASK CANCEL REQUEST DETECTED!")
		console.log("📡 Handling task cancellation directly with backend controller")

		try {
			console.log("📡 Calling controller.cancelTask...")
			await controller.cancelTask()
			console.log("📡 Task cancelled successfully")

			// Send successful response back to webview
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: { success: true },
						is_streaming: false,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
				console.log("📡 Task cancel response sent to webview")
			}

			// State updates will be triggered automatically via event-driven mechanism
		} catch (cancelError) {
			console.error("📡 Task cancellation failed:", cancelError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: cancelError.message || "Task cancellation failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleAskResponse(controller, request_id, request, mainWin) {
		console.log("📡 TASK ASK RESPONSE REQUEST DETECTED!")
		console.log("📡 Handling task ask response directly with backend controller")
		console.log("📡 Ask response request:", request)

		try {
			// Extract ask response data from request
			const { responseType, text, images = [], files = [] } = request
			console.log("📡 Processing ask response:", { responseType, text, images, files })

			// Call the task's handleWebviewAskResponse method
			if (controller.task) {
				console.log("📡 Calling controller.task.handleWebviewAskResponse...")
				await controller.task.handleWebviewAskResponse(responseType, text, images, files)
				console.log("📡 Ask response handled successfully")
			} else {
				console.warn("📡 No active task found for ask response")
			}

			// Send successful response back to webview
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: { success: true },
						is_streaming: false,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
				console.log("📡 Ask response acknowledgment sent to webview")
			}

			// State updates will be triggered automatically via event-driven mechanism
		} catch (askError) {
			console.error("📡 Ask response handling failed:", askError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: askError.message || "Ask response handling failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleOtherServices(service, method, request_id, request, is_streaming, mainWin) {
		// For other services, fall back to the existing gRPC client approach or implement stubs
		if (service === "cline.UiService") {
			this.handleUiService(method, request_id, request, is_streaming, mainWin)
		} else if (service === "cline.AccountService") {
			this.handleAccountService(method, request_id, request, is_streaming, mainWin)
		} else if (service === "cline.McpService") {
			this.handleMcpService(method, request_id, request, is_streaming, mainWin)
		} else if (service === "cline.FileService") {
			this.handleFileService(method, request_id, request, is_streaming, mainWin)
		} else if (service === "cline.ModelsService") {
			this.handleModelsService(method, request_id, request, is_streaming, mainWin)
		} else if (service === "cline.StateService") {
			this.handleStateService(method, request_id, request, is_streaming, mainWin)
		} else if (service === "cline.CheckpointsService") {
			this.handleCheckpointsService(method, request_id, request, is_streaming, mainWin)
		} else {
			// For all other services, forward to gRPC server
			console.log(`📡 Forwarding ${service}.${method} to real gRPC server`)
			this.grpcClientManager.forwardToGrpcServer(service, method, request_id, request, is_streaming)
		}
	}

	handleUiService(method, request_id, request, is_streaming, mainWin) {
		switch (method) {
			case "initializeWebview":
			case "subscribeToPartialMessage":
			case "subscribeToTheme":
			case "onDidShowAnnouncement":
				// Forward to the real gRPC server to persist state
				console.log(`📡 Forwarding cline.UiService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.UiService", method, request_id, request, is_streaming)
				break

			case "subscribeToAddToInput":
			case "subscribeToMcpButtonClicked":
			case "subscribeToHistoryButtonClicked":
			case "subscribeToChatButtonClicked":
			case "subscribeToDidBecomeVisible":
			case "subscribeToSettingsButtonClicked":
			case "subscribeToAccountButtonClicked":
			case "subscribeToRelinquishControl":
			case "subscribeToFocusChatInput":
				// console.log(`Handling cline.UiService.${method} with stub implementation`); // Disabled to reduce console noise
				if (mainWin && !mainWin.isDestroyed()) {
					mainWin.webContents.send("grpc-response", {
						type: "grpc_response",
						grpc_response: {
							request_id: request_id,
							message: { success: true },
							is_streaming: is_streaming,
							error: null,
						},
					})
				}
				break

			default:
				throw new Error(`Service cline.UiService.${method} not implemented for direct backend access`)
		}
	}

	handleAccountService(method, request_id, request, is_streaming, mainWin) {
		switch (method) {
			case "subscribeToAuthCallback":
				// console.log(`Handling cline.AccountService.${method} with stub implementation`); // Disabled to reduce console noise
				if (mainWin && !mainWin.isDestroyed()) {
					mainWin.webContents.send("grpc-response", {
						type: "grpc_response",
						grpc_response: {
							request_id: request_id,
							message: { success: true },
							is_streaming: is_streaming,
							error: null,
						},
					})
				}
				break

			default:
				throw new Error(`Service cline.AccountService.${method} not implemented for direct backend access`)
		}
	}

	handleMcpService(method, request_id, request, is_streaming, mainWin) {
		switch (method) {
			case "subscribeToMcpServers":
			case "subscribeToMcpMarketplaceCatalog":
				// console.log(`Handling cline.McpService.${method} with stub implementation`); // Disabled to reduce console noise
				if (mainWin && !mainWin.isDestroyed()) {
					mainWin.webContents.send("grpc-response", {
						type: "grpc_response",
						grpc_response: {
							request_id: request_id,
							message: { servers: [], catalog: [] },
							is_streaming: is_streaming,
							error: null,
						},
					})
				}
				break

			default:
				throw new Error(`Service cline.McpService.${method} not implemented for direct backend access`)
		}
	}

	async handleFileService(method, request_id, request, is_streaming, mainWin) {
		const controller = global.clineController
		if (!controller) {
			throw new Error("Backend controller not initialized")
		}

		switch (method) {
			case "subscribeToWorkspaceUpdates":
				// Forward to the real gRPC server to get actual workspace file updates
				console.log(`📡 Forwarding cline.FileService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.FileService", method, request_id, request, is_streaming)
				break

			case "searchCommits":
			case "searchFiles":
				// Forward to the real gRPC server
				console.log(`📡 Forwarding cline.FileService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.FileService", method, request_id, request, is_streaming)
				break

			case "copyToClipboard":
				console.log(`📡 Handling cline.FileService.${method} directly`)
				try {
					// Use the Electron clipboard API directly
					const { clipboard } = require("electron")
					if (request.value) {
						clipboard.writeText(request.value)
					}
					if (mainWin && !mainWin.isDestroyed()) {
						mainWin.webContents.send("grpc-response", {
							type: "grpc_response",
							grpc_response: {
								request_id: request_id,
								message: { success: true },
								is_streaming: false,
								error: null,
							},
						})
					}
				} catch (error) {
					console.error(`Error in ${method}:`, error)
					if (mainWin && !mainWin.isDestroyed()) {
						mainWin.webContents.send("grpc-response", {
							type: "grpc_response",
							grpc_response: {
								request_id: request_id,
								message: null,
								is_streaming: false,
								error: error.message,
							},
						})
					}
				}
				break

			default:
				throw new Error(`Service cline.FileService.${method} not implemented for direct backend access`)
		}
	}

	handleModelsService(method, request_id, request, is_streaming, mainWin) {
		// console.log(`🔥 [MODELS-IPC] Handling ModelsService.${method} request:`, request);
		switch (method) {
			case "subscribeToOpenRouterModels":
				// Forward to the real gRPC server to get actual OpenRouter models
				console.log(`📡 Forwarding cline.ModelsService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.ModelsService", method, request_id, request, is_streaming)
				break

			case "refreshOpenRouterModels":
				// Forward to the real gRPC server to refresh OpenRouter models
				console.log(`📡 Forwarding cline.ModelsService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.ModelsService", method, request_id, request, is_streaming)
				break

			case "updateApiConfigurationProto":
				// Forward to the real gRPC server to properly handle API configuration updates
				console.log(`📡 Forwarding cline.ModelsService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.ModelsService", method, request_id, request, is_streaming)
				break

			default:
				throw new Error(`Service cline.ModelsService.${method} not implemented for direct backend access`)
		}
	}

	handleStateService(method, request_id, request, is_streaming, mainWin) {
		switch (method) {
			case "getAvailableTerminalProfiles":
				// Forward to the real gRPC server to get actual system terminal profiles
				console.log(`📡 Forwarding cline.StateService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.StateService", method, request_id, request, is_streaming)
				break

			case "updateAutoApprovalSettings":
				console.log(`📡 Handling cline.StateService.updateAutoApprovalSettings directly`)
				console.log(`📡 Auto-approval settings request:`, request)
				this.handleUpdateAutoApprovalSettings(request_id, request, mainWin)
				break

			case "togglePlanActMode":
				// Handle locally first, then try to forward to gRPC server if available
				console.log(`📡 Handling cline.StateService.togglePlanActMode locally`)
				console.log(`📡 Toggle plan/act mode request:`, request)
				this.handleTogglePlanActMode(request_id, request, mainWin)
				break

			case "updateTelemetrySetting":
			case "updateSettings":
			case "subscribeToState":
				// Forward to the real gRPC server
				console.log(`📡 Forwarding cline.StateService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.StateService", method, request_id, request, is_streaming)
				break

			default:
				// Forward unknown methods to gRPC server
				console.log(`📡 Forwarding unknown cline.StateService.${method} to real gRPC server`)
				this.grpcClientManager.forwardToGrpcServer("cline.StateService", method, request_id, request, is_streaming)
				break
		}
	}

	async handleTogglePlanActMode(request_id, request, mainWin) {
		try {
			console.log("📡 Processing plan/act mode toggle:", request)

			const controller = global.clineController
			if (!controller) {
				throw new Error("Backend controller not initialized")
			}

			// Extract chat settings from request
			const chatSettings = request.chatSettings
			if (!chatSettings) {
				throw new Error("Chat settings are required for plan/act mode toggle")
			}

			console.log("📡 Chat settings received:", chatSettings)

			// Convert proto chat settings to the format expected by the controller
			const modeString = chatSettings.mode === 0 ? "plan" : "act"

			const controllerChatSettings = {
				mode: modeString,
				preferredLanguage: chatSettings.preferredLanguage || "English",
				openAIReasoningEffort: chatSettings.openAiReasoningEffort || "medium",
			}

			console.log("📡 Converted chat settings for controller:", controllerChatSettings)

			// Extract chat content if provided
			const chatContent = request.chatContent
				? {
						message: request.chatContent.message || "",
						images: request.chatContent.images || [],
						files: request.chatContent.files || [],
					}
				: undefined

			console.log("📡 Chat content:", chatContent)

			// Call the controller's toggle method - this is the key fix!
			console.log("📡 Calling controller.togglePlanActModeWithChatSettings")
			const sentMessage = await controller.togglePlanActModeWithChatSettings(controllerChatSettings, chatContent)
			console.log("📡 Controller toggle method completed, sentMessage:", sentMessage)

			// Send successful response back to webview
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: { success: true },
						is_streaming: false,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
				console.log("📡 Plan/act mode toggle response sent to webview")
			}

			// Trigger immediate state update for all subscriptions
			await this.stateManager.broadcastStateUpdate("plan-act-mode-updated")
		} catch (modeError) {
			console.error("📡 Plan/act mode toggle failed:", modeError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: modeError.message || "Plan/act mode toggle failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleUpdateAutoApprovalSettings(request_id, request, mainWin) {
		try {
			console.log("📡 Processing auto-approval settings update:", request)

			const controller = global.clineController
			if (!controller) {
				throw new Error("Backend controller not initialized")
			}

			// Convert proto request to settings object
			const settings = {
				version: request.version || 1,
				enabled: request.enabled || false,
				actions: {
					readFiles: request.actions?.readFiles || false,
					readFilesExternally: request.actions?.readFilesExternally || false,
					editFiles: request.actions?.editFiles || false,
					editFilesExternally: request.actions?.editFilesExternally || false,
					executeSafeCommands: request.actions?.executeSafeCommands || false,
					executeAllCommands: request.actions?.executeAllCommands || false,
					useBrowser: request.actions?.useBrowser || false,
					useMcp: request.actions?.useMcp || false,
				},
				maxRequests: request.maxRequests || 5,
				enableNotifications: request.enableNotifications || false,
				favorites: request.favorites || [],
			}

			console.log("📡 Converted settings:", settings)

			// Update the settings in the controller
			if (controller.context && controller.context.globalState) {
				console.log("📡 Updating auto-approval settings in controller state")
				await controller.context.globalState.update("autoApprovalSettings", settings)

				// Update the task's auto-approval settings if there's an active task
				if (controller.task && typeof controller.task.updateAutoApprovalSettings === "function") {
					controller.task.updateAutoApprovalSettings(settings)
				}

				console.log("📡 Auto-approval settings updated successfully")
			} else {
				console.warn("📡 No globalState available in controller")
			}

			// Send successful response back to webview
			if (mainWin && !mainWin.isDestroyed()) {
				const responseMessage = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: { success: true },
						is_streaming: false,
						error: null,
					},
				}
				mainWin.webContents.send("grpc-response", responseMessage)
				console.log("📡 Auto-approval settings response sent to webview")
			}

			// Trigger immediate state update for all subscriptions
			await this.stateManager.broadcastStateUpdate("auto-approval-settings-updated")
		} catch (settingsError) {
			console.error("📡 Auto-approval settings update failed:", settingsError)

			// Send error response
			if (mainWin && !mainWin.isDestroyed()) {
				const errorResponse = {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: settingsError.message || "Auto-approval settings update failed",
					},
				}
				mainWin.webContents.send("grpc-response", errorResponse)
			}
		}
	}

	async handleCheckpointsService(method, request_id, request, is_streaming, mainWin) {
		const controller = global.clineController
		if (!controller || !controller.task) {
			const error = "Checkpoint service is not available (no active task)."
			console.error(error)
			if (mainWin && !mainWin.isDestroyed()) {
				mainWin.webContents.send("grpc-response", {
					type: "grpc_response",
					grpc_response: { request_id, message: null, is_streaming: false, error },
				})
			}
			return
		}

		// Get the checkpoint tracker from the task
		const checkpointTracker = controller.task.checkpointTracker
		if (!checkpointTracker && method === "checkpointRestore") {
			const error = "Checkpoint tracker is not available."
			console.error(error)
			if (mainWin && !mainWin.isDestroyed()) {
				mainWin.webContents.send("grpc-response", {
					type: "grpc_response",
					grpc_response: { request_id, message: null, is_streaming: false, error },
				})
			}
			return
		}

		switch (method) {
			case "checkpointRestore":
				try {
					const taskHistory = controller.task.messageStateHandler.getClineMessages()
					console.log("📡 Checkpoint restore debug:")
					console.log("📡 Looking for timestamp:", request.number)
					console.log("📡 Available messages count:", taskHistory.length)
					console.log(
						"📡 Sample message timestamps:",
						taskHistory.slice(0, 5).map((m) => ({ ts: m.ts, type: m.type, ask: m.ask, say: m.say })),
					)

					// Try both exact match and type conversion
					let message = taskHistory.find((m) => m.ts === request.number)
					if (!message) {
						// Try string/number conversion
						message = taskHistory.find((m) => m.ts == request.number) // loose equality
					}
					if (!message) {
						// Try converting to number
						const requestTimestamp = Number(request.number)
						message = taskHistory.find((m) => Number(m.ts) === requestTimestamp)
					}

					console.log("📡 Found message:", message ? "Yes" : "No")
					console.log("📡 Request timestamp type:", typeof request.number)
					console.log("📡 Request timestamp value:", request.number)

					if (!message) {
						// Try to find messages with lastCheckpointHash to see what's available
						const checkpointMessages = taskHistory.filter((m) => m.lastCheckpointHash)
						console.log("📡 Messages with lastCheckpointHash:", checkpointMessages.length)
						console.log(
							"📡 Available checkpoint timestamps:",
							checkpointMessages.map((m) => ({ ts: m.ts, type: typeof m.ts })),
						)
						throw new Error(
							`Could not find a checkpoint for timestamp: ${request.number}. Available checkpoints: ${checkpointMessages.map((m) => m.ts).join(", ")}`,
						)
					}

					if (!message.lastCheckpointHash) {
						throw new Error(`Message found but no lastCheckpointHash for timestamp: ${request.number}`)
					}
					const commitHash = message.lastCheckpointHash

					const { restoreType } = request

					if (restoreType === "workspace" || restoreType === "taskAndWorkspace") {
						await checkpointTracker.resetHead(commitHash)
					}

					if (restoreType === "task" || restoreType === "taskAndWorkspace") {
						const checkpointIndex = taskHistory.findIndex((item) => item.ts === request.number)
						if (checkpointIndex !== -1) {
							const restoredHistory = taskHistory.slice(0, checkpointIndex + 1)
							await controller.task.messageStateHandler.overwriteClineMessages(restoredHistory)
							// We need to reload the state in the webview
							await controller.postStateToWebview()
						}
					}

					if (mainWin && !mainWin.isDestroyed()) {
						mainWin.webContents.send("grpc-response", {
							type: "grpc_response",
							grpc_response: {
								request_id: request_id,
								message: { success: true },
								is_streaming: false,
								error: null,
							},
						})
					}
				} catch (error) {
					console.error("Checkpoint restore error:", error)
					if (mainWin && !mainWin.isDestroyed()) {
						mainWin.webContents.send("grpc-response", {
							type: "grpc_response",
							grpc_response: {
								request_id: request_id,
								message: null,
								is_streaming: false,
								error: error.message,
							},
						})
					}
				}
				break

			case "checkpointDiff":
				// In Electron, we cannot show a diff view like in VS Code.
				// For now, we send an informational message.
				if (mainWin && !mainWin.isDestroyed()) {
					mainWin.webContents.send("grpc-response", {
						type: "grpc_response",
						grpc_response: {
							request_id: request_id,
							message: null,
							is_streaming: false,
							error: "Diff view is not supported in Electron mode.",
						},
					})
				}
				break

			default:
				throw new Error(`Service cline.CheckpointsService.${method} not implemented for direct backend access`)
		}
	}
}

module.exports = IpcHandler
