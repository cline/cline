import type {
	WebviewInboundMessage,
	WebviewOutboundMessage,
} from "../../webview-protocol";

type VsCodeApi = {
	postMessage(message: WebviewInboundMessage): void;
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

export function postToHost(message: WebviewInboundMessage): void {
	getVsCodeApi()?.postMessage(message);
}

export type { WebviewOutboundMessage };
