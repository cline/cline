import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type CursorComposer,
	CursorStore,
	cursorUriPath,
	readWorkspaceComposerIndex,
	unwrapCursorUserText,
	workspaceFolder,
} from "./cursor-db";
import { cursorUserDir } from "./paths";
import {
	type ConvertedImportedSession,
	type ImportableSessionSummary,
	type SessionImportAdapter,
	truncateForDisplay,
} from "./types";

export interface CursorAdapterOptions {
	/**
	 * Cursor's user data dir. Defaults to `%APPDATA%/Cursor/User`,
	 * `~/Library/Application Support/Cursor/User`, or
	 * `$XDG_CONFIG_HOME/Cursor/User` (falling back to `~/.config/Cursor/User`).
	 */
	userDir?: string;
}

export function cursorProviderForModel(model: string): string {
	const slug = model.toLowerCase();
	if (slug.startsWith("claude")) return "anthropic";
	if (slug.startsWith("gpt") || /^o\d/.test(slug)) return "openai-native";
	if (slug.startsWith("gemini")) return "gemini";
	return "cursor";
}

const untitled = (name?: string, fallback?: string) =>
	truncateForDisplay(name, 120) ??
	truncateForDisplay(fallback, 120) ??
	"Untitled session";

export class CursorImportAdapter implements SessionImportAdapter {
	readonly tool = "cursor" as const;
	private readonly dbPath: string;
	private readonly workspaceStorageDir: string;

	private store?: CursorStore;
	private storeError?: Error;
	private composerIndex?: Map<string, CursorComposer>;
	private workspaceIndex?: Map<string, string>;

	constructor(options: CursorAdapterOptions = {}) {
		const userDir = options.userDir ?? cursorUserDir();
		this.dbPath = join(userDir, "globalStorage", "state.vscdb");
		this.workspaceStorageDir = join(userDir, "workspaceStorage");
	}

	isInstalled(): boolean {
		return existsSync(this.dbPath);
	}

	dispose(): void {
		const store = this.store;
		this.store = undefined;
		this.storeError = undefined;
		this.composerIndex = undefined;
		this.workspaceIndex = undefined;
		store?.close();
	}

	discover(): ImportableSessionSummary[] {
		const composers = this.composers();
		this.throwIfStoreFailed();
		const out: ImportableSessionSummary[] = [];
		for (const composer of composers.values()) {
			if (!this.importable(composer)) continue;
			try {
				out.push(this.composerSummary(composer));
			} catch {
				/* skip */
			}
		}
		return out;
	}

	convert(sourceId: string): ConvertedImportedSession {
		const composer = this.composers().get(sourceId.toLowerCase());
		this.throwIfStoreFailed();
		if (composer && this.importable(composer)) {
			return this.convertComposer(composer);
		}
		throw new Error(`Cursor session ${sourceId} not found`);
	}

	private throwIfStoreFailed(): void {
		if (this.storeError) {
			throw new Error("Cursor composer store could not be opened", {
				cause: this.storeError,
			});
		}
	}

	private openStore(): CursorStore | undefined {
		if (this.store || this.storeError || !existsSync(this.dbPath))
			return this.store;
		try {
			const store = new CursorStore(this.dbPath);
			store.read(() => undefined);
			this.store = store;
		} catch (error) {
			this.storeError =
				error instanceof Error ? error : new Error(String(error));
		}
		return this.store;
	}

	private composers(): Map<string, CursorComposer> {
		if (this.composerIndex) return this.composerIndex;
		const index = new Map<string, CursorComposer>();
		const store = this.openStore();
		if (store) {
			try {
				for (const composer of store.listComposers())
					index.set(composer.id.toLowerCase(), composer);
			} catch (error) {
				this.storeError =
					error instanceof Error ? error : new Error(String(error));
			}
		}
		this.composerIndex = index;
		return index;
	}

	private importable(c: CursorComposer): boolean {
		return (
			!c.isSubagent &&
			!c.isDraft &&
			!c.isClaudeCodeMirror &&
			c.headerCount > 0 &&
			c.hasBubbles
		);
	}

	private composerCwd(composer: CursorComposer): string {
		return (
			cursorUriPath(composer.headerUri) ??
			cursorUriPath(composer.uri) ??
			workspaceFolder(this.workspaceStorageDir, composer.workspaceId) ??
			this.workspaceComposerFolder(composer.id) ??
			""
		);
	}

	/** Step 3b: only scans workspace databases when steps 1–3 found nothing. */
	private workspaceComposerFolder(composerId: string): string | undefined {
		this.workspaceIndex ??= readWorkspaceComposerIndex(
			this.workspaceStorageDir,
		);
		return this.workspaceIndex.get(composerId.toLowerCase());
	}

	private composerSummary(composer: CursorComposer): ImportableSessionSummary {
		let fallback: string | undefined;
		if (!composer.name) {
			const store = this.openStore();
			const raw = store?.firstUserText(
				composer.id,
				store.bubbleHeaders(composer.id),
			);
			fallback = raw ? unwrapCursorUserText(raw) : undefined;
		}
		return {
			tool: this.tool,
			sourceId: composer.id,
			sourcePath: this.dbPath,
			title: untitled(composer.name, fallback),
			cwd: this.composerCwd(composer),
			startedAtMs: composer.createdAtMs,
			updatedAtMs: composer.lastUpdatedAtMs ?? composer.createdAtMs,
			messageCount: composer.headerCount,
		};
	}

	private convertComposer(composer: CursorComposer): ConvertedImportedSession {
		const store = this.openStore();
		if (!store) {
			throw new Error("Cursor composer store could not be opened", {
				cause: this.storeError,
			});
		}
		const headers = store.bubbleHeaders(composer.id);
		const conversion = store.convert(
			composer,
			headers,
			unwrapCursorUserText,
			cursorProviderForModel,
		);
		const model = conversion.model ?? "cursor";
		const prompt = truncateForDisplay(conversion.prompt, 2000);
		return {
			tool: this.tool,
			sourceId: composer.id,
			sourcePath: this.dbPath,
			title: untitled(composer.name, conversion.prompt),
			...(prompt ? { prompt } : {}),
			provider: cursorProviderForModel(model),
			model,
			cwd: this.composerCwd(composer) || conversion.workspaceHint || "",
			...(composer.branch ? { gitBranch: composer.branch } : {}),
			startedAtMs: composer.createdAtMs,
			endedAtMs: Math.max(conversion.endedAtMs, composer.lastUpdatedAtMs ?? 0),
			messages: conversion.messages,
		};
	}
}
