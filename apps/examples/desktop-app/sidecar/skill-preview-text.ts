/** Shared text policy for previews, independent of filesystem or archive access. */
export const MAX_SKILL_PREVIEW_FILE_BYTES = 512 * 1024;

const TEXT_EXTENSIONS = new Set(
	"md mdx markdown txt rst json jsonc yaml yml toml xml csv tsv ini cfg conf properties env gitignore gitattributes editorconfig sh bash zsh fish ps1 bat cmd py js jsx mjs cjs ts tsx css scss less html htm sql go rs rb java kt swift c h cpp hpp cs php r lua pl ex exs erl hs dockerfile makefile gradle tf hcl proto graphql gql".split(
		" ",
	),
);

export function hasControlCharacters(
	value: string,
	allowWhitespace = false,
): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (allowWhitespace && (code === 9 || code === 10 || code === 13)) continue;
		if (code < 32 || code === 127) return true;
	}
	return false;
}

export function isSkillPreviewPath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 2_048 &&
		!path.includes("\\") &&
		!hasControlCharacters(path) &&
		path.split("/").every((part) => part && part !== "." && part !== "..")
	);
}

export function isSkillPreviewTextPath(path: string): boolean {
	const name = path.split("/").at(-1)?.toLowerCase() ?? "";
	return (
		TEXT_EXTENSIONS.has(name.split(".").at(-1) ?? "") ||
		/^(license|licence|notice|readme|changelog|authors|copying|gemfile|rakefile)$/i.test(
			name,
		)
	);
}

export function decodeSkillPreviewText(bytes: Uint8Array): string {
	let content: string;
	try {
		content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("This file is not a supported UTF-8 text file.");
	}
	if (hasControlCharacters(content, true)) {
		throw new Error("This file is not a supported text file.");
	}
	return content;
}
