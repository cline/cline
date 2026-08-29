import type {
	UiInboundMessage,
	UiOutboundMessage,
} from "@cline/shared";

type VsCodeApi = {
	postMessage(message: UiInboundMessage): void;
	getState(): unknown;
	setState(state: unknown): void;
};

declare global {
	interface Window {
		acquireVsCodeApi?: () => VsCodeApi;
	}
}

let cachedApi: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi | undefined {
	if (cachedApi) {
		return cachedApi;
	}
	if (typeof window.acquireVsCodeApi !== "function") {
		return undefined;
	}
	cachedApi = window.acquireVsCodeApi();
	return cachedApi;
}

export function postToHost(message: UiInboundMessage): void {
	getVsCodeApi()?.postMessage(message);
}

export type { UiOutboundMessage };
