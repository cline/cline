import type { Message, ToolDefinition } from "@clinebot/shared";
import type { ApiStream } from "../../types";
import { retryStream } from "../../utils/retry";
import { BaseHandler } from "./base-handler";

type JsonRecord = Record<string, unknown>;

export abstract class FetchBaseHandler extends BaseHandler {
	readonly type = "fetch";
	protected abstract getDefaultBaseUrl(): string;

	getMessages(systemPrompt: string, messages: Message[]): unknown {
		return {
			systemPrompt,
			messages,
		};
	}

	protected getBaseUrl(): string {
		return this.config.baseUrl?.trim() || this.getDefaultBaseUrl();
	}

	protected getJsonHeaders(
		extra?: Record<string, string>,
	): Record<string, string> {
		return {
			"Content-Type": "application/json",
			...this.getRequestHeaders(),
			...(extra ?? {}),
		};
	}

	protected async fetchJson<T>(
		path: string,
		init: {
			method?: string;
			body?: JsonRecord;
			headers?: Record<string, string>;
		},
	): Promise<T> {
		const response = await fetch(`${this.getBaseUrl()}${path}`, {
			method: init.method ?? "POST",
			headers: this.getJsonHeaders(init.headers),
			body: init.body ? JSON.stringify(init.body) : undefined,
			signal: this.getAbortSignal(),
		});
		if (!response.ok) {
			const details = await response.text();
			throw new Error(`HTTP ${response.status}: ${details}`);
		}
		return (await response.json()) as T;
	}

	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		void tools;
		yield* retryStream(() =>
			this.createMessageWithFetch(systemPrompt, messages),
		);
	}

	protected abstract createMessageWithFetch(
		systemPrompt: string,
		messages: Message[],
	): ApiStream;
}
