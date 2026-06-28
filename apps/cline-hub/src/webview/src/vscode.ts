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
const browserConnectionKey = "cline-hub-browser-connection";

type BrowserConnectionTarget = {
	bridgeUrl?: string;
	roomSecret?: string;
};

function dispatchHostMessage(message: WebviewOutboundMessage): void {
	window.dispatchEvent(new MessageEvent("message", { data: message }));
}

function readFragmentParams(): URLSearchParams {
	return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function readPersistedBrowserConnection(): BrowserConnectionTarget {
	try {
		const raw = window.localStorage.getItem(browserConnectionKey);
		return raw ? (JSON.parse(raw) as BrowserConnectionTarget) : {};
	} catch {
		return {};
	}
}

export function readBrowserConnectionTarget(): BrowserConnectionTarget {
	if (typeof window === "undefined") return {};
	const fragment = readFragmentParams();
	const search = new URLSearchParams(window.location.search);
	const persisted = readPersistedBrowserConnection();
	return {
		bridgeUrl:
			fragment.get("bridgeUrl")?.trim() ||
			fragment.get("bridge")?.trim() ||
			search.get("bridgeUrl")?.trim() ||
			persisted.bridgeUrl,
		roomSecret:
			fragment.get("roomSecret")?.trim() ||
			search.get("roomSecret")?.trim() ||
			persisted.roomSecret,
	};
}

export function writeBrowserConnectionTarget(
	target: BrowserConnectionTarget,
): void {
	if (typeof window === "undefined") return;
	const next = {
		...readPersistedBrowserConnection(),
		...target,
	};
	try {
		window.localStorage.setItem(browserConnectionKey, JSON.stringify(next));
	} catch {
		// Browser persistence is best-effort.
	}
}

function resolveBrowserSocketUrl(): string {
	const target = readBrowserConnectionTarget();
	const bridgeUrl = target.bridgeUrl?.trim();
	if (bridgeUrl || target.roomSecret?.trim()) {
		writeBrowserConnectionTarget({
			bridgeUrl,
			roomSecret: target.roomSecret?.trim(),
		});
	}
	const base = bridgeUrl ? new URL(bridgeUrl) : new URL(window.location.href);
	const protocol =
		base.protocol === "https:"
			? "wss:"
			: base.protocol === "http:"
				? "ws:"
				: "";
	if (!protocol) {
		throw new Error(`Unsupported dashboard bridge protocol: ${base.protocol}`);
	}
	base.protocol = protocol;
	base.pathname = "/browser";
	base.search = "";
	base.hash = "";
	if (target.roomSecret?.trim()) {
		base.searchParams.set("roomSecret", target.roomSecret.trim());
	}
	return base.toString();
}

function createBrowserSocket(): WebSocket {
	if (
		browserSocket &&
		(browserSocket.readyState === WebSocket.OPEN ||
			browserSocket.readyState === WebSocket.CONNECTING)
	) {
		return browserSocket;
	}

	browserSocket = new WebSocket(resolveBrowserSocketUrl());
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
