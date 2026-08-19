import { stat } from "node:fs/promises";
import path from "node:path";
import { type FastFileIndexOptions, getFileIndex } from "./file-indexer";

const TRAILING_PUNCTUATION = /[),.:;!?`'"]+$/;
const LEADING_WRAPPERS = /^[(`'"]+/;

export interface MentionEnricherOptions extends FastFileIndexOptions {
	maxFiles?: number;
	maxFileBytes?: number;
	maxTotalBytes?: number;
}

export interface MentionEnrichmentResult {
	prompt: string;
	mentions: string[];
	matchedFiles: string[];
	ignoredMentions: string[];
}

function extractMentionTokens(input: string): string[] {
	const matches = input.matchAll(/(^|[\s])@([^\s]+)/g);
	const mentions: string[] = [];
	for (const match of matches) {
		const token = (match[2] ?? "").trim();
		if (token.length === 0) {
			continue;
		}
		const normalized = token
			.replace(LEADING_WRAPPERS, "")
			.replace(TRAILING_PUNCTUATION, "");
		if (normalized.length === 0 || normalized.includes("@")) {
			continue;
		}
		mentions.push(normalized);
	}
	return Array.from(new Set(mentions));
}

function normalizeMentionPath(
	mention: string,
	cwd: string,
): string | undefined {
	const candidate = mention.replace(/\\/g, "/");
	const maybeAbsolute = path.isAbsolute(candidate)
		? path.resolve(candidate)
		: path.resolve(cwd, candidate);
	const relative = path.relative(cwd, maybeAbsolute);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative.split(path.sep).join("/");
}

export async function enrichPromptWithMentions(
	input: string,
	cwd: string,
	options: MentionEnricherOptions = {},
): Promise<MentionEnrichmentResult> {
	const mentions = extractMentionTokens(input);
	if (mentions.length === 0) {
		return {
			prompt: input,
			mentions: [],
			matchedFiles: [],
			ignoredMentions: [],
		};
	}

	const maxFiles = options.maxFiles;
	const maxFileBytes = options.maxFileBytes;
	const maxTotalBytes = options.maxTotalBytes;
	const fileList = await getFileIndex(cwd, { ttlMs: options.ttlMs });
	const matched: string[] = [];
	const ignored: string[] = [];
	const attachments: Array<{ path: string; content: string }> = [];
	let totalBytes = 0;

	for (const mention of mentions) {
		if (maxFiles && attachments.length >= maxFiles) {
			ignored.push(mention);
			continue;
		}

		const relativePath = normalizeMentionPath(mention, cwd);
		if (!relativePath || !fileList.has(relativePath)) {
			ignored.push(mention);
			continue;
		}

		if (!maxFileBytes || !maxTotalBytes) {
			matched.push(relativePath);
			continue;
		}

		const absolutePath = path.join(cwd, relativePath);
		try {
			const fileStat = await stat(absolutePath);
			if (!fileStat.isFile()) {
				ignored.push(mention);
				continue;
			}
			const nextBytes = totalBytes + maxFileBytes;
			if (nextBytes > maxTotalBytes) {
				ignored.push(mention);
				continue;
			}

			totalBytes = nextBytes;
			matched.push(relativePath);
		} catch {
			ignored.push(mention);
		}
	}

	return {
		prompt: input,
		mentions,
		matchedFiles: matched,
		ignoredMentions: ignored,
	};
}
