// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstalledInstructionFilePreview } from "./installed-instruction-file-preview";

const { invoke, writeText } = vi.hoisted(() => ({
	invoke: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl: vi.fn(),
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
