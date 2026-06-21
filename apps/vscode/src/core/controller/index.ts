// MINIMAL INERT CONTROLLER
//
// The full Controller (Task loop, providers, models, sessions, MCP, hooks,
// services, SDK bridge, storage) has been removed. This is a bare, constructable
// shell that exists only so the surviving plumbing keeps compiling and running:
//
//   - core/webview/WebviewProvider.ts   -> `new Controller(context)` + `dispose()`
//   - core/controller/grpc-handler.ts   -> uses `Controller` as a type only
//   - core/controller/grpc-recorder/**  -> uses `Controller` as a type; test-hooks
//                                          calls getLatestState -> getStateToPostToWebview()
//   - core/controller/<group>/*.ts      -> gutted handlers reference these members
//
// Every member here is a no-op / empty-default. Nothing actually works.

import type { ExtensionState } from "@shared/ExtensionMessage"
import { ClineExtensionContext } from "@/shared/cline"

export class Controller {
	readonly context: ClineExtensionContext

	// Inert state holders that gutted handlers may read. They are deliberately
	// typed loosely (`any`) because their real backing implementations were removed.
	readonly stateManager: any = createInertStateManager()
	task: any = undefined
	accountService: any = undefined
	terminalManager: any = undefined
	workspaceManager: any = undefined
	backgroundCommandRunning?: boolean = false
	backgroundCommandTaskId?: string = undefined

	constructor(context: ClineExtensionContext) {
		this.context = context
	}

	async dispose(): Promise<void> {
		// no-op: nothing to tear down in the inert shell
	}

	// --- state ---

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// The inert shell has no real state to build.
		return {} as unknown as ExtensionState
	}

	async postStateToWebview(): Promise<void> {
		// no-op
	}

	// --- providers / models ---

	getProviderCatalog(): any {
		return createInertProviderCatalog()
	}

	getProviderConfigStore(): any {
		return createInertProviderConfigStore()
	}

	async handleApiConfigurationChanged(_previous?: any, _next?: any): Promise<void> {
		// no-op
	}

	async readOpenRouterModels(): Promise<any> {
		return undefined
	}

	// --- task ---

	async initTask(_text?: string, _images?: string[], _files?: string[], _historyItem?: any, _settings?: any): Promise<void> {
		// no-op
	}

	async showTaskWithId(_id: string): Promise<void> {
		// no-op
	}

	async exportTaskWithId(_id: string): Promise<void> {
		// no-op
	}

	async getTaskHistory(_request?: any): Promise<any> {
		return undefined
	}

	async toggleTaskFavorite(_taskId: string, _isFavorited: boolean): Promise<void> {
		// no-op
	}

	async editMessageAndRegenerate(..._args: any[]): Promise<void> {
		// no-op
	}

	// --- mode / telemetry ---

	async togglePlanActMode(_mode?: any, _chatContent?: any): Promise<any> {
		return undefined
	}

	async updateTelemetrySetting(_setting?: any): Promise<void> {
		// no-op
	}
}

function createInertStateManager(): any {
	return {
		getApiConfiguration: () => ({}),
		getGlobalStateKey: (_key: string) => undefined,
		getGlobalSettingsKey: (_key: string) => undefined,
		getSecretKey: (_key: string) => undefined,
		setGlobalState: (_key: string, _value: unknown) => {},
		setGlobalStateBatch: (_values: unknown) => {},
		setSecretsBatch: (_values: unknown) => {},
		setApiConfiguration: (_config: unknown) => {},
		setTaskSettings: (_settings: unknown) => {},
		setTaskSettingsBatch: (_settings: unknown) => {},
		flushPendingState: async () => {},
	}
}

function createInertProviderCatalog(): any {
	return {
		listProviders: async () => [],
		resolveModels: async () => ({}),
	}
}

function createInertProviderConfigStore(): any {
	return {
		read: (_id: unknown) => ({}),
		commitSelection: (_id: unknown, _mode: unknown, _selection: unknown) => {},
	}
}
