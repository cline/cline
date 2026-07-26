import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import {
	buildWorkspaceMetadata,
	mergeRulesForSystemPrompt,
	type UserInstructionConfigService,
} from "@cline/core";
import { type AgentMode, buildClineSystemPrompt } from "@cline/shared";
import { isImagePath, loadImageAsDataUrl } from "../utils/image-attachments";

export async function resolveSystemPrompt(input: {
	cwd: string;
	explicitSystemPrompt?: string;
	providerId?: string;
	rules?: string;
	mode?: AgentMode;
}): Promise<string> {
	const metadata = await buildWorkspaceMetadata(input.cwd);
	// Mode-tag and plan-mode instructions are appended by the shared prompt
	// builder itself (see MODE_TAG_INSTRUCTIONS / PLAN_MODE_INSTRUCTIONS in
	// @cline/shared), so only the caller-specific rules are merged here.
	const rules = mergeRulesForSystemPrompt(undefined, input.rules);
	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: input.cwd,
		workspaceName: basename(input.cwd),
		metadata,
		rules,
		mode: input.mode,
		providerId: input.providerId,
		overridePrompt: input.explicitSystemPrompt,
		platform:
			(typeof process !== "undefined" && process?.platform) || "unknown",
	});
}

const FILE_MENTION_PREFIX = String.raw`(?:\/|~\/|\.{1,2}\/)`;
const FILE_MENTION_PATTERN_TEST = new RegExp(
	String.raw`@(?:"${FILE_MENTION_PREFIX}[^"\r\n]+"|${FILE_MENTION_PREFIX}\S+)`,
	"i",
);
const FILE_MENTION_PATTERN_EXEC = new RegExp(
	String.raw`@(?:"(${FILE_MENTION_PREFIX}[^"\r\n]+)"|(${FILE_MENTION_PREFIX}\S+))`,
	"g",
);
function hasFileMentions(prompt: string): boolean {
	return FILE_MENTION_PATTERN_TEST.test(prompt);
}

function extractFileMentions(
	prompt: string,
): Array<{ path: string; index: number; raw: string }> {
	const matches: Array<{ path: string; index: number; raw: string }> = [];
	let match: RegExpExecArray | null;
	const pattern = new RegExp(
		FILE_MENTION_PATTERN_EXEC.source,
		FILE_MENTION_PATTERN_EXEC.flags,
	);

	for (;;) {
		match = pattern.exec(prompt);
		if (!match) break;
		const path = match[1] ?? match[2];
		if (!path) continue;
		matches.push({
			path,
			index: match.index,
			raw: match[0],
		});
	}
	return matches;
}

function resolveMentionPath(filePath: string): string {
	if (filePath.startsWith("~/")) {
		return resolve(homedir(), filePath.slice(2));
	}
	return resolve(filePath);
}

export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionService?: UserInstructionConfigService,
): Promise<{
	prompt: string;
	userImages: string[];
	userFiles: string[];
}> {
	// First, resolve slash commands if the core config service is available.
	let prompt = rawPrompt;
	if (userInstructionService) {
		prompt = userInstructionService.resolveRuntimeSlashCommand(rawPrompt);
	}

	if (!hasFileMentions(prompt)) {
		return {
			prompt,
			userImages: [],
			userFiles: [],
		};
	}

	const fileMentions = extractFileMentions(prompt);

	if (fileMentions.length === 0) {
		return {
			prompt,
			userImages: [],
			userFiles: [],
		};
	}

	fileMentions.sort((a, b) => b.index - a.index);

	let processedPrompt = prompt;
	const userImages: string[] = [];
	const userFiles: string[] = [];
	const loadedImages: Array<{
		index: number;
		dataUrl: string;
		fileName: string;
	}> = [];
	const loadedFiles: Array<{
		index: number;
		path: string;
		fileName: string;
	}> = [];

	for (const mention of fileMentions) {
		try {
			const resolvedPath = resolveMentionPath(mention.path);
			const stats = statSync(resolvedPath);
			if (!stats.isFile()) {
				throw new Error(`Path is not a file: ${resolvedPath}`);
			}
			const fileName = basename(resolvedPath);

			if (isImagePath(resolvedPath)) {
				const dataUrl = loadImageAsDataUrl(resolvedPath);
				loadedImages.push({
					index: mention.index,
					dataUrl,
					fileName,
				});
				processedPrompt = processedPrompt.replace(
					mention.raw,
					`[image: ${fileName}]`,
				);
				continue;
			}

			loadedFiles.push({
				index: mention.index,
				path: resolvedPath,
				fileName,
			});
			processedPrompt = processedPrompt.replace(
				mention.raw,
				`[file: ${fileName}]`,
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`[warning] ${errorMsg}`);
		}
	}

	for (const image of loadedImages.reverse()) {
		userImages.push(image.dataUrl);
	}
	for (const file of loadedFiles.reverse()) {
		userFiles.push(file.path);
	}

	return {
		prompt: processedPrompt,
		userImages,
		userFiles,
	};
}
