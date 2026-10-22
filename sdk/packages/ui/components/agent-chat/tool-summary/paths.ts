const EXT_TO_LANGUAGE: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".py": "python",
	".rb": "ruby",
	".rs": "rust",
	".go": "go",
	".java": "java",
	".kt": "kotlin",
	".swift": "swift",
	".c": "c",
	".cpp": "cpp",
	".h": "c",
	".hpp": "cpp",
	".cs": "csharp",
	".css": "css",
	".scss": "scss",
	".html": "html",
	".vue": "vue",
	".svelte": "svelte",
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".md": "markdown",
	".sql": "sql",
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	".fish": "fish",
	".lua": "lua",
	".php": "php",
	".r": "r",
	".ex": "elixir",
	".exs": "elixir",
	".erl": "erlang",
	".zig": "zig",
	".dockerfile": "dockerfile",
	".xml": "xml",
	".graphql": "graphql",
	".proto": "protobuf",
};

function splitSegments(filePath: string): string[] {
	return filePath.split(/[\\/]/);
}

/** Final path segment ("basename"), tolerant of both slash styles. */
export function displayFileName(filePath: string): string {
	const segments = splitSegments(filePath);
	return segments.at(-1) || filePath;
}

/**
 * Shorten a long path to `.../parent/file` form, keeping as many trailing
 * directories as fit within maxLen. Short paths pass through untouched.
 */
export function shortenPath(filePath: string, maxLen = 50): string {
	if (filePath.length <= maxLen) return filePath;
	const parts = splitSegments(filePath);
	const fileName = parts.pop() ?? "";
	if (fileName.length >= maxLen - 4) return `.../${fileName}`;
	let result = fileName;
	for (let i = parts.length - 1; i >= 0; i--) {
		const candidate = `${parts[i]}/${result}`;
		if (candidate.length + 4 > maxLen) break;
		result = candidate;
	}
	return `.../${result}`;
}

/** Best-effort language id from a file extension or well-known file name. */
export function detectLanguage(filePath: string): string | undefined {
	const base = displayFileName(filePath).toLowerCase();
	const dotIndex = base.lastIndexOf(".");
	const ext = dotIndex > 0 ? base.slice(dotIndex) : "";
	if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
	if (base === "dockerfile") return "dockerfile";
	if (base === "makefile") return "makefile";
	if (base === "cmakelists.txt") return "cmake";
	return undefined;
}
