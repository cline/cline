"use client";

import type { WebviewOutboundMessage } from "../../../webview-protocol";
import { postToHost } from "../vscode";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 120_000;

class HubDesktopClient {
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();

	constructor() {
		if (typeof window !== "undefined") {
			window.addEventListener("message", (event) => {
				this.handleMessage(event as MessageEvent<WebviewOutboundMessage>);
			});
		}
	}

	private handleMessage(event: MessageEvent<WebviewOutboundMessage>) {
		const message = event.data;
		if (
			!message ||
			typeof message !== "object" ||
			message.type !== "desktopCommandResult"
		) {
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeoutId);
		this.pending.delete(message.id);
		if (message.ok) {
			pending.resolve(message.result);
			return;
		}
		pending.reject(new Error(message.error));
	}

	async invoke<T>(
		command: string,
		args?: Record<string, unknown>,
	): Promise<T> {
		const id = `desktop_${Date.now()}_${this.requestCounter++}`;
		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for desktop command: ${command}`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timeoutId,
			});
			postToHost({ type: "desktopCommand", id, command, args });
		});
	}
}

export const desktopClient = new HubDesktopClient();
