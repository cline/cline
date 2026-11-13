import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type BasicLogger,
	FACTORY_BUILT_IN_POLICY,
	FACTORY_CONCURRENCY_DEFAULT,
	FACTORY_CONCURRENCY_MAX,
	FACTORY_CONCURRENCY_MIN,
	type FactoryWorkflowRecipe,
} from "@cline/shared";
import { resolveTasksDbPath } from "@cline/shared/storage";
import { writeFileAtomic } from "../session/stores/atomic-file";
import {
	createFactoryWorkflowRecipe,
	validateFactoryWorkflowRecipe,
} from "./factory-workflow-recipe";

export const FACTORY_DEFAULTS_FILE_NAME = "factory-defaults.json";
/** Beside the defaults file once it was written: its absence is then a deletion. */
const MARKER_SUFFIX = ".written";

/** Rounds and clamps a limit into the supported range. */
export function clampFactoryConcurrency(value: number): number {
	if (!Number.isFinite(value)) return FACTORY_CONCURRENCY_DEFAULT;
	return Math.max(
		FACTORY_CONCURRENCY_MIN,
		Math.min(FACTORY_CONCURRENCY_MAX, Math.round(value)),
	);
}

/** Accepts only an integer within the supported range. */
export function parseFactoryConcurrency(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < FACTORY_CONCURRENCY_MIN ||
		value > FACTORY_CONCURRENCY_MAX
	)
		throw new Error(
			`Factory concurrency must be an integer from ${FACTORY_CONCURRENCY_MIN} to ${FACTORY_CONCURRENCY_MAX}`,
		);
	return value;
}

/**
 * Accepts a positive, finite USD amount up to 100,000, or "no daily limit":
 * `null`, or `0` as its alias, both returned as `null`. To return to the
 * default, send FACTORY_DAILY_COST_DEFAULT_USD.
 */
export function parseFactoryDailyCostUsd(value: unknown): number | null {
	if (value === null || value === 0) return null;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 100_000
	)
		throw new Error(
			"The Factory daily spending limit must be a positive amount in USD (at most 100000), or null (or 0) for no daily limit",
		);
	return value;
}

/** Name of the default workflow served while the stored defaults cannot be read. */
export const FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW_NAME =
	"Factory defaults unavailable";

/**
 * Served as the default workflow when the defaults file is corrupt or holds
 * an invalid workflow: hands-off scoping, but every plan waits for a person,
 * so nothing falls back to the built-in automatic approval.
 */
export const FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW: FactoryWorkflowRecipe =
	createFactoryWorkflowRecipe({
		name: FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW_NAME,
		config: {
			autonomy: FACTORY_BUILT_IN_POLICY.autonomy,
			approval: "required",
			maxCostUsd: FACTORY_BUILT_IN_POLICY.maxCostUsd,
		},
	});

/**
 * The user's Factory defaults held on the Hub: the default workflow (work
 * submitted without its own workflow inherits it) and how many cards may be
 * worked at once. Hosts push them because the Hub cannot read host settings.
 */
export interface FactoryDefaultsStore {
	getDefaultWorkflow(): Promise<FactoryWorkflowRecipe | undefined>;
	/** Validates the recipe first; an invalid one leaves the stored default unchanged. */
	setDefaultWorkflow(workflow: unknown): Promise<FactoryWorkflowRecipe>;
	clearDefaultWorkflow(): Promise<void>;
	/** The stored limit, or undefined when none was ever set. */
	getConcurrency(): Promise<number | undefined>;
	/** Validates (integer 1..8) and stores the limit. */
	setConcurrency(concurrency: unknown): Promise<number>;
	/**
	 * Whether a host ever set or cleared the default workflow on this Hub.
	 * Until then the stored default (or its absence) may be stale.
	 */
	getDefaultsReceived(): Promise<boolean>;
	/** Whether new work is paused; false when never set. */
	getPaused(): Promise<boolean>;
	/** Stores whether new work is paused. */
	setPaused(paused: boolean): Promise<boolean>;
	/**
	 * The stored daily spending limit in USD; null when the person chose no
	 * daily limit; undefined when none was set (the default applies).
	 */
	getDailyCostUsd?(): Promise<number | null | undefined>;
	/** Validates and stores the daily limit; null (or 0) stores "no daily limit". */
	setDailyCostUsd?(value: unknown): Promise<number | null>;
	/** Whether new filings are checked for duplicates; true when never set. */
	getDuplicateCheck?(): Promise<boolean>;
	/** Stores whether new filings are checked for duplicates. */
	setDuplicateCheck?(enabled: boolean): Promise<boolean>;
}

