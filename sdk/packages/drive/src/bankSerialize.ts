import type { DrivePlan, DriveTask } from "@cline/shared";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function serializeDriveTask(task: DriveTask): string {
	const meta = {
		id: task.id,
		title: task.title,
		status: task.status,
		...(task.lastFailure ? { lastFailure: task.lastFailure } : {}),
	};
	return `---\n${toYamlish(meta)}---\n${task.body}\n`;
}

export function serializeDrivePlan(plan: DrivePlan): string {
	const meta = {
		id: plan.id,
		title: plan.title,
		status: plan.status,
		taskIds: plan.taskIds,
	};
	return `---\n${toYamlish(meta)}---\n`;
}

export function deserializeDriveTask(raw: string): DriveTask {
	const { meta, body } = splitFrontmatter(raw);
	return {
		id: String(meta.id ?? ""),
		title: String(meta.title ?? ""),
		status: meta.status as DriveTask["status"],
		body: body.trimEnd(),
		...(typeof meta.lastFailure === "string"
			? { lastFailure: meta.lastFailure }
			: {}),
	};
}

export function deserializeDrivePlan(raw: string): DrivePlan {
	const { meta } = splitFrontmatter(raw);
	const taskIds = Array.isArray(meta.taskIds)
		? meta.taskIds.map(String)
		: [];
	return {
		id: String(meta.id ?? ""),
		title: String(meta.title ?? ""),
		status: meta.status as DrivePlan["status"],
		taskIds,
	};
}

function splitFrontmatter(raw: string): {
	meta: Record<string, unknown>;
	body: string;
} {
	const match = FRONTMATTER_RE.exec(raw);
	if (!match) {
		throw new Error("Drive bank file missing YAML frontmatter");
	}
	return {
		meta: parseYamlish(match[1] ?? ""),
		body: match[2] ?? "",
	};
}

function toYamlish(value: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [key, entry] of Object.entries(value)) {
		if (Array.isArray(entry)) {
			lines.push(`${key}:`);
			for (const item of entry) {
				lines.push(`  - ${escapeScalar(item)}`);
			}
			continue;
		}
		lines.push(`${key}: ${escapeScalar(entry)}`);
	}
	return `${lines.join("\n")}\n`;
}

function parseYamlish(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	let currentListKey: string | null = null;
	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}
		const listItem = /^\s+-\s+(.*)$/.exec(line);
		if (listItem && currentListKey) {
			const list = result[currentListKey];
			if (!Array.isArray(list)) {
				result[currentListKey] = [];
			}
			(result[currentListKey] as unknown[]).push(
				unquote(listItem[1] ?? ""),
			);
			continue;
		}
		const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
		if (!kv) {
			continue;
		}
		const key = kv[1] ?? "";
		const rest = (kv[2] ?? "").trim();
		if (rest === "") {
			currentListKey = key;
			result[key] = [];
			continue;
		}
		currentListKey = null;
		result[key] = unquote(rest);
	}
	return result;
}

function escapeScalar(value: unknown): string {
	const text = String(value);
	if (/[:#\n]|^\s|\s$/.test(text)) {
		return JSON.stringify(text);
	}
	return text;
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		try {
			return JSON.parse(value.replace(/^'/, '"').replace(/'$/, '"'));
		} catch {
			return value.slice(1, -1);
		}
	}
	return value;
}
