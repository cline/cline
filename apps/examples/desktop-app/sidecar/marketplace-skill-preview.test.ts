import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketplaceSkillPreviewService } from "./marketplace-skill-preview";

const ENTRY = { id: "amplify-workflow", type: "skill" };
const SOURCE = {
	...ENTRY,
	install: { args: ["cline/skills", "--skill", "amplify-workflow"] },
};
const ARCHIVE_URL = "https://codeload.github.com/cline/skills/tar.gz/HEAD";
const CONTENT = "# Skill preview";
const SKILL_CONTENT = skillContent("amplify-workflow");
const ARCHIVE_BYTES = new TextEncoder().encode("mock archive");

function skillContent(name: string, instructions = CONTENT): string {
	return `---\nname: ${name}\ndescription: Example skill\n---\n${instructions}`;
}

function file(
	path: string,
	content: BlobPart = path.endsWith("SKILL.md")
		? skillContent(path.split("/").at(-2) ?? "amplify-workflow")
		: CONTENT,
): [string, Blob] {
	return [`skills-HEAD/${path}`, new Blob([content])];
}

function setup(
	options: { source?: unknown; archive?: Map<string, Blob> } = {},
) {
	const archive =
		options.archive ??
		new Map([
			file("skills/amplify-workflow/SKILL.md"),
			file("skills/amplify-workflow/references/auth.md", "# Authentication"),
			file("skills/other-skill/SKILL.md"),
		]);
	const loadCatalog = vi.fn(async () => ({
		entries: [options.source ?? SOURCE],
	}));
	const fetchImpl = vi.fn(
		async (input: string | URL | Request, _init?: RequestInit) => {
			const url = new URL(String(input));
			if (url.hostname === "api.github.com") {
				return new Response("API rate limit exceeded", { status: 403 });
			}
			if (url.hostname !== "codeload.github.com") {
				throw new TypeError(`Unexpected preview host: ${url.hostname}`);
			}
			return new Response(ARCHIVE_BYTES);
		},
	);
	const readArchive = vi.fn(async (_bytes: Uint8Array) => archive);
	const service = createMarketplaceSkillPreviewService({
		fetchImpl,
		loadCatalog,
		readArchive,
	});
	return { ...service, fetchImpl, loadCatalog, readArchive };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("marketplace skill previews", () => {
	it("lists only supported text files under the selected skill and defaults to SKILL.md", async () => {
		const service = setup({
			archive: new Map([
				file("skills/amplify-workflow/SKILL.md"),
				file("skills/amplify-workflow/guide.markdown", "# Guide"),
				file("skills/amplify-workflow/references/auth.md"),
				file("skills/amplify-workflow/scripts/check.py"),
				file("skills/amplify-workflow/image.png"),
				file("skills/amplify-workflow/huge.md", "a".repeat(512 * 1024 + 1)),
				file("skills/amplify-workflow/../outside.md"),
				file("skills/amplify-workflow-other/SKILL.md"),
				file("README.md"),
			]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toEqual({
			files: [
				{ path: "guide.markdown", size: 7 },
				{ path: "references/auth.md", size: 15 },
				{ path: "scripts/check.py", size: 15 },
				{ path: "SKILL.md", size: SKILL_CONTENT.length },
			],
			defaultPath: "SKILL.md",
			sourceUrl:
				"https://github.com/cline/skills/tree/HEAD/skills/amplify-workflow",
		});
	});

	it("previews every file with one archive request even when the GitHub API is rate limited", async () => {
		const service = setup();
		await service.getMarketplaceSkillPreview({ entry: ENTRY });
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" }),
		).resolves.toMatchObject({ content: SKILL_CONTENT });
		await expect(
			service.readMarketplaceSkillFile({
				entry: ENTRY,
				path: "references/auth.md",
			}),
		).resolves.toMatchObject({ content: "# Authentication" });
		await service.getMarketplaceSkillPreview({ entry: ENTRY });
		expect(service.fetchImpl).toHaveBeenCalledTimes(1);
		expect(service.fetchImpl).toHaveBeenCalledWith(
			ARCHIVE_URL,
			expect.objectContaining({
				redirect: "error",
				signal: expect.any(AbortSignal),
			}),
		);
		expect(service.readArchive).toHaveBeenCalledExactlyOnceWith(ARCHIVE_BYTES);
	});

	it("resolves the source from the catalog and reads the requested archived file", async () => {
		const service = setup();
		await expect(
			service.readMarketplaceSkillFile({
				entry: {
					...ENTRY,
					install: { args: ["https://attacker.example/secret"] },
				},
				path: "references/auth.md",
			}),
		).resolves.toEqual({
			path: "references/auth.md",
			content: "# Authentication",
			sourceUrl:
				"https://github.com/cline/skills/blob/HEAD/skills/amplify-workflow/references/auth.md",
		});
		expect(service.fetchImpl.mock.calls[0][0]).toBe(ARCHIVE_URL);
	});

	it.each([
		"cline/skills",
		"cline/skills.git",
		"https://github.com/cline/skills",
		"https://github.com/cline/skills.git/",
	])("canonicalizes repository source %s", async (source) => {
		const service = setup({
			source: {
				...ENTRY,
				install: { args: [source, "--skill", "amplify-workflow"] },
			},
		});
		await service.getMarketplaceSkillPreview({ entry: ENTRY });
		expect(service.fetchImpl.mock.calls[0][0]).toBe(ARCHIVE_URL);
	});

	it.each([
		"--skill",
		"-s",
	])("uses %s rather than the catalog id to locate the skill", async (flag) => {
		const service = setup({
			source: {
				id: "mintlify-skill",
				type: "skill",
				install: { args: ["cline/skills", flag, "mintlify"] },
			},
			archive: new Map([file("skills/mintlify/SKILL.md")]),
		});
		await expect(
			service.getMarketplaceSkillPreview({
				entry: { id: "mintlify-skill", type: "skill" },
			}),
		).resolves.toMatchObject({ defaultPath: "SKILL.md" });
	});

	it.each([
		"named-skill",
		"NAMED-SKILL",
	])("matches --skill %s to metadata rather than a directory or catalog id", async (requestedName) => {
		const content = skillContent("Named-Skill");
		const service = setup({
			source: {
				...ENTRY,
				install: { args: ["cline/skills", "--skill", requestedName] },
			},
			archive: new Map([
				file("skills/folder/SKILL.md", content),
				file("skills/folder/reference.md", "# Reference"),
				file("skills/named-skill/SKILL.md", skillContent("different-skill")),
			]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({
			files: [
				{ path: "reference.md", size: 11 },
				{ path: "SKILL.md", size: content.length },
			],
			sourceUrl: "https://github.com/cline/skills/tree/HEAD/skills/folder",
		});
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" }),
		).resolves.toMatchObject({ content });
	});

	it("matches quoted metadata in a root skill without an instructions body", async () => {
		const content =
			'\uFEFF---\r\nname: "amplify-workflow"\r\ndescription: Example\r\n---';
		const service = setup({
			archive: new Map([file("SKILL.md", content)]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({
			defaultPath: "SKILL.md",
			sourceUrl: "https://github.com/cline/skills/tree/HEAD",
		});
	});

	it.each([
		"# Missing frontmatter",
		"---\nname: [invalid\ndescription: Example\n---\n# Skill",
		"---\nname: 123\ndescription: Example\n---\n# Skill",
		"---\nname: amplify-workflow\n---\n# Skill",
		"---\nname: amplify-workflow\ndescription: false\n---\n# Skill",
		skillContent("another-skill"),
		skillContent("amplify-workflow", "a".repeat(512 * 1024)),
	])("does not select a same-named directory with invalid or different metadata (%#)", async (content) => {
		const service = setup({
			archive: new Map([file("skills/amplify-workflow/SKILL.md", content)]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("Could not identify");
	});

	it("ignores malformed and excessive YAML aliases while locating a valid skill", async () => {
		const aliases = Array.from({ length: 101 }, () => "*name").join(", ");
		const service = setup({
			archive: new Map([
				file("invalid/SKILL.md", "---\nname: [invalid\n---\n# Skill"),
				file(
					"aliases/SKILL.md",
					`---\nname: &name amplify-workflow\ndescription: Example\nmetadata: [${aliases}]\n---\n# Skill`,
				),
				file("valid/SKILL.md", SKILL_CONTENT),
			]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({
			sourceUrl: "https://github.com/cline/skills/tree/HEAD/valid",
		});
	});

	it("finds a single skill in a repository without a --skill filter", async () => {
		const service = setup({
			source: {
				id: "cline-sdk",
				type: "skill",
				install: { args: ["https://github.com/cline/sdk-skill.git"] },
			},
			archive: new Map([file("skill/cline-sdk/SKILL.md"), file("README.md")]),
		});
		await expect(
			service.getMarketplaceSkillPreview({
				entry: { id: "cline-sdk", type: "skill" },
			}),
		).resolves.toEqual({
			files: [{ path: "SKILL.md", size: skillContent("cline-sdk").length }],
			defaultPath: "SKILL.md",
			sourceUrl: "https://github.com/cline/sdk-skill/tree/HEAD/skill/cline-sdk",
		});
	});

	it("supports a skill at the repository root and encodes source file paths", async () => {
		const service = setup({
			source: { ...ENTRY, install: { args: ["cline/skills"] } },
			archive: new Map([file("SKILL.md"), file("references/auth #1.md")]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({
			sourceUrl: "https://github.com/cline/skills/tree/HEAD",
		});
		await expect(
			service.readMarketplaceSkillFile({
				entry: ENTRY,
				path: "references/auth #1.md",
			}),
		).resolves.toMatchObject({
			sourceUrl:
				"https://github.com/cline/skills/blob/HEAD/references/auth%20%231.md",
		});
	});

	it("caches and shares concurrent catalog and archive requests", async () => {
		const service = setup();
		await Promise.all([
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" }),
			service.readMarketplaceSkillFile({
				entry: ENTRY,
				path: "references/auth.md",
			}),
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		]);
		expect(service.loadCatalog).toHaveBeenCalledTimes(1);
		expect(service.fetchImpl).toHaveBeenCalledTimes(1);
		expect(service.readArchive).toHaveBeenCalledTimes(1);
	});

	it("shares an archive across skills from the same repository", async () => {
		const service = setup();
		service.loadCatalog.mockResolvedValue({
			entries: [
				SOURCE,
				{
					id: "other-skill",
					type: "skill",
					install: { args: ["cline/skills", "--skill", "other-skill"] },
				},
			],
		});
		await service.getMarketplaceSkillPreview({ entry: ENTRY });
		await service.readMarketplaceSkillFile({
			entry: { id: "other-skill", type: "skill" },
			path: "SKILL.md",
		});
		expect(service.fetchImpl).toHaveBeenCalledTimes(1);
		expect(service.readArchive).toHaveBeenCalledTimes(1);
	});

	it("refreshes cached sources and file contents after five minutes", async () => {
		vi.useFakeTimers();
		const service = setup();
		await service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" });
		service.readArchive.mockResolvedValue(
			new Map([
				file(
					"skills/amplify-workflow/SKILL.md",
					skillContent("amplify-workflow", "# Updated skill"),
				),
			]),
		);
		vi.advanceTimersByTime(5 * 60 * 1_000 - 1);
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" }),
		).resolves.toMatchObject({ content: SKILL_CONTENT });
		vi.advanceTimersByTime(1);
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" }),
		).resolves.toMatchObject({
			content: skillContent("amplify-workflow", "# Updated skill"),
		});
		expect(service.loadCatalog).toHaveBeenCalledTimes(2);
		expect(service.fetchImpl).toHaveBeenCalledTimes(2);
		expect(service.readArchive).toHaveBeenCalledTimes(2);
	});

	it.each([
		"../other-skill/SKILL.md",
		"/etc/passwd",
		"references/../../outside.md",
		"references\\auth.md",
		"./SKILL.md",
		"SKILL.md\u0000",
		"references//auth.md",
		"",
	])("rejects unsafe paths: %s", async (path) => {
		const service = setup();
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path }),
		).rejects.toThrow("valid skill file path");
		expect(service.fetchImpl).not.toHaveBeenCalled();
	});

	it("rejects files outside the selected skill even when they exist in the repository", async () => {
		const service = setup();
		await expect(
			service.readMarketplaceSkillFile({
				entry: ENTRY,
				path: "skills/other-skill/SKILL.md",
			}),
		).rejects.toThrow("not available in the skill preview");
		expect(service.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("rejects non-skills and missing catalog entries before fetching a repository", async () => {
		const service = setup();
		await expect(
			service.getMarketplaceSkillPreview({
				entry: { ...ENTRY, type: "plugin" },
			}),
		).rejects.toThrow("marketplace skill");
		await expect(
			service.getMarketplaceSkillPreview({
				entry: { ...ENTRY, id: "missing" },
			}),
		).rejects.toThrow("no longer in the marketplace");
		expect(service.fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		"https://github.com.evil.example/cline/skills",
		"http://github.com/cline/skills",
		"../../skills",
		"https://localhost/skills",
		"cline/..",
		"../skills",
		"https://github.com/cline/skills/tree/main",
		"https://github.com/cline/skills?token=secret",
	])("rejects unsupported repository sources: %s", async (source) => {
		const service = setup({
			source: { ...ENTRY, install: { args: [source] } },
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("public GitHub repositories");
		expect(service.fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		["--skill"],
		["--skill", ".."],
		["--skill", "a/b"],
		["--branch", "main"],
		["--skill", "amplify-workflow", "--yes"],
	])("rejects unsupported source options: %j", async (...flags) => {
		const service = setup({
			source: { ...ENTRY, install: { args: ["cline/skills", ...flags] } },
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("source options are not supported");
		expect(service.fetchImpl).not.toHaveBeenCalled();
	});

	it("does not guess between ambiguous skills", async () => {
		const service = setup({
			archive: new Map([
				file("a/first/SKILL.md", skillContent("amplify-workflow")),
				file("b/second/SKILL.md", skillContent("AMPLIFY-WORKFLOW")),
			]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("Could not identify");
	});

	it("ignores unsafe archive entries before locating a skill", async () => {
		const service = setup({
			archive: new Map([
				file("skills/amplify-workflow/SKILL.md"),
				["../skills/amplify-workflow/SKILL.md", new Blob([CONTENT])],
				["/skills/amplify-workflow/SKILL.md", new Blob([CONTENT])],
				file("skills/amplify-workflow/references\\secret.md"),
				file("skills/amplify-workflow/bad\u0000.md"),
				file("skills/amplify-workflow/./bad.md"),
			]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({
			files: [{ path: "SKILL.md", size: SKILL_CONTENT.length }],
		});
	});

	it("rejects archives with multiple repository roots", async () => {
		const service = setup({
			archive: new Map([
				file("skills/amplify-workflow/SKILL.md"),
				["another-repository/README.md", new Blob([CONTENT])],
			]),
		});
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("invalid archive");
	});

	it.each([
		429, 503,
	])("allows a failed archive download (HTTP %i) to be retried", async (status) => {
		const service = setup();
		service.fetchImpl.mockResolvedValueOnce(
			new Response("Unavailable", { status }),
		);
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow(status === 429 ? "GitHub is limiting" : "HTTP 503");
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({ defaultPath: "SKILL.md" });
		expect(service.fetchImpl).toHaveBeenCalledTimes(2);
		expect(service.readArchive).toHaveBeenCalledTimes(1);
	});

	it("does not describe an archive access denial as an API rate limit", async () => {
		const service = setup();
		service.fetchImpl.mockResolvedValueOnce(
			new Response("Forbidden", { status: 403 }),
		);
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("HTTP 403");
	});

	it("allows a failed archive parse to be retried", async () => {
		const service = setup();
		service.readArchive.mockRejectedValueOnce(
			new Error("The skill repository returned an invalid source archive."),
		);
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("invalid source archive");
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({ defaultPath: "SKILL.md" });
		expect(service.fetchImpl).toHaveBeenCalledTimes(2);
	});

	it.each([
		"\u0000binary",
		new Uint8Array([0xff, 0xfe]),
	])("rejects binary archive files masquerading as text", async (content) => {
		const service = setup({
			source: { ...ENTRY, install: { args: ["cline/skills"] } },
			archive: new Map([file("skills/amplify-workflow/SKILL.md", content)]),
		});
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "SKILL.md" }),
		).rejects.toThrow("not a supported");
	});

	it("permits text at the file size limit and rejects larger files", async () => {
		const service = setup({
			archive: new Map([
				file("skills/amplify-workflow/SKILL.md"),
				file("skills/amplify-workflow/limit.md", "a".repeat(512 * 1024)),
				file("skills/amplify-workflow/huge.md", "a".repeat(512 * 1024 + 1)),
			]),
		});
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "limit.md" }),
		).resolves.toMatchObject({ content: "a".repeat(512 * 1024) });
		await expect(
			service.readMarketplaceSkillFile({ entry: ENTRY, path: "huge.md" }),
		).rejects.toThrow("not available in the skill preview");
	});

	it.each([
		true,
		false,
	])("limits archive download bytes (Content-Length present: %s)", async (hasContentLength) => {
		const service = setup();
		const maxBytes = 8 * 1024 * 1024;
		service.fetchImpl.mockResolvedValueOnce(
			new Response(
				"a".repeat(maxBytes + 1),
				hasContentLength
					? { headers: { "Content-Length": String(maxBytes + 1) } }
					: undefined,
			),
		);
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("too large");
		expect(service.readArchive).not.toHaveBeenCalled();
	});

	it("reports an empty archive response", async () => {
		const service = setup();
		service.fetchImpl.mockResolvedValueOnce(new Response(null));
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("empty response");
	});

	it("reports network errors and permits retry", async () => {
		const service = setup();
		service.fetchImpl.mockRejectedValueOnce(new TypeError("fetch failed"));
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).rejects.toThrow("Check your connection");
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({ defaultPath: "SKILL.md" });
	});

	it.each([
		"response headers",
		"response body",
	])("times out stalled %s and permits retry", async (stage) => {
		vi.useFakeTimers();
		const service = setup();
		service.fetchImpl.mockImplementationOnce(async () =>
			stage === "response headers"
				? new Promise<Response>(() => {})
				: new Response(new ReadableStream({ start() {} })),
		);
		const request = service.getMarketplaceSkillPreview({ entry: ENTRY });
		const failed = expect(request).rejects.toThrow("timed out");
		await vi.advanceTimersByTimeAsync(15_000);
		await failed;
		expect(service.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
		await expect(
			service.getMarketplaceSkillPreview({ entry: ENTRY }),
		).resolves.toMatchObject({ defaultPath: "SKILL.md" });
	});
});
