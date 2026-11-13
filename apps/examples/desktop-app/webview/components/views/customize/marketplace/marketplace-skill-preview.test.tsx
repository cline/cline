// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceEntry } from "@/lib/marketplace";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
	writeText: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	openExternalUrl: mocks.openExternalUrl,
}));

import {
	InstalledSkillPreview,
	MarketplaceSkillPreview,
} from "./marketplace-skill-preview";

const entry: MarketplaceEntry = {
	id: "example",
	type: "skill",
	name: "Example",
	tagline: "An example skill",
	description: "Description",
	tags: [],
	install: { command: "cline", args: ["skills", "add", "example"] },
};
const index = {
	files: [
		{ path: "SKILL.md", size: 100 },
		{ path: "references/guide.md", size: 30 },
		{ path: "scripts/check.ts", size: 20 },
	],
	defaultPath: "SKILL.md",
	sourceUrl: "https://github.com/example/skills/tree/main/example",
};
const source =
	"---\nname: example\ndescription: Example instructions\n---\n# Instructions\n\nRead the [guide](references/guide.md).";
function file(
	path: string,
	content = path === "SKILL.md"
		? source
		: path === "scripts/check.ts"
			? "console.log('check')"
			: "# Guide\n\nReference details.",
) {
	return {
		path,
		content,
		sourceUrl: `https://github.com/example/skills/blob/main/example/${path}`,
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	mocks.invoke.mockReset();
	mocks.openExternalUrl.mockReset().mockResolvedValue(undefined);
	mocks.writeText.mockReset().mockResolvedValue(undefined);
	mocks.invoke.mockImplementation(
		async (command: string, args: { path: string }) =>
			command === "get_marketplace_skill_preview" ? index : file(args.path),
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
async function render(nextEntry = entry) {
	await act(async () =>
		root.render(<MarketplaceSkillPreview entry={nextEntry} />),
	);
}
async function click(label: string) {
	const button = [
		...container.querySelectorAll<HTMLElement>("button, label"),
	].find(
		(candidate) =>
			candidate.getAttribute("aria-label") === label ||
			candidate.textContent === label,
	);
	expect(button, `Button ${label}`).toBeDefined();
	await act(async () => button?.click());
}
async function runFileAction(label: string) {
	const trigger = container.querySelector<HTMLButtonElement>(
		'[aria-label="File actions"]',
	);
	expect(trigger, "File actions trigger").not.toBeNull();
	await act(async () => {
		trigger?.focus();
		trigger?.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	const action = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((candidate) => candidate.textContent === label);
	expect(action, `File action ${label}`).toBeDefined();
	await act(async () => action?.click());
}

describe("Marketplace skill content preview", () => {
	it("opens and copies the selected remote file location", async () => {
		await render();
		await runFileAction("Open file location");
		expect(mocks.openExternalUrl).toHaveBeenLastCalledWith(
			file("SKILL.md").sourceUrl,
		);
		await click("guide.md");
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(
			file("references/guide.md").sourceUrl,
		);
		await runFileAction("Open file location");
		expect(mocks.openExternalUrl).toHaveBeenLastCalledWith(
			file("references/guide.md").sourceUrl,
		);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"reveal_path",
			expect.anything(),
		);
	});

	it("uses the index source location when the file response omits its URL", async () => {
		mocks.invoke.mockImplementation(
			async (command: string, args: { path: string }) =>
				command === "get_marketplace_skill_preview"
					? index
					: { path: args.path, content: source },
		);
		await render();
		await runFileAction("Open file location");
		expect(mocks.openExternalUrl).toHaveBeenLastCalledWith(
			file("SKILL.md").sourceUrl,
		);
		await click("guide.md");
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(
			file("references/guide.md").sourceUrl,
		);
	});

	it("keeps Copy path available when a remote preview has no source URL", async () => {
		mocks.invoke.mockImplementation(
			async (command: string, args: { path: string }) =>
				command === "get_marketplace_skill_preview"
					? { files: index.files, defaultPath: index.defaultPath }
					: { path: args.path, content: source },
		);
		await render();
		await click("guide.md");
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith("references/guide.md");
		await runFileAction("Open file location");
		expect(mocks.openExternalUrl).not.toHaveBeenCalled();
		expect(
			document.querySelector('[role="menuitem"][aria-disabled="true"]')
				?.textContent,
		).toBe("Open file location");
	});

	it("shows the shared browser skeleton while the file index loads", async () => {
		const pending = deferred<typeof index>();
		mocks.invoke.mockReturnValueOnce(pending.promise);
		await render();
		expect(
			container.querySelector(
				'section[aria-label="Skill content"] [aria-busy="true"]',
			),
		).not.toBeNull();
		const status = container.querySelector("output");
		expect(status?.textContent).toBe("Loading skill content…");
		expect(status?.closest('[aria-busy="true"]')).toBeNull();
		expect(
			container
				.querySelector('[data-slot="file-browser-skeleton"]')
				?.getAttribute("aria-hidden"),
		).toBe("true");
		expect(container.querySelector("button")).toBeNull();
		expect(container.textContent).not.toContain("No files");

		await act(async () => pending.resolve(index));
		expect(container.querySelector("[aria-busy=true]")).toBeNull();
		expect(container.querySelector("output")).toBe(status);
		expect(status?.textContent).toBe("");
		expect(
			container.querySelector('[data-slot="file-browser-skeleton"]'),
		).toBeNull();
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
	});
	it("opens SKILL.md rendered without frontmatter and preserves the complete source", async () => {
		await render();
		expect(mocks.invoke).toHaveBeenCalledWith("get_marketplace_skill_preview", {
			entry: { id: "example", type: "skill" },
		});
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
		expect(container.textContent).not.toContain("name: example");
		expect(
			container.querySelector('button[aria-current="page"]')?.textContent,
		).toBe("SKILL.md");
		await click("Source");
		expect(
			container.querySelector('section[aria-label="File source"] pre')
				?.textContent,
		).toBe(source);
		await click("Preview");
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
	});
	it("browses reference files, collapses folders, and displays scripts as text", async () => {
		await render();
		await click("references");
		expect(
			[...container.querySelectorAll("button")].some(
				(button) => button.textContent === "guide.md",
			),
		).toBe(false);
		await click("references");
		await click("guide.md");
		expect(container.querySelector("h1")?.textContent).toBe("Guide");
		expect(mocks.invoke).toHaveBeenLastCalledWith(
			"read_marketplace_skill_file",
			{ entry: { id: "example", type: "skill" }, path: "references/guide.md" },
		);
		await click("check.ts");
		expect(container.querySelector("pre")?.textContent).toBe(
			"console.log('check')",
		);
		expect(
			container.querySelector('input[type="radio"][value="preview"]'),
		).toBeNull();
	});
	it("resolves repository-relative links without pointing into the app", async () => {
		await render();
		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe(
			"https://github.com/example/skills/blob/main/example/references/guide.md",
		);
		await act(async () => link?.click());
		expect(mocks.openExternalUrl).toHaveBeenCalledWith(
			"https://github.com/example/skills/blob/main/example/references/guide.md",
		);
	});
	it("retries a failed directory request and a failed file request", async () => {
		mocks.invoke.mockRejectedValueOnce(new Error("Could not load skill files"));
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not load skill files",
		);
		mocks.invoke
			.mockResolvedValueOnce(index)
			.mockRejectedValueOnce(new Error("Could not read skill file"));
		await click("Retry");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not read skill file",
		);
		await click("Retry");
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
	});
	it("keeps navigation usable while loading a file and ignores its late response", async () => {
		const pending = deferred<ReturnType<typeof file>>();
		mocks.invoke.mockImplementation(
			async (command: string, args: { path: string }) =>
				command === "get_marketplace_skill_preview"
					? index
					: args.path === "SKILL.md"
						? pending.promise
						: file(args.path),
		);
		await render();
		const status = container.querySelector(
			'[data-slot="file-browser-content"] > output',
		);
		expect(status?.textContent).toBe("Loading skill content…");
		expect(status?.closest('[aria-busy="true"]')).toBeNull();
		expect(
			container.querySelector('[data-slot="file-browser-content-skeleton"]'),
		).not.toBeNull();
		expect(container.querySelector("[aria-busy=true]")).not.toBeNull();
		expect(
			container
				.querySelector('section[aria-label="Skill content"]')
				?.hasAttribute("aria-busy"),
		).toBe(false);
		await click("guide.md");
		expect(container.querySelector("h1")?.textContent).toBe("Guide");
		expect(container.querySelector("[aria-busy=true]")).toBeNull();
		expect(
			container.querySelector('[data-slot="file-browser-content"] > output')
				?.textContent,
		).toBe("");
		expect(
			container.querySelector('[data-slot="file-browser-content-skeleton"]'),
		).toBeNull();
		await act(async () => pending.resolve(file("SKILL.md")));
		expect(container.querySelector("h1")?.textContent).toBe("Guide");
		expect(container.textContent).not.toContain("Instructions");
	});
	it("ignores a late catalog response after switching to a different skill", async () => {
		const pending = deferred<typeof index>();
		mocks.invoke.mockReturnValueOnce(pending.promise);
		await render();
		await render({ ...entry, id: "second" });
		await act(async () =>
			pending.resolve({
				...index,
				files: [{ path: "stale.md", size: 1 }],
				defaultPath: "stale.md",
			}),
		);
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
		expect(container.textContent).not.toContain("stale.md");
	});
});

const skillPath = "/workspace/.agents/skills/example/SKILL.md";
const installedIndex = { files: index.files, defaultPath: index.defaultPath };
function installedFile(path: string, content = file(path).content) {
	return { path, content };
}
async function renderInstalled(path = skillPath, instructions?: string) {
	await act(async () =>
		root.render(
			<InstalledSkillPreview instructions={instructions} skillPath={path} />,
		),
	);
}
function link(label: string) {
	const anchor = [
		...container.querySelectorAll(
			".cline-markdown a, .cline-markdown button, .cline-markdown span",
		),
	].find((candidate) => candidate.textContent === label);
	expect(anchor, `Link ${label}`).toBeDefined();
	return anchor as HTMLElement;
}

describe("Installed skill content preview", () => {
	beforeEach(() => {
		mocks.invoke.mockImplementation(
			async (command: string, args: { path?: string }) => {
				if (command === "get_installed_skill_preview") return installedIndex;
				if (command === "read_installed_skill_file" && args.path) {
					return installedFile(args.path);
				}
				throw new Error(`Unexpected command: ${command}`);
			},
		);
	});
	it.each([
		[
			"/workspace/My project/example/SKILL.md",
			"/workspace/My project/example/references/guide.md",
		],
		[
			"C:\\Users\\Example User\\example\\SKILL.md",
			"C:\\Users\\Example User\\example\\references\\guide.md",
		],
		[
			"\\\\server\\shared folder\\example\\SKILL.md",
			"\\\\server\\shared folder\\example\\references\\guide.md",
		],
	])("keeps actions available without backend localPath for %s", async (installedPath, guidePath) => {
		mocks.invoke.mockImplementation(
			async (command: string, args: { path: string }) => {
				if (command === "get_installed_skill_preview") return installedIndex;
				if (command === "read_installed_skill_file")
					return installedFile(args.path);
				if (command === "reveal_path") return;
				throw new Error(`Unexpected command: ${command}`);
			},
		);
		await renderInstalled(installedPath);
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(installedPath);
		await click("guide.md");
		await runFileAction("Open file location");
		expect(mocks.invoke).toHaveBeenLastCalledWith("reveal_path", {
			path: guidePath,
		});
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(guidePath);
	});
	it.each([
		"/workspace/My project/.agents/skills/example/SKILL.md",
		"C:\\Users\\Example User\\.agents\\skills\\example\\SKILL.md",
	])("uses the backend file location for actions under %s", async (installedPath) => {
		const separator = installedPath.includes("\\") ? "\\" : "/";
		const localRoot = installedPath.slice(
			0,
			installedPath.lastIndexOf(separator),
		);
		const guidePath = `${localRoot}${separator}references${separator}guide.md`;
		mocks.invoke.mockImplementation(
			async (command: string, args: { path?: string }) => {
				if (command === "get_installed_skill_preview") return installedIndex;
				if (command === "read_installed_skill_file" && args.path) {
					return {
						...installedFile(args.path),
						localPath: args.path === "SKILL.md" ? installedPath : guidePath,
					};
				}
				if (command === "reveal_path") return;
				throw new Error(`Unexpected command: ${command}`);
			},
		);
		await renderInstalled(installedPath);
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(installedPath);
		await click("guide.md");
		await runFileAction("Open file location");
		expect(mocks.invoke).toHaveBeenLastCalledWith("reveal_path", {
			path: guidePath,
		});
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(guidePath);
		expect(mocks.openExternalUrl).not.toHaveBeenCalled();
	});

	it("says when a large skill is only partly listed", async () => {
		await renderInstalled(skillPath);
		expect(container.textContent).not.toContain("more files than the preview");

		mocks.invoke.mockImplementation(
			async (command: string, args: { path?: string }) => {
				if (command === "get_installed_skill_preview")
					return { ...installedIndex, truncated: true };
				if (command === "read_installed_skill_file" && args.path)
					return installedFile(args.path);
				throw new Error(`Unexpected command: ${command}`);
			},
		);
		await renderInstalled(`${skillPath}.other`);
		expect(container.textContent).toContain(
			"This skill has more files than the preview can list, so some are not shown.",
		);
		expect(
			container.querySelector('[aria-label="Skill files"]'),
		).not.toBeNull();
	});

	it("keeps the original installed path for inventory fallback actions", async () => {
		const installedPath =
			"C:\\Users\\Example User\\.agents\\skills\\example\\SKILL.md";
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === "get_installed_skill_preview") {
				throw new Error(`unsupported desktop command: ${command}`);
			}
			if (command === "reveal_path") return;
			throw new Error(`Unexpected command: ${command}`);
		});
		await renderInstalled(installedPath, "# Inventory instructions");
		await runFileAction("Open file location");
		expect(mocks.invoke).toHaveBeenLastCalledWith("reveal_path", {
			path: installedPath,
		});
		await runFileAction("Copy path");
		expect(mocks.writeText).toHaveBeenLastCalledWith(installedPath);
	});

	it("uses installed files for the same tree, rendered Markdown, and complete source", async () => {
		await renderInstalled(skillPath, "# Stale inventory instructions");
		expect(mocks.invoke).toHaveBeenCalledWith("get_installed_skill_preview", {
			skillPath,
		});
		expect(mocks.invoke).toHaveBeenCalledWith("read_installed_skill_file", {
			skillPath,
			path: "SKILL.md",
		});
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
		expect(container.textContent).not.toContain("name: example");
		expect(container.textContent).not.toContain("Stale inventory instructions");
		await click("Source");
		expect(
			container.querySelector('section[aria-label="File source"] pre')
				?.textContent,
		).toBe(source);
		await click("Preview");
		await click("references");
		expect(
			[...container.querySelectorAll("button")].some(
				(button) => button.textContent === "guide.md",
			),
		).toBe(false);
		await click("references");
		await click("guide.md");
		expect(container.querySelector("h1")?.textContent).toBe("Guide");
		await click("check.ts");
		expect(container.querySelector("pre")?.textContent).toBe(
			"console.log('check')",
		);
		expect(
			container.querySelector('input[type="radio"][value="preview"]'),
		).toBeNull();
		expect(
			mocks.invoke.mock.calls.every(
				([command]) =>
					command === "get_installed_skill_preview" ||
					command === "read_installed_skill_file",
			),
		).toBe(true);
	});

	it.each([
		"get_installed_skill_preview",
		"read_installed_skill_file",
	])("uses inventory instructions when %s is unavailable in an older backend", async (unsupportedCommand) => {
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === unsupportedCommand) {
				throw new Error(`unsupported desktop command: ${command}`);
			}
			return installedIndex;
		});
		const instructions =
			"---\nname: installed\n---\n# Inventory instructions\n\n[Missing guide](references/guide.md)";
		await renderInstalled(skillPath, instructions);
		expect(container.querySelector("h1")?.textContent).toBe(
			"Inventory instructions",
		);
		expect(container.textContent).not.toContain("unsupported desktop command");
		expect(
			container.querySelector('nav[aria-label="Skill files"]')?.textContent,
		).toBe("SKILL.md");
		expect(link("Missing guide").tagName).toBe("SPAN");
		await click("Source");
		expect(
			container.querySelector('section[aria-label="File source"] pre')
				?.textContent,
		).toBe(instructions);
		expect(mocks.invoke).toHaveBeenCalledTimes(
			unsupportedCommand === "get_installed_skill_preview" ? 1 : 2,
		);
	});

	it.each([
		"get_installed_skill_preview",
		"read_installed_skill_file",
	])("shows restart guidance when %s is unavailable and inventory has no instructions", async (unsupportedCommand) => {
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === unsupportedCommand) {
				throw new Error(`unsupported desktop command: ${command}`);
			}
			return installedIndex;
		});
		await renderInstalled(skillPath, "");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Restart Cline to view this skill’s files.",
		);
		expect(container.textContent).not.toContain("unsupported desktop command");
		mocks.invoke.mockImplementation(
			async (command: string, args: { path: string }) =>
				command === "get_installed_skill_preview"
					? installedIndex
					: installedFile(args.path),
		);
		await click("Retry");
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
	});

	it.each([
		"get_installed_skill_preview",
		"read_installed_skill_file",
	])("does not replace real %s failures with inventory instructions", async (failedCommand) => {
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === failedCommand)
				throw new Error("Permission denied reading skill");
			return installedIndex;
		});
		await renderInstalled(skillPath, "# Inventory instructions");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Permission denied reading skill",
		);
		expect(container.textContent).not.toContain("Inventory instructions");
		expect(container.textContent).not.toContain("Restart Cline");
	});

	it("opens indexed relative links in the installed preview and preserves external links", async () => {
		mocks.invoke.mockImplementation(
			async (command: string, args: { path: string }) =>
				command === "get_installed_skill_preview"
					? installedIndex
					: installedFile(
							args.path,
							args.path === "SKILL.md"
								? source
								: "# Guide\n\n[Skill](../SKILL.md)\n\n[Docs](https://example.com/docs)",
						),
		);
		await renderInstalled();
		await act(async () => link("guide").click());
		expect(mocks.invoke).toHaveBeenLastCalledWith("read_installed_skill_file", {
			skillPath,
			path: "references/guide.md",
		});
		expect(container.querySelector("h1")?.textContent).toBe("Guide");
		expect(
			container.querySelector('button[aria-current="page"]')?.textContent,
		).toBe("guide.md");
		await act(async () => link("Docs").click());
		expect(mocks.openExternalUrl).toHaveBeenCalledExactlyOnceWith(
			"https://example.com/docs",
		);
		await act(async () => link("Skill").click());
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
	});

	it("blocks missing and outside links from navigating the app", async () => {
		const blockedLinks = [
			["Missing", "references/missing.md"],
			["Outside", "../SKILL.md"],
			["Encoded outside", "%2e%2e/SKILL.md"],
			["Absolute", "/SKILL.md"],
		];
		mocks.invoke.mockImplementation(async (command: string) =>
			command === "get_installed_skill_preview"
				? installedIndex
				: installedFile(
						"SKILL.md",
						blockedLinks
							.map(([label, href]) => `[${label}](${href})`)
							.join("\n\n"),
					),
		);
		await renderInstalled();
		for (const [label] of blockedLinks) {
			expect(link(label).tagName).toBe("SPAN");
			expect(link(label).getAttribute("href")).toBeNull();
			for (const type of ["click", "auxclick", "contextmenu"]) {
				const event = new MouseEvent(type, {
					bubbles: true,
					cancelable: true,
					button: type === "auxclick" ? 1 : 0,
				});
				await act(async () => {
					link(label).dispatchEvent(event);
				});
			}
		}
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		expect(mocks.openExternalUrl).not.toHaveBeenCalled();
	});

	it.each([
		"index",
		"file",
	])("ignores a late installed %s response after changing skill paths", async (request) => {
		const nextSkillPath = "/workspace/.agents/skills/second/SKILL.md";
		const pending = deferred<
			typeof installedIndex | ReturnType<typeof installedFile>
		>();
		mocks.invoke.mockImplementation(
			async (command: string, args: { skillPath: string; path?: string }) => {
				const indexRequest = command === "get_installed_skill_preview";
				if (
					args.skillPath === skillPath &&
					indexRequest === (request === "index")
				) {
					return pending.promise;
				}
				return indexRequest
					? installedIndex
					: installedFile(args.path ?? "SKILL.md", "# Second skill");
			},
		);
		await renderInstalled();
		await renderInstalled(nextSkillPath);
		await act(async () => {
			pending.resolve(
				request === "index"
					? { files: [{ path: "stale.md", size: 1 }], defaultPath: "stale.md" }
					: installedFile("SKILL.md", "# Stale skill"),
			);
		});
		expect(container.querySelector("h1")?.textContent).toBe("Second skill");
		expect(container.textContent).not.toContain("stale.md");
		expect(container.textContent).not.toContain("Stale skill");
	});
});
