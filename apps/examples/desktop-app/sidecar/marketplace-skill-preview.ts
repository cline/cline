import { parse as parseYaml } from "yaml";
import { fetchMarketplaceCatalog } from "./marketplace";
import { readSkillPreviewArchive } from "./skill-preview-archive";
import {
	decodeSkillPreviewText,
	isSkillPreviewPath,
	isSkillPreviewTextPath,
	MAX_SKILL_PREVIEW_FILE_BYTES,
} from "./skill-preview-text";

export type MarketplaceSkillPreview = {
	files: Array<{ path: string; size: number }>;
	defaultPath: string;
	sourceUrl: string;
};

export type MarketplaceSkillFile = {
	path: string;
	content: string;
	sourceUrl: string;
};

type PreviewFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
type PreviewOptions = {
	fetchImpl?: PreviewFetch;
	loadCatalog?: () => Promise<unknown>;
	readArchive?: typeof readSkillPreviewArchive;
};
type GitHubSource = { repository: string; skill?: string };
type RepositoryFile = { path: string; size: number; blob: Blob };
type SkillFiles = {
	source: GitHubSource;
	root: string;
	files: RepositoryFile[];
};
type Cached<T> = { requestedAt: number; value: Promise<T> };

const CACHE_TTL_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

async function readSkillName(
	file: RepositoryFile,
): Promise<string | undefined> {
	try {
		// Repository files have already passed the archive and per-file byte limits.
		const content = decodeSkillPreviewText(
			new Uint8Array(await file.blob.arrayBuffer()),
		);
		const frontmatter = content.match(
			/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
		)?.[1];
		if (frontmatter === undefined) return undefined;
		const metadata = record(parseYaml(frontmatter, { maxAliasCount: 100 }));
		if (
			typeof metadata?.name !== "string" ||
			!metadata.name ||
			typeof metadata.description !== "string" ||
			!metadata.description
		) {
			return undefined;
		}
		return metadata.name
			.replace(/[\r\n]+/g, " ")
			.trim()
			.toLowerCase();
	} catch {
		// Like the skills CLI, ignore malformed skill metadata while searching.
		return undefined;
	}
}

function cached<T>(
	cache: Map<string, Cached<T>>,
	key: string,
	limit: number,
	load: () => Promise<T>,
): Promise<T> {
	const existing = cache.get(key);
	if (existing && Date.now() - existing.requestedAt < CACHE_TTL_MS) {
		return existing.value;
	}
	cache.delete(key);
	const item: Cached<T> = { requestedAt: Date.now(), value: load() };
	cache.set(key, item);
	while (cache.size > limit) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	void item.value.catch(() => {
		if (cache.get(key) === item) cache.delete(key);
	});
	return item.value;
}

