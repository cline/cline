// @vitest-environment jsdom
import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	invalidateExtensionInventoryCache,
} from "@/lib/extension-inventory";
import { useExtensionInventory } from "@/lib/use-extension-inventory";
import { useExtensionSection } from "./use-extension-section";

const { invoke, subscribe } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe },
}));

let root: Root;
let container: HTMLDivElement;
const onInventoryChanged = vi.fn();

function Section() {
	const sharedInventory = useExtensionInventory();
	const handleInventoryChanged = useCallback(() => {
		onInventoryChanged();
		void sharedInventory.refresh();
	}, [sharedInventory.refresh]);
	const { inventory, error, loading, setError, refresh } = useExtensionSection(
		handleInventoryChanged,
	);
	return (
		<>
			<output data-failed={Boolean(error)} data-loading={loading}>
				{error ?? inventory.rules[0]?.name}
			</output>
			<button type="button" onClick={() => setError("Unable to update tool")}>
				Fail action
			</button>
			<button type="button" onClick={() => void refresh(true)}>
				Refresh
			</button>
		</>
	);
}

const inventory = (name: string) => ({
	rules: [{ name, instructions: "", path: `/rules/${name}.md` }],
});
const output = () => container.querySelector("output")?.textContent;
const status = () => ({ ...container.querySelector("output")?.dataset });
const click = async (label: string) =>
	act(async () => {
		[...container.querySelectorAll("button")]
			.find((button) => button.textContent === label)
			?.click();
	});

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invalidateExtensionInventoryCache();
	invoke.mockReset();
	invoke.mockResolvedValue(inventory("initial"));
	onInventoryChanged.mockClear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	invalidateExtensionInventoryCache();
});

it.each([
	"another section mutation",
	"settings.changed",
])("clears a stale action error after %s", async (source) => {
	await act(async () => root.render(<Section />));
	await click("Fail action");
	expect(output()).toBe("Unable to update tool");
	expect(status()).toMatchObject({ failed: "true" });
	await act(async () => {
		if (source === "another section mutation")
			commitExtensionInventoryResponse(inventory("updated"));
		else {
			invoke.mockResolvedValueOnce(inventory("updated"));
			const settingsChanged = (
				subscribe.mock.calls as unknown as Array<[string, () => void]>
			).find(([event]) => event === "settings.changed")?.[1];
			if (!settingsChanged) throw new Error("Expected settings subscription");
			settingsChanged();
		}
	});
	expect(output()).toBe("updated");
	expect(status()).toEqual({ failed: "false", loading: "false" });
});

it("keeps a failed forced refresh visible instead of invoking the parent's cached refresh", async () => {
	await act(async () => root.render(<Section />));
	expect(output()).toBe("initial");
	invoke.mockRejectedValueOnce(new Error("Inventory refresh failed"));
	await click("Refresh");
	expect(output()).toBe("Inventory refresh failed");
	expect(onInventoryChanged).not.toHaveBeenCalled();
	expect(invoke).toHaveBeenCalledTimes(2);
	expect(status()).toMatchObject({ failed: "true" });
	invoke.mockResolvedValueOnce(inventory("updated"));
	await click("Refresh");
	expect(output()).toBe("updated");
	expect(onInventoryChanged).toHaveBeenCalledOnce();
	expect(invoke).toHaveBeenCalledTimes(3);
});
