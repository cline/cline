const MAX_PATH_LENGTH = 500;

export class UnsafePathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsafePathError";
	}
}

/** Normalize a workspace-relative path and reject traversal / absolute paths. */
export function normalizeWorkspacePath(input: string, options?: { allowRoot?: boolean }): string {
	if (typeof input !== "string") throw new UnsafePathError("Path must be a string");
	if (input.length > MAX_PATH_LENGTH) throw new UnsafePathError("Path is too long");
	if (input.includes("\0")) throw new UnsafePathError("Path contains a null byte");

	const cleaned = input.replaceAll("\\", "/").trim();
	if (cleaned.startsWith("/")) throw new UnsafePathError("Absolute paths are not allowed");
	if (/^[a-zA-Z]:\//.test(cleaned)) throw new UnsafePathError("Drive paths are not allowed");

	const parts = cleaned.split("/").filter((part) => part.length > 0 && part !== ".");
	if (parts.some((part) => part === "..")) {
		throw new UnsafePathError("Parent directory traversal is not allowed");
	}
	if (parts.length === 0) {
		if (options?.allowRoot) return ".";
		throw new UnsafePathError("A workspace path is required");
	}
	return parts.join("/");
}

export function joinRemotePath(root: string, relative: string): string {
	const normalizedRelative = normalizeWorkspacePath(relative, { allowRoot: true });
	const normalizedRoot = root.replace(/\/+$/, "");
	if (normalizedRelative === ".") return normalizedRoot;
	return `${normalizedRoot}/${normalizedRelative}`;
}

export function resolveWorkspacePath(
	root: string,
	input: string,
): {
	relative: string;
	absolute: string;
} {
	const relative = normalizeWorkspacePath(input);
	return { relative, absolute: joinRemotePath(root, relative) };
}

const TEXT_EXTENSIONS = new Set([
	"txt",
	"md",
	"mdx",
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"jsonc",
	"py",
	"rb",
	"php",
	"java",
	"c",
	"h",
	"cpp",
	"cc",
	"hpp",
	"go",
	"rs",
	"html",
	"htm",
	"css",
	"scss",
	"less",
	"xml",
	"yml",
	"yaml",
	"toml",
	"ini",
	"conf",
	"sh",
	"bash",
	"zsh",
	"sql",
	"graphql",
	"env",
	"gitignore",
	"dockerfile",
	"makefile",
	"lock",
	"svg",
	"csv",
	"tsv",
	"log",
]);

export function isProbablyTextPath(path: string): boolean {
	const name = path.split("/").pop() ?? path;
	const lower = name.toLowerCase();
	if (lower === "dockerfile" || lower === "makefile" || lower === "license") return true;
	const ext = lower.includes(".") ? (lower.split(".").pop() ?? "") : "";
	return TEXT_EXTENSIONS.has(ext);
}

export function isUtf8Text(buffer: Buffer): boolean {
	if (buffer.length === 0) return true;
	if (buffer.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		return true;
	} catch {
		return false;
	}
}

export function languageForPath(path: string): string {
	const ext = (path.split(".").pop() ?? "").toLowerCase();
	switch (ext) {
		case "ts":
		case "tsx":
			return "typescript";
		case "js":
		case "jsx":
		case "mjs":
		case "cjs":
			return "javascript";
		case "py":
			return "python";
		case "java":
			return "java";
		case "c":
		case "h":
			return "c";
		case "cpp":
		case "cc":
		case "hpp":
			return "cpp";
		case "go":
			return "go";
		case "rs":
			return "rust";
		case "php":
			return "php";
		case "rb":
			return "ruby";
		case "html":
		case "htm":
			return "html";
		case "css":
		case "scss":
		case "less":
			return "css";
		case "json":
		case "jsonc":
			return "json";
		case "md":
		case "mdx":
			return "markdown";
		default:
			return "plain";
	}
}

export function extensionForLanguage(language: string): string {
	switch (language) {
		case "typescript":
			return "ts";
		case "javascript":
			return "js";
		case "python":
			return "py";
		case "java":
			return "java";
		case "go":
			return "go";
		case "rust":
			return "rs";
		case "php":
			return "php";
		case "ruby":
			return "rb";
		case "html":
			return "html";
		case "c":
			return "c";
		case "cpp":
			return "cpp";
		default:
			return "txt";
	}
}