/**
 * Where the default lives beside the task database. An in-memory task
 * database keeps the default in memory as well.
 */
export function resolveFactoryDefaultsPath(
	tasksDbPath?: string,
): string | undefined {
	const dbPath = tasksDbPath ?? resolveTasksDbPath();
	if (dbPath === ":memory:") return undefined;
	return join(dirname(dbPath), FACTORY_DEFAULTS_FILE_NAME);
}

/** Version 1 files hold only `workflow`; both fields are optional. */
interface StoredFactoryDefaults {
	version: 1;
	workflow?: FactoryWorkflowRecipe;
	concurrency?: number;
	/** New work is paused; absent means running. */
	paused?: boolean;
	/** A host set or cleared the default workflow at least once. */
	defaultsReceived?: boolean;
	/**
	 * Hub-wide daily spending limit in USD; null means no daily limit;
	 * absent means the default.
	 */
	dailyCostUsd?: number | null;
	/** The duplicate check is off; absent means on. */
	duplicateCheck?: false;
}

type StoredDefaults = Omit<StoredFactoryDefaults, "version">;

/**
 * A file that exists but cannot be read or parsed, or that was deleted after
 * it was written (a marker file beside it remains), fails closed: new work is
 * paused, no host is assumed to have pushed defaults (so no backlog
 * adoption) and the default workflow requires plan approval, until a host
 * writes settings again. A missing file is simply empty.
 */
export class FileFactoryDefaultsStore implements FactoryDefaultsStore {
	private memory: StoredDefaults = {};
	private writes: Promise<unknown> = Promise.resolve();
	private corruptionLogged = false;

	/** Without a path the defaults are kept in memory only. */
	constructor(
		private readonly path?: string,
		private readonly options: { logger?: BasicLogger } = {},
	) {}

	async getDefaultWorkflow(): Promise<FactoryWorkflowRecipe | undefined> {
		await this.writes.catch(() => undefined);
		const { stored, corrupt } = await this.readState();
		if (corrupt) return FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW;
		// An invalid or outdated workflow must not read as "no default": that
		// would fall back to the built-in automatic approval.
		try {
			return stored.workflow === undefined
				? undefined
				: validateFactoryWorkflowRecipe(stored.workflow);
		} catch (error) {
			this.reportCorruption(
				`the stored default workflow is invalid (${error instanceof Error ? error.message : String(error)})`,
			);
			return FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW;
		}
	}

	async getDailyCostUsd(): Promise<number | null | undefined> {
		await this.writes.catch(() => undefined);
		const { dailyCostUsd } = await this.read();
		if (dailyCostUsd === null) return null;
		return typeof dailyCostUsd === "number" &&
			Number.isFinite(dailyCostUsd) &&
			dailyCostUsd > 0
			? dailyCostUsd
			: undefined;
	}

	async setDailyCostUsd(value: unknown): Promise<number | null> {
		const parsed = parseFactoryDailyCostUsd(value);
		await this.update((stored) => ({ ...stored, dailyCostUsd: parsed }));
		return parsed;
	}

	async setDefaultWorkflow(workflow: unknown): Promise<FactoryWorkflowRecipe> {
		const recipe = validateFactoryWorkflowRecipe(workflow);
		await this.update((stored) => ({
			...stored,
			workflow: recipe,
			defaultsReceived: true,
		}));
		return recipe;
	}

	async clearDefaultWorkflow(): Promise<void> {
		await this.update(({ workflow: _workflow, ...rest }) => ({
			...rest,
			defaultsReceived: true,
		}));
	}

	async getConcurrency(): Promise<number | undefined> {
		await this.writes.catch(() => undefined);
		const { concurrency } = await this.read();
		return typeof concurrency === "number" && Number.isFinite(concurrency)
			? clampFactoryConcurrency(concurrency)
			: undefined;
	}

	async setConcurrency(concurrency: unknown): Promise<number> {
		const value = parseFactoryConcurrency(concurrency);
		await this.update((stored) => ({ ...stored, concurrency: value }));
		return value;
	}

