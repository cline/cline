// @vitest-environment jsdom

import { act, type HTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteEnvironmentProfile } from "@/lib/remote-environments";
import { RemoteEnvironmentsContent } from "./remote-environments-view";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

vi.mock("@/components/ui/scroll-area", () => ({
	ScrollArea: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
		<div {...props}>{children}</div>
	),
}));

const profile: RemoteEnvironmentProfile = {
	id: "build-box",
	name: "Build box",
	host: "builder.example.com",
	user: "ubuntu",
	port: 22,
	identityFile: "~/.ssh/id_ed25519",
};

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

function buttonWithText(text: string): HTMLButtonElement {
	const button = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}

function inputById(id: string): HTMLInputElement {
	const input = container.querySelector<HTMLInputElement>(`#${id}`);
	expect(input).not.toBeNull();
	return input as HTMLInputElement;
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

describe("RemoteEnvironmentsContent", () => {
	it("locks a saved profile destination while leaving editable metadata available", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_remote_environments") {
				return { profiles: [profile], activeProfileId: null };
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<RemoteEnvironmentsContent />);
		});
		await vi.waitFor(() => {
			expect(inputById("remote-name").value).toBe("Build box");
		});

		expect(inputById("remote-host").disabled).toBe(true);
		expect(inputById("remote-user").disabled).toBe(true);
		expect(inputById("remote-port").disabled).toBe(true);
		expect(inputById("remote-name").disabled).toBe(false);
		expect(inputById("remote-identity").disabled).toBe(false);
		expect(container.textContent).toContain(
			"Create a new host to change the SSH host, user, or port.",
		);

		await click(buttonWithText("New host"));

		expect(inputById("remote-host").disabled).toBe(false);
		expect(inputById("remote-user").disabled).toBe(false);
		expect(inputById("remote-port").disabled).toBe(false);
		expect(container.textContent).not.toContain(
			"Create a new host to change the SSH host, user, or port.",
		);
	});

	it("keeps settings limited to saving and testing SSH hosts", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case "list_remote_environments":
					return { profiles: [profile], activeProfileId: profile.id };
				case "upsert_remote_environment":
					return { profile };
				default:
					throw new Error(`Unexpected command: ${command}`);
			}
		});

		await act(async () => {
			root.render(<RemoteEnvironmentsContent />);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Build box");
			expect(buttonWithText("Save").disabled).toBe(false);
		});
		expect(container.querySelector("#remote-workspace")).toBeNull();
		expect(container.textContent).not.toContain("Connect & Open");
		expect(container.textContent).not.toContain("Disconnect");
		expect(container.textContent).toContain(
			"Connect from the environment selector beside the workspace picker.",
		);
		expect(container.textContent).toContain(
			"v0 requires key-based or agent authentication; it cannot show an interactive password prompt.",
		);

		await click(buttonWithText("Save"));

		await vi.waitFor(() => {
			expect(invokeMock).toHaveBeenCalledTimes(2);
		});
		expect(invokeMock).toHaveBeenNthCalledWith(2, "upsert_remote_environment", {
			profile,
		});
		expect(container.textContent).toContain("Connected");
		expect(container.textContent).toContain("Ready");
	});

	it("keeps a failed SSH test visible on its profile", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case "list_remote_environments":
					return { profiles: [profile], activeProfileId: null };
				case "upsert_remote_environment":
					return { profile };
				case "test_remote_environment":
					throw new Error("Permission denied (publickey)");
				default:
					throw new Error(`Unexpected command: ${command}`);
			}
		});

		await act(async () => {
			root.render(<RemoteEnvironmentsContent />);
		});
		await vi.waitFor(() => {
			expect(buttonWithText("Test connection").disabled).toBe(false);
		});
		await click(buttonWithText("Test connection"));

		await vi.waitFor(() => {
			expect(container.textContent).toContain("Permission denied (publickey)");
		});
		expect(container.textContent).toContain("Failed");
		expect(invokeMock).toHaveBeenNthCalledWith(3, "test_remote_environment", {
			id: profile.id,
		});
	});
});
