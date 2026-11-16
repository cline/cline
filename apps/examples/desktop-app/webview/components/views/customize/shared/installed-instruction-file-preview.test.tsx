// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstalledInstructionFilePreview } from "./installed-instruction-file-preview";

const { invoke, openExternalUrl, writeText } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "reveal_path") return;
		throw new Error(`Unexpected command: ${command}`);
	});
	writeText.mockReset().mockResolvedValue(undefined);
	openExternalUrl.mockReset().mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function runFileAction(label: string) {
	const trigger = container.querySelector<HTMLButtonElement>(
		'[aria-label="File actions"]',
	);
	if (!trigger) throw new Error("Missing file actions trigger");
	await act(async () => {
		trigger.focus();
		trigger.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	const item = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((candidate) => candidate.textContent === label);
	if (!item) throw new Error(`Missing file action: ${label}`);
	await act(async () => item.click());
}

describe("Installed instruction preview file actions", () => {
	it.each([
		"rule",
		"workflow",
	] as const)("keeps unavailable %s file links inert and opens external links externally", async (type) => {
		const localLinks = [
			["Guide", "/docs/guide.md"],
			["Root", "/"],
			["Relative", "references/guide.md"],
			["Parent", "../guide.md"],
		];
		await act(async () =>
			root.render(
				<InstalledInstructionFilePreview
					path="/workspace/.clinerules/project.md"
					instructions={[
						...localLinks.map(([label, href]) => `[${label}](${href})`),
						"[Docs](https://example.com/docs)",
					].join("\n\n")}
					type={type}
				/>,
			),
		);
		for (const [label] of localLinks) {
			const link = [...container.querySelectorAll("span, a")].find(
				(element) => element.textContent === label,
			);
			expect(link?.tagName).toBe("SPAN");
			expect(link?.getAttribute("href")).toBeNull();
			expect(link?.getAttribute("title")).toBe("File unavailable");
		}
		expect(invoke).not.toHaveBeenCalled();
		expect(openExternalUrl).not.toHaveBeenCalled();
		const externalLink = container.querySelector<HTMLAnchorElement>(
			'a[href="https://example.com/docs"]',
		);
		expect(externalLink).not.toBeNull();
		await act(async () => externalLink?.click());
		expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
			"https://example.com/docs",
		);
	});

	it.each([
		{
			type: "rule" as const,
			path: "/home/example/My project/.clinerules/project.md",
		},
		{
			type: "workflow" as const,
			path: "C:\\Users\\Example User\\My project\\.clinerules\\workflows\\project.md",
		},
	])("preserves the full $type path when opening and copying $path", async ({
		type,
		path,
	}) => {
		const instructions = "# Instructions\n\nFollow the project conventions.";
		await act(async () =>
			root.render(
				<InstalledInstructionFilePreview
					path={path}
					instructions={instructions}
					type={type}
				/>,
			),
		);
		expect(invoke).not.toHaveBeenCalled();
		expect(container.querySelector("h1")?.textContent).toBe("Instructions");
		expect(container.textContent).toContain("Follow the project conventions.");
		expect(
			container
				.querySelector(".cline-ui-file-browser__path")
				?.getAttribute("title"),
		).toBe("project.md");
		await runFileAction("Open file location");
		expect(invoke).toHaveBeenLastCalledWith("reveal_path", { path });
		await runFileAction("Copy path");
		expect(writeText).toHaveBeenCalledExactlyOnceWith(path);
	});
});
