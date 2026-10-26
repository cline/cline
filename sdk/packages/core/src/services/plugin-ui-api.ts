import type {
	PluginUiGetInput,
	PluginUiInvokeInput,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
	PluginUiViewer,
} from "@cline/shared";

/**
 * What hosts call to read and act on plugin UI slots: `ClineCore.pluginUi`,
 * and the hub runtime host and session client. Never throws: a missing
 * session or slot comes back as `[]` or `{ outcome: "unavailable" }`.
 */
export interface PluginUiApi {
	get(input: PluginUiGetInput): Promise<PluginUiStateEnvelope[]>;
	invoke(input: PluginUiInvokeInput): Promise<PluginUiInvokeResult>;
}

/** The runtime side (`LocalRuntimeHost`). The hub passes the viewer and connection it stamped. */
export interface PluginUiHostApi extends PluginUiApi {
	invoke(
		input: PluginUiInvokeInput,
		viewer?: PluginUiViewer,
		connectionId?: string,
	): Promise<PluginUiInvokeResult>;
	/** Synthesizes a `detach` for every session this viewer attached to through `connectionId` (every session without one). */
	detachViewer(viewerId: string, connectionId?: string): void;
}

export interface PluginUiRuntimeService {
	readonly pluginUi: PluginUiApi;
}

export interface PluginUiHostRuntimeService {
	readonly pluginUi: PluginUiHostApi;
}
