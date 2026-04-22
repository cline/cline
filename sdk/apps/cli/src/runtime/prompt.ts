import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import {
	buildWorkspaceMetadata,
	mergeRulesForSystemPrompt,
	resolveRuntimeSlashCommandFromWatcher,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import { type AgentMode, buildClineSystemPrompt } from "@clinebot/shared";

export async function resolveSystemPrompt(input: {
	cwd: string;
	explicitSystemPrompt?: string;
	providerId?: string;
	rules?: string;
	mode?: AgentMode;
}): Promise<string> {
	const metadata = await buildWorkspaceMetadata(input.cwd);
	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: input.cwd,
		workspaceName: basename(input.cwd),
		metadata,
		rules: mergeRulesForSystemPrompt(undefined, input.rules),
		mode: input.mode,
		providerId: input.providerId,
		overridePrompt: input.explicitSystemPrompt,
		platform:
			(typeof process !== "undefined" && process?.platform) || "unknown",
	});
}

const FILE_MENTION_PATTERN_TEST = /@(?:\/|~\/|\.{1,2}\/)\S+/i;
const FILE_MENTION_PATTERN_EXEC = /@((?:\/|~\/|\.{1,2}\/)\S+)/g;
const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".svg",
]);

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

	while ((match = pattern.exec(prompt)) !== null) {
		matches.push({
			path: match[1],
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

function isImagePath(filePath: string): boolean {
	const normalized = filePath.toLowerCase();
	for (const extension of IMAGE_EXTENSIONS) {
		if (normalized.endsWith(extension)) {
			return true;
		}
	}
	return false;
}

/**
 * Gets the MIME type based on file extension
 */
function getMimeType(filePath: string): string {
	const ext = filePath.toLowerCase().split(".").pop() || "";
	const mimeTypes: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		bmp: "image/bmp",
		svg: "image/svg+xml",
	};
	return mimeTypes[ext] || "image/png";
}

/**
 * Loads an image file and converts it to base64
 */
function loadImageAsBase64(filePath: string): string {
	try {
		const buffer = readFileSync(filePath);
		return buffer.toString("base64");
	} catch (error) {
		throw new Error(
			`Failed to load image from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Parses user input message and extracts @mentioned file references.
 * Image files are converted to data URLs for image content blocks.
 * Non-image files are forwarded as userFiles so the runtime can materialize
 * them as file content blocks.
 */
export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<{
	prompt: string;
	userImages: string[];
	userFiles: string[];
}> {
	// First, resolve slash commands if watcher is available
	let prompt = rawPrompt;
	if (userInstructionWatcher) {
		prompt = await resolveRuntimeSlashCommandFromWatcher(
			rawPrompt,
			userInstructionWatcher,
		);
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
		data: string;
		mediaType: string;
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
				const data = loadImageAsBase64(resolvedPath);
				const mediaType = getMimeType(resolvedPath);
				loadedImages.push({
					index: mention.index,
					data,
					mediaType,
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
		const dataUrl = `data:${image.mediaType};base64,${image.data}`;
		userImages.push(dataUrl);
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
