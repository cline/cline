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
let browserSocket: WebSocket | undefined;
const pendingMessages: WebviewInboundMessage[] = [];
const stateKey = "cline-hub-webview-state";

function dispatchHostMessage(message: WebviewOutboundMessage): void {
	window.dispatchEvent(new MessageEvent("message", { data: message }));
}

function createBrowserSocket(): WebSocket {
	if (
		browserSocket &&
		(browserSocket.readyState === WebSocket.OPEN ||
			browserSocket.readyState === WebSocket.CONNECTING)
	) {
		return browserSocket;
	}

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const params = new URLSearchParams();
	const roomSecret = new URLSearchParams(window.location.search)
		.get("roomSecret")
		?.trim();
	if (roomSecret) {
		params.set("roomSecret", roomSecret);
	}
	const query = params.toString();
	const socketUrl = `${protocol}//${window.location.host}/browser${query ? `?${query}` : ""}`;
	browserSocket = new WebSocket(socketUrl);
	browserSocket.addEventListener("open", () => {
		for (const message of pendingMessages.splice(0)) {
			browserSocket?.send(JSON.stringify(message));
		}
	});
	browserSocket.addEventListener("message", (event) => {
		try {
			const message = JSON.parse(String(event.data)) as WebviewOutboundMessage;
			dispatchHostMessage(message);
		} catch {
			pendingMessages.splice(0);
			dispatchHostMessage({
				type: "error",
				text: "Received an invalid message from the Cline Hub server.",
			});
		}
	});
	browserSocket.addEventListener("close", () => {
		pendingMessages.splice(0);
		dispatchHostMessage({
			type: "status",
			text: "Disconnected from the Cline Hub server.",
		});
	});
	browserSocket.addEventListener("error", () => {
		pendingMessages.splice(0);
		dispatchHostMessage({
			type: "error",
			text: "Failed to connect to the Cline Hub server.",
		});
	});
	return browserSocket;
}

function createBrowserApi(): VsCodeApi {
	return {
		postMessage(message) {
			const socket = createBrowserSocket();
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify(message));
				return;
			}
			pendingMessages.push(message);
		},
		getState() {
			try {
				const raw = window.localStorage.getItem(stateKey);
				return raw ? JSON.parse(raw) : undefined;
			} catch {
				return undefined;
			}
		},
		setState(state) {
			try {
				window.localStorage.setItem(stateKey, JSON.stringify(state ?? {}));
			} catch {
				// Browser persistence is best-effort.
			}
		},
	};
}

export function getVsCodeApi(): VsCodeApi | undefined {
	if (cachedApi) {
		return cachedApi;
	}
	if (typeof window.acquireVsCodeApi === "function") {
		cachedApi = window.acquireVsCodeApi();
		return cachedApi;
	}
	cachedApi = createBrowserApi();
	return cachedApi;
}

export function postToHost(message: WebviewInboundMessage): void {
	getVsCodeApi()?.postMessage(message);
}

export type { WebviewOutboundMessage };
