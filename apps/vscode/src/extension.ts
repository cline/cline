// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import * as vscode from "vscode"
import type { ExtensionContext } from "vscode"
import {
	HostProvider,
	type CommentReviewControllerCreator,
	type DiffViewProviderCreator,
	type TerminalManagerCreator,
} from "@/hosts/host-provider"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"
import { Logger } from "@/shared/services/Logger"
import { createStorageContext } from "@/shared/storage/storage-context"
import { initialize, tearDown } from "./common"
import { registerClineOutputChannel } from "./hosts/vscode/hostbridge/env/debugLog"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider"
import "./utils/path" // necessary to have access to String.prototype.toPosix

// This method is called when the VS Code extension is activated.
//
// MINIMAL INERT SHELL: activation only wires up the bare minimum needed to make
// the webview UI render and route gRPC requests from the webview to the
// Controller. All heavy features (commit-message generation, terminal manager,
// diff providers, review controller, hooks, storage migrations, auth, telemetry,
// test mode, URI handlers, account events, code-action commands, etc.) have been
// removed.
export async function activate(context: vscode.ExtensionContext) {
	const activationStartTime = performance.now()

	// 1. Set up HostProvider for VSCode
	// IMPORTANT: This must be done before any service can be registered.
	setupHostProvider(context)

	// 2. Build the storage context (file-backed shared stores under ~/.cline/data/).
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	const storageContext = createStorageContext({ workspacePath })

	// 3. Perform common initialization and create the webview provider.
	const webview = (await initialize(storageContext)) as VscodeWebviewProvider

	// 4. Register the sidebar webview provider so the UI renders.
	//    gRPC routing from the webview to the Controller is handled inside
	//    VscodeWebviewProvider.handleWebviewMessage().
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VscodeWebviewProvider.SIDEBAR_ID, webview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	Logger.log(`[Cline] extension activated in ${performance.now() - activationStartTime} ms`)
}

function setupHostProvider(context: ExtensionContext) {
	const outputChannel = registerClineOutputChannel(context)
	outputChannel.appendLine("[Cline] Setting up VS Code host...")

	const createWebview = () => new VscodeWebviewProvider(context)

	// These host-specific providers belong to deleted feature areas (diff view,
	// comment review, terminal). The inert shell never invokes them, but the
	// HostProvider signature still requires creators, so we supply throwing stubs.
	const createDiffView = (() => {
		throw new Error("removed")
	}) as DiffViewProviderCreator
	const createCommentReview = (() => {
		throw new Error("removed")
	}) as CommentReviewControllerCreator
	const createTerminalManager = (() => {
		throw new Error("removed")
	}) as TerminalManagerCreator

	const getCallbackUrl = async (path: string, _preferredPort?: number) => {
		const scheme = vscode.env.uriScheme || "vscode"
		const callbackUri = vscode.Uri.parse(`${scheme}://${context.extension.id}${path}`)

		if (vscode.env.uiKind === vscode.UIKind.Web) {
			const externalUri = await vscode.env.asExternalUri(callbackUri)
			return externalUri.toString(true)
		}

		return callbackUri.toString(true)
	}

	const getBinaryLocation = async (name: string): Promise<string> => {
		throw new Error(`Binary '${name}' is not supported`)
	}

	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		vscodeHostBridgeClient,
		() => {}, // No-op logger, logging is handled via HostProvider.env.debugLog
		getCallbackUrl,
		getBinaryLocation,
		context.extensionUri.fsPath,
		context.globalStorageUri.fsPath,
	)
}

// This method is called when your extension is deactivated.
export async function deactivate() {
	await tearDown()
}