	async getDefaultsReceived(): Promise<boolean> {
		await this.writes.catch(() => undefined);
		return (await this.read()).defaultsReceived === true;
	}

	async getDuplicateCheck(): Promise<boolean> {
		await this.writes.catch(() => undefined);
		return (await this.read()).duplicateCheck !== false;
	}

	async setDuplicateCheck(enabled: boolean): Promise<boolean> {
		await this.update(({ duplicateCheck: _check, ...rest }) =>
			enabled ? rest : { ...rest, duplicateCheck: false },
		);
		return enabled;
	}

	async getPaused(): Promise<boolean> {
		await this.writes.catch(() => undefined);
		const { stored, corrupt } = await this.readState();
		return corrupt || stored.paused === true;
	}

	async setPaused(paused: boolean): Promise<boolean> {
		await this.update(({ paused: _paused, ...rest }) =>
			paused ? { ...rest, paused: true } : rest,
		);
		return paused;
	}

	private async read(): Promise<StoredDefaults> {
		return (await this.readState()).stored;
	}

	/** A missing file is empty; an unreadable or unparsable one is corrupt. */
	private async readState(): Promise<{
		stored: StoredDefaults;
		corrupt: boolean;
	}> {
		if (!this.path) return { stored: this.memory, corrupt: false };
		let raw: string;
		try {
			raw = await readFile(this.path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
				const existed = await access(`${this.path}${MARKER_SUFFIX}`).then(
					() => true,
					() => false,
				);
				if (!existed) return { stored: {}, corrupt: false };
				this.reportCorruption("the file was deleted");
				return { stored: {}, corrupt: true };
			}
			this.reportCorruption(
				`the file cannot be read (${error instanceof Error ? error.message : String(error)})`,
			);
			return { stored: {}, corrupt: true };
		}
		try {
			const parsed = JSON.parse(raw) as Partial<StoredFactoryDefaults> | null;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
				throw new Error("not a JSON object");
			return {
				stored: {
					...(parsed.workflow !== undefined
						? { workflow: parsed.workflow }
						: {}),
					...(parsed.concurrency !== undefined
						? { concurrency: parsed.concurrency }
						: {}),
					...(parsed.paused === true ? { paused: true } : {}),
					...(parsed.defaultsReceived === true
						? { defaultsReceived: true }
						: {}),
					...(parsed.dailyCostUsd !== undefined
						? { dailyCostUsd: parsed.dailyCostUsd }
						: {}),
					...(parsed.duplicateCheck === false
						? { duplicateCheck: false as const }
						: {}),
				},
				corrupt: false,
			};
		} catch (error) {
			this.reportCorruption(
				`the file is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
			);
			return { stored: {}, corrupt: true };
		}
	}

	/** Logs the first time the stored defaults are found unusable. */
	private reportCorruption(reason: string): void {
		if (this.corruptionLogged) return;
		this.corruptionLogged = true;
		const message = `Factory defaults unusable: ${reason}. New work is paused and plans wait for approval until a host saves Factory settings again.`;
		if (this.options.logger)
			this.options.logger.log(message, { path: this.path });
		else console.warn(`[factory] ${message} (${this.path})`);
	}

	private update(
		change: (
			stored: Omit<StoredFactoryDefaults, "version">,
		) => Omit<StoredFactoryDefaults, "version">,
	): Promise<void> {
		const next = this.writes
			.catch(() => undefined)
			.then(async () => {
				const current = await this.readState();
				const corrupt = current.corrupt;
				// A corrupt file's pause stays until a host clears it explicitly.
				const updated = change(corrupt ? { paused: true } : current.stored);
				if (corrupt) this.corruptionLogged = false;
				if (!this.path) {
					this.memory = updated;
					return;
				}
				// The file is kept even when empty, and a marker beside it records
				// that it existed, so a deleted file reads as corrupt, not empty.
				const stored: StoredFactoryDefaults = { version: 1, ...updated };
				await writeFileAtomic(
					this.path,
					`${JSON.stringify(stored, null, 2)}\n`,
				);
				await writeFileAtomic(`${this.path}${MARKER_SUFFIX}`, "1\n");
			});
		this.writes = next;
		return next;
	}
}
