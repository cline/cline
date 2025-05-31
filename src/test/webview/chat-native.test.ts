import * as vscode from "vscode"
import { describe, it, beforeEach, afterEach } from "mocha"
import { strict as assert } from "assert"
describe("Chat Integration Tests", () => {
	let panel: vscode.WebviewPanel
	let disposables: vscode.Disposable[] = []

	beforeEach(async () => {
		// Create VSCode webview panel
		panel = vscode.window.createWebviewPanel("testWebview", "Chat Test", vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
		})

		// Set up minimal test webview
		panel.webview.html = `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <script>
                        const vscode = acquireVsCodeApi();
                        window.addEventListener('message', event => {
                            const message = event.data;
                            switch (message.type) {
                                case 'sendMessage':
                                    vscode.postMessage({ type: 'newTask', text: message.text });
                                    break;
                                case 'toggleMode':
                                    vscode.postMessage({
                                        type: 'togglePlanActMode',
                                        chatSettings: { mode: 'act' }, 
                                        chatContent: {
                                            message: "message test",
                                        }
                                    });
                                    break;
                                case 'primaryButtonClick':
                                    vscode.postMessage({ 
                                        type: 'grpc_request',
                                        grpc_request: {
                                            service: 'cline.TaskService',
                                            method: 'askResponse',
                                            message: {
                                                responseType: 'yesButtonClicked'
                                            },
                                            request_id: 'test-request-id',
                                            is_streaming: false
                                        }
                                    });
                                    break;
                            }
                        });
                    </script>
                </head>
                <body>
                    <div id="test-webview"></div>
                </body>
            </html>
        `
	})

	afterEach(() => {
		panel.dispose()
		disposables.forEach((d) => d.dispose())
		disposables = []
	})

	it("should send chat messages", async () => {
		// Set up message listener
		const messagePromise = new Promise<any>((resolve) => {
			panel.webview.onDidReceiveMessage((message) => {
				if (message.type === "newTask") {
					resolve(message)
				}
			})
		})

		// Trigger send message
		await panel.webview.postMessage({
			type: "sendMessage",
			text: "Create a hello world app",
		})

		// Verify message was sent
		const message = await messagePromise
		assert.equal(message.type, "newTask")
		assert.equal(message.text, "Create a hello world app")
	})

	it("should toggle between plan and act modes", async () => {
		// Set up state change listener
		const stateChangePromise = new Promise<any>((resolve) => {
			panel.webview.onDidReceiveMessage((message) => {
				if (message.type === "togglePlanActMode") {
					resolve(message)
				}
			})
		})

		// Trigger mode toggle
		await panel.webview.postMessage({ type: "toggleMode" })

		// Verify mode changed
		const stateChange = await stateChangePromise
		assert.equal(stateChange.chatSettings.mode, "act")
	})

	it("should toggle between plan and act modes with messages", async () => {
		// Set up state change listener
		const stateChangePromise = new Promise<any>((resolve) => {
			panel.webview.onDidReceiveMessage((message) => {
				if (message.type === "togglePlanActMode") {
					resolve(message)
				}
			})
		})

		// Trigger mode toggle
		await panel.webview.postMessage({ type: "toggleMode" })

		// Verify mode changed
		const stateChange = await stateChangePromise
		assert.equal(stateChange.chatSettings.mode, "act")
		assert.equal(stateChange.chatContent.message, "message test")
	})

	it("should handle tool approval flow", async () => {
		// Set up approval listener for gRPC request
		const approvalPromise = new Promise<any>((resolve) => {
			panel.webview.onDidReceiveMessage((message) => {
				if (
					message.type === "grpc_request" &&
					message.grpc_request?.service === "cline.TaskService" &&
					message.grpc_request?.method === "askResponse"
				) {
					resolve(message)
				}
			})
		})

		// Trigger tool approval
		await panel.webview.postMessage({
			type: "primaryButtonClick",
		})

		// Verify gRPC request was sent with correct parameters
		const response = await approvalPromise
		assert.equal(response.type, "grpc_request")
		assert.equal(response.grpc_request.service, "cline.TaskService")
		assert.equal(response.grpc_request.method, "askResponse")
		assert.equal(response.grpc_request.message.responseType, "yesButtonClicked")
	})
})
