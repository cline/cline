// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteDirectoryPicker } from "./remote-directory-picker";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockReset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function clickButton(text: string): Promise<void> {
	const button = [
		...document.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	await act(async () => {
		button?.click();
		await Promise.resolve();
	});
}

describe("RemoteDirectoryPicker", () => {
	it("browses from remote home and returns the selected directory", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				expect(command).toBe("list_workspace_directories");
				if (args?.path === "/home/pi") {
					return {
						environmentId: "pi-host",
						currentPath: "/home/pi",
						parentPath: "/home",
						entries: [{ name: "projects", path: "/home/pi/projects" }],
						truncated: true,
					};
				}
				if (args?.path === "/home/pi/projects") {
					return {
						environmentId: "pi-host",
						currentPath: "/srv/projects",
						parentPath: "/srv",
						entries: [{ name: "cline", path: "/srv/projects/cline" }],
						truncated: false,
					};
				}
				return {
					environmentId: "pi-host",
					currentPath: String(args?.path),
					parentPath: "/srv/projects",
					entries: [],
					truncated: false,
				};
			},
		);
		const onSelect = vi.fn();

		await act(async () => {
			root.render(
				<RemoteDirectoryPicker
					environmentId="pi-host"
					homeDir="/home/pi"
					onCancel={vi.fn()}
					onSelect={onSelect}
					open
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("projects");
			expect(document.body.textContent).toContain(
				"Only the first directories are shown",
			);
		});
		expect(invokeMock).toHaveBeenCalledWith("list_workspace_directories", {
			environmentId: "pi-host",
			path: "/home/pi",
		});

		await clickButton("projects");
		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("cline");
		});
		expect(invokeMock).toHaveBeenCalledWith("list_workspace_directories", {
			environmentId: "pi-host",
			path: "/home/pi/projects",
		});

		await clickButton("cline");
		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("/srv/projects/cline");
		});
		await clickButton("Use this folder");
		expect(onSelect).toHaveBeenCalledWith("/srv/projects/cline");
	});

	it("rejects a directory response from another environment", async () => {
		invokeMock.mockResolvedValue({
			environmentId: "other-host",
			currentPath: "/home/other",
			parentPath: "/home",
			entries: [],
			truncated: false,
		});

		await act(async () => {
			root.render(
				<RemoteDirectoryPicker
					environmentId="pi-host"
					homeDir="/home/pi"
					onCancel={vi.fn()}
					onSelect={vi.fn()}
					open
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain(
				"Directory response belongs to other-host, not pi-host.",
			);
		});
	});
});