/** Preview public source files without installing or executing the skill. */
export function createMarketplaceSkillPreviewService(
	options: PreviewOptions = {},
) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const readArchive = options.readArchive ?? readSkillPreviewArchive;
	const catalogs = new Map<string, Cached<unknown>>();
	const repositories = new Map<string, Cached<RepositoryFile[]>>();

	async function fetchBytes(
		url: string,
		maxBytes: number,
		/** Names what exceeded the limit, so the reader knows what to blame. */
		tooLargeMessage: string,
		accept = "application/json",
	): Promise<Uint8Array> {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const request = (async () => {
				const response = await fetchImpl(url, {
					headers: {
						Accept: accept,
					},
					signal: controller.signal,
					redirect: "error",
				});
				if (!response.ok) {
					void response.body?.cancel().catch(() => {});
					if (response.status === 429) {
						throw new Error(
							"GitHub is limiting preview requests. Please try again later.",
						);
					}
					throw new Error(
						`Could not load the skill preview (HTTP ${response.status}). Try again.`,
					);
				}
				if (Number(response.headers.get("content-length")) > maxBytes) {
					void response.body?.cancel().catch(() => {});
					throw new Error(tooLargeMessage);
				}
				if (!response.body)
					throw new Error("The skill preview returned an empty response.");
				const reader = response.body.getReader();
				const cancel = () => {
					void reader.cancel().catch(() => {});
				};
				controller.signal.addEventListener("abort", cancel, { once: true });
				const chunks: Uint8Array[] = [];
				let bytes = 0;
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						bytes += value.byteLength;
						if (bytes > maxBytes) {
							cancel();
							throw new Error(tooLargeMessage);
						}
						chunks.push(value);
					}
					const result = new Uint8Array(bytes);
					let offset = 0;
					for (const chunk of chunks) {
						result.set(chunk, offset);
						offset += chunk.byteLength;
					}
					return result;
				} finally {
					controller.signal.removeEventListener("abort", cancel);
					reader.releaseLock();
				}
			})();
			const deadline = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new Error("Loading the skill preview timed out. Try again."));
				}, REQUEST_TIMEOUT_MS);
			});
			return await Promise.race([request, deadline]);
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error("Loading the skill preview timed out. Try again.");
			}
			if (error instanceof TypeError) {
				throw new Error(
					"Could not read the skill preview. Check your connection and try again.",
				);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	async function resolveSource(
		args?: Record<string, unknown>,
	): Promise<GitHubSource> {
		const requested = record(args?.entry) ?? args;
		if (
			requested?.type !== "skill" ||
			typeof requested.id !== "string" ||
			!requested.id.trim()
		) {
			throw new Error("A marketplace skill is required for preview.");
		}
		const catalog = record(
			await cached(
				catalogs,
				"catalog",
				1,
				options.loadCatalog ??
					(() =>
						fetchMarketplaceCatalog(async (input) => {
							// Reuse the catalog's configured URL, with the preview's network limits.
							const bytes = await fetchBytes(
								String(input),
								MAX_CATALOG_BYTES,
								"The marketplace catalog is too large to load.",
							);
							return new Response(decodeSkillPreviewText(bytes));
						})),
			),
		);
		const entry = Array.isArray(catalog?.entries)
			? catalog.entries
					.map(record)
					.find(
						(candidate) =>
							candidate?.type === "skill" && candidate.id === requested.id,
					)
			: undefined;
		if (!entry)
			throw new Error("This skill is no longer in the marketplace catalog.");
		const installArgs = record(entry.install)?.args;
		if (
			!Array.isArray(installArgs) ||
			!installArgs.every((arg) => typeof arg === "string")
		) {
			throw new Error("The skill source is not available for preview.");
		}
		const [source, ...flags] = installArgs as string[];
		// Only GitHub repositories are supported. Never fetch a URL supplied by the webview.
		const match = source?.match(
			/^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
		);
		if (
			!match ||
			match[1] === "." ||
			match[1] === ".." ||
			match[2] === "." ||
			match[2] === ".."
		) {
			throw new Error(
				"Preview is available for skills hosted in public GitHub repositories.",
			);
		}
		let skill: string | undefined;
		if (flags.length) {
			if (
				flags.length !== 2 ||
				(flags[0] !== "--skill" && flags[0] !== "-s") ||
				!/^[A-Za-z0-9_.-]+$/.test(flags[1]) ||
				flags[1] === "." ||
				flags[1] === ".."
			) {
				throw new Error(
					"This skill's source options are not supported for preview.",
				);
			}
			skill = flags[1];
		}
		return { repository: `${match[1]}/${match[2]}`, skill };
	}

	async function loadRepositoryFiles(
		source: GitHubSource,
	): Promise<RepositoryFile[]> {
		return cached(repositories, source.repository, 8, async () => {
			// A single public archive supplies the list and every file. Unlike the
			// REST tree/blob endpoints, this does not consume the anonymous API quota.
			const bytes = await fetchBytes(
				`https://codeload.github.com/${source.repository}/tar.gz/HEAD`,
				MAX_ARCHIVE_BYTES,
				"This skill's repository is too large to preview.",
				"application/octet-stream",
			);
			const archive = await readArchive(bytes);
			const files: RepositoryFile[] = [];
			let archiveRoot: string | undefined;
			for (const [archivePath, blob] of archive) {
				if (!isSkillPreviewPath(archivePath)) continue;
				const slash = archivePath.indexOf("/");
				if (slash < 1) continue;
				const root = archivePath.slice(0, slash);
				if (archiveRoot && root !== archiveRoot) {
					throw new Error("The skill repository returned an invalid archive.");
				}
				archiveRoot = root;
				const path = archivePath.slice(slash + 1);
				if (
					!isSkillPreviewPath(path) ||
					!isSkillPreviewTextPath(path) ||
					blob.size > MAX_SKILL_PREVIEW_FILE_BYTES
				)
					continue;
				files.push({ path, size: blob.size, blob });
			}
			return files;
		});
	}

	async function loadSkill(
		args?: Record<string, unknown>,
	): Promise<SkillFiles> {
		const source = await resolveSource(args);
		const files = await loadRepositoryFiles(source);
		const candidates = files.filter(
			(file) => file.path.split("/").at(-1) === "SKILL.md",
		);
		const matched: RepositoryFile[] = [];
		for (const file of candidates) {
			// --skill selects the declared name, which need not match its directory.
			// Read candidates sequentially to avoid allocating every document at once.
			if (
				!source.skill ||
				(await readSkillName(file)) === source.skill.toLowerCase()
			) {
				matched.push(file);
			}
		}
		if (matched.length !== 1) {
			throw new Error(
				"Could not identify this skill's files in its source repository.",
			);
		}
		const root = matched[0].path.slice(0, -"SKILL.md".length);
		return {
			source,
			root,
			files: files.filter((file) => file.path.startsWith(root)),
		};
	}

	function sourceUrl(
		source: GitHubSource,
		path: string,
		kind: "tree" | "blob",
	): string {
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		return `https://github.com/${source.repository}/${kind}/HEAD${encoded ? `/${encoded}` : ""}`;
	}

	return {
		async getMarketplaceSkillPreview(
			args?: Record<string, unknown>,
		): Promise<MarketplaceSkillPreview> {
			const skill = await loadSkill(args);
			return {
				files: skill.files
					.map((file) => ({
						path: file.path.slice(skill.root.length),
						size: file.size,
					}))
					.sort((a, b) => a.path.localeCompare(b.path)),
				defaultPath: "SKILL.md",
				sourceUrl: sourceUrl(
					skill.source,
					skill.root.replace(/\/$/, ""),
					"tree",
				),
			};
		},
		async readMarketplaceSkillFile(
			args?: Record<string, unknown>,
		): Promise<MarketplaceSkillFile> {
			if (typeof args?.path !== "string" || !isSkillPreviewPath(args.path)) {
				throw new Error("A valid skill file path is required.");
			}
			const path = args.path;
			const skill = await loadSkill(args);
			const file = skill.files.find(
				(candidate) => candidate.path === `${skill.root}${path}`,
			);
			if (!file)
				throw new Error("This file is not available in the skill preview.");
			const content = decodeSkillPreviewText(
				new Uint8Array(await file.blob.arrayBuffer()),
			);
			return {
				path,
				content,
				sourceUrl: sourceUrl(skill.source, file.path, "blob"),
			};
		},
	};
}

const previewService = createMarketplaceSkillPreviewService();
export const getMarketplaceSkillPreview =
	previewService.getMarketplaceSkillPreview;
export const readMarketplaceSkillFile = previewService.readMarketplaceSkillFile;
