import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
	BROWSE_PAGE_SIZE,
	type BrowseRequest,
	type BrowseResult,
	type DeviceContext,
} from "@cline/device";
import type { HubCommandName, HubReplyEnvelope } from "@cline/shared";

export interface DeviceModel {
	provider: string;
	model: string;
}
interface NavigationOptions {
	command(
		name: HubCommandName,
		payload?: Record<string, unknown>,
		session?: string,
	): Promise<HubReplyEnvelope>;
	models(): Promise<DeviceModel[]>;
	workspace?: string;
}
const keyFor = (value: string) =>
	createHash("sha256").update(value).digest("hex").slice(0, 24);
// The Cardputer font is ASCII. Normalize display text without altering stored IDs/content.
const display = (value: string) => value.replace(/[^\x20-\x7e\n]/g, "?");
const label = (value: string) =>
	display(value).replace(/\s+/g, " ").slice(0, 52);
const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** Host-owned navigation; each socket supplies its own selected context. */
export class DeviceNavigation {
	constructor(private readonly options: NavigationOptions) {}
	private readonly loading = new Map<string, Promise<void>>();
	private ensureLoaded(sessionId: string): Promise<void> {
		const existing = this.loading.get(sessionId);
		if (existing) return existing;
		const pending = this.loadSession(sessionId).finally(() =>
			this.loading.delete(sessionId),
		);
		this.loading.set(sessionId, pending);
		return pending;
	}
	private async loadSession(sessionId: string): Promise<void> {
		const reply = await this.options.command("session.get", {}, sessionId);
		if (reply.payload?.loaded !== true) {
			const saved = record(reply.payload?.session);
			const metadata = record(saved.metadata);
			const runtime = record(saved.runtimeOptions);
			const messages = await this.options.command(
				"session.messages",
				{},
				sessionId,
			);
			if (
				!Array.isArray(messages.payload?.messages) ||
				!messages.payload.messages.length
			)
				throw new Error("This saved session has no conversation to resume");
			if (
				typeof metadata.provider !== "string" ||
				typeof metadata.model !== "string"
			)
				throw new Error(
					"This session has no saved provider/model; start a new task",
				);
			await this.options.command("session.create", {
				workspaceRoot: saved.workspaceRoot,
				cwd: saved.cwd,
				sessionConfig: {
					...runtime,
					sessionId,
					providerId: metadata.provider,
					modelId: metadata.model,
					cwd: saved.cwd,
					workspaceRoot: saved.workspaceRoot,
				},
				metadata: { ...metadata, interactive: true },
				runtimeOptions: runtime,
				initialMessages: messages.payload.messages,
			});
		}
	}

	private async sessions() {
		const reply = await this.options.command("session.list", {
			limit: 1000,
			rootOnly: true,
		});
		return (
			Array.isArray(reply.payload?.sessions) ? reply.payload.sessions : []
		)
			.map((value) => {
				const row = record(value);
				return record(row.session ?? row);
			})
			.filter((row) => typeof row.sessionId === "string")
			.sort(
				(a, b) =>
					Number(b.updatedAt ?? b.createdAt ?? 0) -
					Number(a.updatedAt ?? a.createdAt ?? 0),
			);
	}
	async browse(
		request: BrowseRequest,
		context: DeviceContext,
	): Promise<BrowseResult> {
		const result: BrowseResult = {
			t: "browse",
			id: request.id,
			title: request.kind,
			page: request.page ?? 0,
			more: false,
			items: [],
		};
		if (request.kind === "history") {
			const reply = await this.options.command(
				"session.messages",
				{},
				request.key,
			);
			const messages = Array.isArray(reply.payload?.messages)
				? reply.payload.messages
				: [];
			const text = messages
				.map((value) => {
					const msg = record(value);
					if (msg.role !== "user" && msg.role !== "assistant") return "";
					const content =
						typeof msg.content === "string"
							? msg.content
							: Array.isArray(msg.content)
								? msg.content
										.map((block) => {
											const b = record(block);
											return b.type === "text" && typeof b.text === "string"
												? b.text
												: "";
										})
										.filter(Boolean)
										.join("\n")
								: "";
					return content
						? `${msg.role === "user" ? "You" : "Cline"}: ${content}`
						: "";
				})
				.filter(Boolean)
				.join("\n\n");
			const shown = display(text).replace(/\n{3,}/g, "\n\n");
			const lines = shown
				.split("\n")
				.flatMap((line) =>
					line.length ? (line.match(/.{1,28}/g) ?? []) : [""],
				);
			const start = result.page * 5;
			result.title = "Session history";
			result.text =
				lines.slice(start, start + 5).join("\n") || "No messages on this page";
			result.more = lines.length > start + 5;
			return result;
		}
		let items: Array<{
			key: string;
			label: string;
			value: string | DeviceModel;
		}>;
		if (request.kind === "models") {
			items = (await this.options.models()).map((value) => ({
				key: keyFor(`${value.provider}\0${value.model}`),
				label: label(`${value.provider}: ${value.model}`),
				value,
			}));
		} else {
			const sessions = await this.sessions();
			if (request.kind === "sessions") {
				items = sessions.map((row) => ({
					key: String(row.sessionId),
					label: label(
						String(
							record(row.metadata).title ??
								record(row.metadata).prompt ??
								row.sessionId,
						),
					),
					value: String(row.sessionId),
				}));
			} else {
				const paths = new Set<string>();
				if (this.options.workspace) paths.add(this.options.workspace);
				for (const row of sessions) {
					const path = row.cwd ?? row.workspaceRoot;
					if (typeof path === "string" && path) paths.add(path);
				}
				items = [...paths].map((value) => ({
					key: keyFor(value),
					label: label(`${basename(value)} (${value})`),
					value,
				}));
			}
		}
		result.title =
			request.kind === "models"
				? "Model for new tasks"
				: request.kind === "workspaces"
					? "Workspace for new tasks"
					: "Recent sessions";
		if (request.select) {
			const item = items.find((item) => item.key === request.key);
			if (!item)
				throw new Error("Selection is no longer available; refresh the list");
			if (request.kind === "sessions") {
				const sessionId = item.value as string;
				await this.ensureLoaded(sessionId);
				context.session = sessionId;
			} else {
				if (request.kind === "models")
					context.model = item.value as DeviceModel;
				else context.workspace = item.value as string;
				delete context.session;
			}
			result.selected = true;
			result.text = `Selected: ${item.label}`;
			return result;
		}
		const start = result.page * BROWSE_PAGE_SIZE;
		result.items = items
			.slice(start, start + BROWSE_PAGE_SIZE)
			.map(({ key, label }) => ({ key, label }));
		result.more = items.length > start + BROWSE_PAGE_SIZE;
		if (!result.items.length) result.text = "No entries available";
		return result;
	}
}
