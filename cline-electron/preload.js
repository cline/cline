const { contextBridge, ipcRenderer } = require("electron")

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
	testClineConnection: () => ipcRenderer.invoke("test-cline-connection"),
	testClipboard: () => ipcRenderer.invoke("test-clipboard"),
	testDialog: () => ipcRenderer.invoke("test-dialog"),
	testFiles: () => ipcRenderer.invoke("test-files"),

	// Add dialog handlers
	showWarningDialog: (options) => ipcRenderer.invoke("show-warning-dialog", options),

	// Add message posting for VSCode API compatibility
	postMessage: (message) => {
		// console.log('ElectronAPI postMessage:', message); // Disabled to reduce console noise
		ipcRenderer.send("vscode-message", message)
	},

	// Add gRPC response handler
	onGrpcResponse: (handler) => {
		ipcRenderer.on("grpc-response", (event, response) => {
			handler(response)
		})
	},

	// Add more API methods as needed
	platform: process.platform,
	version: process.versions.electron,
})

// Provide the VSCode API that the Cline webview expects
contextBridge.exposeInMainWorld("acquireVsCodeApi", () => {
	// In the new single-process architecture, the webview's gRPC client
	// communicates directly with the in-process gRPC server. The `postMessage`
	// function in the VSCode API mock is therefore no longer needed, as all
	// communication is handled by the gRPC client.

	// However, the webview still needs to *receive* messages from the backend.
	// We keep the listener for 'grpc-response' which is now sent directly
	// from the main process via `postMessageToWebview`.
	const messageHandlers = new Set()

	ipcRenderer.on("grpc-response", (event, response) => {
		// This is the single entry point for messages from the backend to the webview.
		const messageEvent = new MessageEvent("message", { data: response })
		window.dispatchEvent(messageEvent)
	})

	return {
		// This postMessage sends messages to the main process for real gRPC communication.
		postMessage: (message) => {
			// console.log('📨 VSCode API postMessage called with:', message); // Disabled to reduce console noise
			ipcRenderer.send("vscode-message", message)
		},
		getState: () => {
			const state = localStorage.getItem("vscodeState")
			return state ? JSON.parse(state) : undefined
		},
		setState: (newState) => {
			localStorage.setItem("vscodeState", JSON.stringify(newState))
			return newState
		},
		// This is still needed for the webview to listen to backend->UI messages.
		onDidReceiveMessage: (handler) => {
			window.addEventListener("message", (event) => {
				handler(event.data)
			})
		},
	}
})

// Mock the gRPC client for the webview to send requests to main process
contextBridge.exposeInMainWorld("__grpcMock", {
	call: (service, method, request, options) => {
		console.log("🔌 gRPC Call:", service, method, request)
		return new Promise((resolve, reject) => {
			const request_id = Date.now().toString()
			const grpcMessage = {
				type: "grpc_request",
				grpc_request: {
					service,
					method,
					request_id,
					is_streaming: false,
					request,
				},
			}

			// Send the request to main process
			ipcRenderer.send("vscode-message", grpcMessage)

			// Listen for the response
			const responseHandler = (event, response) => {
				if (response.type === "grpc_response" && response.grpc_response.request_id === request_id) {
					ipcRenderer.removeListener("grpc-response", responseHandler)
					if (response.grpc_response.error) {
						reject(new Error(response.grpc_response.error))
					} else {
						resolve(response.grpc_response.message)
					}
				}
			}

			ipcRenderer.on("grpc-response", responseHandler)

			// Timeout after 10 seconds
			setTimeout(() => {
				ipcRenderer.removeListener("grpc-response", responseHandler)
				reject(new Error("gRPC call timeout"))
			}, 10000)
		})
	},

	stream: (service, method, request, options) => {
		// console.log('🔌 gRPC Stream:', service, method, request);
		const request_id = Date.now().toString()
		let responseHandler = null
		let errorHandler = null
		let completeHandler = null

		return {
			onResponse: (handler) => {
				responseHandler = handler
				const grpcMessage = {
					type: "grpc_request",
					grpc_request: {
						service,
						method,
						request_id,
						is_streaming: true,
						request,
					},
				}

				// console.log('📡 Sending gRPC stream request:', grpcMessage);
				// Send the request to main process
				ipcRenderer.send("vscode-message", grpcMessage)

				// Listen for streaming responses
				const streamResponseHandler = (event, response) => {
					// console.log('📡 Received IPC response:', response);
					if (response.type === "grpc_response" && response.grpc_response.request_id === request_id) {
						if (response.grpc_response.error) {
							console.error("📡 gRPC stream error:", response.grpc_response.error)
							if (errorHandler) {
								errorHandler(new Error(response.grpc_response.error))
							}
							ipcRenderer.removeListener("grpc-response", streamResponseHandler)
						} else if (response.grpc_response.is_streaming === false) {
							// End of stream
							// console.log('📡 Stream ended');
							if (completeHandler) {
								completeHandler()
							}
							ipcRenderer.removeListener("grpc-response", streamResponseHandler)
						} else if (response.grpc_response.message) {
							// Streaming data
							// console.log('📡 Streaming data:', response.grpc_response.message);
							if (responseHandler) {
								responseHandler(response.grpc_response.message)
							}
						}
					}
				}

				ipcRenderer.on("grpc-response", streamResponseHandler)

				// Return unsubscribe function
				return () => {
					// console.log('📡 Unsubscribing from stream');
					ipcRenderer.removeListener("grpc-response", streamResponseHandler)
				}
			},
			onError: (handler) => {
				errorHandler = handler
			},
			onComplete: (handler) => {
				completeHandler = handler
			},
		}
	},
})

// Set up standalone mode flag
contextBridge.exposeInMainWorld("__is_standalone__", true)

// Set up standalonePostMessage for VSCode API compatibility
try {
	contextBridge.exposeInMainWorld("standalonePostMessage", (message) => {
		// console.log('📨 standalonePostMessage called with:', message);
		try {
			const parsedMessage = JSON.parse(message)
			ipcRenderer.send("vscode-message", parsedMessage)
		} catch (error) {
			console.error("Error parsing standalone message:", error)
		}
	})
} catch (error) {
	console.warn("standalonePostMessage already exists:", error)
}

// Set up gRPC readiness flag and event handling
let grpcReady = true // Set to true by default for electron mode
try {
	//   console.log('✅ gRPC readiness flag set to true in preload context');
} catch (logErr) {
	// Ignore console errors
}

// Also set global flag for webview
contextBridge.exposeInMainWorld("__grpc_ready__", true)

// Real gRPC communication - no forced state injection

// Message handling from main process is already set up above

// Set up gRPC client for direct communication with Cline server
contextBridge.exposeInMainWorld("clineGrpcClient", {
	address: "127.0.0.1:50051",
	sendMessage: (message) => {
		console.log("Sending message to Cline server:", message)
		// For now, just forward to main process
		ipcRenderer.send("cline-grpc-message", message)
	},
})
