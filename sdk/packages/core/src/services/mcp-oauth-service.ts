import { isDeepStrictEqual } from "node:util";
import type { HubMcpOAuthSnapshot } from "@cline/shared";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import {
	parseMcpServerRegistration,
	resolveMcpServerRegistration,
	updateMcpSettingsFile,
} from "../extensions/mcp/config-loader";
import { authorizeMcpServerOAuth } from "../extensions/mcp/oauth";
import type { McpServerRegistration } from "../extensions/mcp/types";

type Reason =
	| "user"
	| "changed"
	| "superseded"
	| "disconnected"
	| "shutdown"
	| "expired";
type Attempt = {
	id: string;
	owner: string;
	name: string;
	controller: AbortController;
	reason?: Reason;
	urls: string[];
	result?: { name: string; authorized: true };
	error?: { code: string; message: string };
	wake?: () => void;
	run?: Promise<void>;
	registration?: McpServerRegistration;
};
type Queue = <T>(operation: () => Promise<T>) => Promise<T>;

/** Owns interactive authorization independently of Desktop viewers. URLs never enter the event log. */
export class McpOAuthService {
	private attempts = new Map<string, Attempt>();
	private runs = new Set<Promise<void>>();
	constructor(private queue: Queue) {}
	get activeCount() {
		return this.runs.size;
	}
	start(owner: string, id: string, name: string) {
		if (this.attempts.has(id))
			throw new Error("OAuth login id is already in use");
		const previous = [...this.attempts.values()].filter(
			(entry) => entry.name === name && entry.run && this.runs.has(entry.run),
		);
		this.cancelServer(name, "superseded");
		const entry: Attempt = {
			id,
			owner,
			name,
			controller: new AbortController(),
			urls: [],
		};
		this.attempts.set(id, entry);
		const timer = setTimeout(() => this.abort(entry, "expired"), 10 * 60_000);
		timer.unref?.();
		const signal = entry.controller.signal;
		const run: Promise<void> = (async () => {
			// Retire the old callback listener before binding the same fixed port again.
			await Promise.allSettled(previous.map((entry) => entry.run));
			await this.queue(async () => {
				signal.throwIfAborted();
				const registration = resolveMcpServerRegistration(name, {
					filePath: resolveMcpSettingsPath(),
				});
				if (!registration) throw new Error(`unknown MCP server: ${name}`);
				if (registration.transport.type === "stdio")
					throw new Error("MCP stdio servers do not support browser OAuth");
				entry.registration = registration;
				await this.writeEnabled(entry, false);
			});
			signal.throwIfAborted();
			await authorizeMcpServerOAuth({
				serverName: name,
				filePath: resolveMcpSettingsPath(),
				signal,
				openUrl: (url) => {
					signal.throwIfAborted();
					if (entry.urls.length >= 20)
						throw new Error("OAuth interaction queue is full");
					entry.urls.push(url);
					entry.wake?.();
				},
			});
			await this.queue(async () => {
				signal.throwIfAborted();
				await this.writeEnabled(entry, true);
			});
			entry.result = { name, authorized: true };
		})()
			.catch(async (error) => {
				if (entry.reason === "user" && entry.registration?.disabled !== true) {
					await this.queue(async () => {
						if (entry.reason === "user")
							await this.writeEnabled(entry, true, true);
					}).catch(() => undefined);
				}
				entry.error = {
					code:
						signal.aborted && entry.reason !== "expired"
							? "mcp_oauth_cancelled"
							: "mcp_oauth_failed",
					message: error instanceof Error ? error.message : String(error),
				};
			})
			.finally(() => {
				clearTimeout(timer);
				this.runs.delete(run);
				entry.wake?.();
				const expiry = setTimeout(() => {
					if (this.attempts.get(id) === entry) this.attempts.delete(id);
				}, 60_000);
				expiry.unref?.();
			});
		entry.run = run;
		this.runs.add(run);
		return { loginId: id };
	}
	private async writeEnabled(
		entry: Attempt,
		enabled: boolean,
		restoring = false,
	) {
		const expected = entry.registration;
		if (!expected) return;
		await updateMcpSettingsFile(resolveMcpSettingsPath(), (settings) => {
			if (!restoring) entry.controller.signal.throwIfAborted();
			else if (entry.reason !== "user") return;
			const servers = settings.mcpServers as Record<string, unknown>;
			const current = Object.hasOwn(servers, entry.name)
				? servers[entry.name]
				: undefined;
			if (!current || typeof current !== "object") {
				if (restoring) return;
				throw new Error("MCP server was removed during authorization");
			}
			const registration = parseMcpServerRegistration(entry.name, current);
			if (
				!isDeepStrictEqual(registration.transport, expected.transport) ||
				!isDeepStrictEqual(registration.oauthClient, expected.oauthClient)
			) {
				if (restoring) return;
				throw new Error("MCP server changed during authorization");
			}
			servers[entry.name] = { ...current, disabled: !enabled };
		});
	}
	private owned(owner: string, id: string) {
		const entry = this.attempts.get(id);
		if (!entry || entry.owner !== owner)
			throw new Error("OAuth login does not belong to this client");
		return entry;
	}
	async next(owner: string, id: string): Promise<HubMcpOAuthSnapshot> {
		const entry = this.owned(owner, id);
		if (entry.wake) throw new Error("Only one OAuth poll may be pending");
		if (!entry.urls.length && !entry.result && !entry.error)
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					entry.wake = undefined;
					resolve();
				}, 25_000);
				entry.wake = () => {
					clearTimeout(timer);
					entry.wake = undefined;
					resolve();
				};
			});
		return {
			urls: entry.urls.splice(0),
			result: entry.result,
			error: entry.error,
		};
	}
	private abort(entry: Attempt, reason: Reason) {
		if (!entry.run || !this.runs.has(entry.run)) return false;
		// A late viewer cancellation must not restore a server disabled/edited
		// by another command while the aborted network request is cleaning up.
		if (entry.controller.signal.aborted && reason === "user") return false;
		entry.reason = reason;
		entry.urls.length = 0;
		entry.controller.abort(new Error(`MCP authorization cancelled: ${reason}`));
		// Let cleanup/restoration settle before reporting completion to the viewer.
		return true;
	}
	cancel(owner: string, id: string, reason: "user" | "disconnected") {
		return { cancelled: this.abort(this.owned(owner, id), reason) };
	}
	cancelServer(name: string, reason: Reason = "changed") {
		for (const entry of this.attempts.values())
			if (entry.name === name) this.abort(entry, reason);
	}
	cancelOwner(owner: string) {
		for (const entry of this.attempts.values())
			if (entry.owner === owner) this.abort(entry, "disconnected");
	}
	async dispose() {
		for (const entry of this.attempts.values()) this.abort(entry, "shutdown");
		await Promise.allSettled(this.runs);
		this.attempts.clear();
	}
}
