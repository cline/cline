// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	fetchExtensionInventory,
	getCachedExtensionInventory,
	invalidateExtensionInventoryCache,
	type PluginItem,
	type SkillItem,
} from "./extension-inventory";
import {
	extensionActionKey,
	useExtensionActions,
} from "./use-extension-actions";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
}));

const skill: SkillItem = {
	name: "Review",
	path: "/workspace/.agents/skills/review/SKILL.md",
	instructions: "Review the changes.",
	enabled: true,
};
const firstPlugin: PluginItem = {
	id: "first",
	name: "First",
	path: "/plugins/first",
	enabled: true,
};
const secondPlugin: PluginItem = {
	id: "second",
	name: "Second",
	path: "/plugins/second",
	enabled: true,
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;
const consumers = new Map<string, ReturnType<typeof useExtensionActions>>();
function Consumer({ name }: { name: string }) {
	const state = useExtensionActions();
	consumers.set(name, state);
	const action = state.actions.get(extensionActionKey("skill", skill.path));
	return (
		<output aria-label={name}>
			{action?.pending ?? action?.error ?? "idle"}
		</output>
	);
}
function consumer(name: string) {
	const state = consumers.get(name);
	if (!state) throw new Error(`Missing consumer ${name}`);
	return state;
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	invoke.mockReset();
	consumers.clear();
	commitExtensionInventoryResponse({ skills: [skill] });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

it("locks the same installed item across consumers and preserves pending work across navigation", async () => {
	let complete!: (response: unknown) => void;
	invoke.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	await act(async () =>
		root.render(
			<>
				<Consumer name="list" />
				<Consumer name="details" />
			</>,
		),
	);
	let pending: ReturnType<
		ReturnType<typeof useExtensionActions>["toggleSkill"]
	>;
	await act(async () => {
		pending = consumer("list").toggleSkill(skill);
	});
	expect(container.textContent).toBe("toggletoggle");
	await act(async () => {
		expect(await consumer("details").toggleSkill(skill)).toEqual({
			status: "busy",
		});
	});
	expect(invoke).toHaveBeenCalledTimes(1);
	await act(async () => root.render(null));
	await act(async () => root.render(<Consumer name="returned" />));
	expect(container.textContent).toBe("toggle");
	await act(async () => {
		complete({ skills: [{ ...skill, enabled: false }] });
		await pending;
	});
	expect(container.textContent).toBe("idle");
	expect(getCachedExtensionInventory()?.skills[0]?.enabled).toBe(false);
	invoke.mockResolvedValueOnce({ skills: [skill] });
	await act(async () => {
		await consumer("returned").toggleSkill(skill);
	});
	expect(invoke).toHaveBeenLastCalledWith("set_skill_disabled", {
		path: skill.path,
		disabled: false,
	});
});

it.each([
	"toggle",
	"uninstall",
] as const)("serializes inventory mutations so older replies cannot undo a later %s", async (action) => {
	commitExtensionInventoryResponse({
		skills: [skill],
		plugins: [firstPlugin, secondPlugin],
	});
	await act(async () => root.render(<Consumer name="list" />));
	const firstResponse = deferred<unknown>();
	const secondResponse = deferred<unknown>();
	invoke
		.mockReturnValueOnce(firstResponse.promise)
		.mockReturnValueOnce(secondResponse.promise);

	let firstPending!: ReturnType<
		ReturnType<typeof useExtensionActions>["togglePlugin"]
	>;
	let secondPending!: ReturnType<
		ReturnType<typeof useExtensionActions>["togglePlugin"]
	>;
	await act(async () => {
		firstPending = consumer("list").togglePlugin(firstPlugin);
		secondPending =
			action === "toggle"
				? consumer("list").togglePlugin(secondPlugin)
				: consumer("list").uninstallPlugin(secondPlugin, []);
		await Promise.resolve();
	});
	expect(invoke).toHaveBeenCalledExactlyOnceWith("set_plugin_disabled", {
		path: firstPlugin.path,
		disabled: true,
	});

	await act(async () => {
		firstResponse.resolve({
			skills: [skill],
			plugins: [{ ...firstPlugin, enabled: false }, secondPlugin],
		});
		await firstPending;
	});
	expect(invoke).toHaveBeenCalledTimes(2);
	expect(invoke).toHaveBeenLastCalledWith(
		action === "toggle" ? "set_plugin_disabled" : "uninstall_local_primitive",
		action === "toggle"
			? { path: secondPlugin.path, disabled: true }
			: {
					type: "plugin",
					id: secondPlugin.name,
					name: secondPlugin.name,
					path: secondPlugin.path,
				},
	);

	await act(async () => {
		secondResponse.resolve({
			skills: [skill],
			plugins: [
				{ ...firstPlugin, enabled: false },
				{ ...secondPlugin, enabled: false },
			],
		});
		await secondPending;
	});
	if (action === "toggle") {
		expect(
			getCachedExtensionInventory()?.plugins.map(({ enabled }) => enabled),
		).toEqual([false, false]);
	} else {
		expect(getCachedExtensionInventory()).toBeNull();
	}
});

it("shares failure feedback and clears it when another consumer retries", async () => {
	invoke.mockRejectedValueOnce(new Error("Could not disable skill"));
	await act(async () =>
		root.render(
			<>
				<Consumer name="list" />
				<Consumer name="details" />
			</>,
		),
	);
	await act(async () => {
		await consumer("list").toggleSkill(skill);
	});
	for (const output of container.querySelectorAll("output"))
		expect(output.textContent).toBe("Could not disable skill");
	invoke.mockResolvedValueOnce({ skills: [{ ...skill, enabled: false }] });
	await act(async () => {
		await consumer("details").toggleSkill(skill);
	});
	expect(container.textContent).toBe("idleidle");
});

it("rechecks inventory when another change invalidates a pending toggle response", async () => {
	const workflow = {
		id: "review",
		name: "Review",
		path: "/review.md",
		instructions: "",
	};
	commitExtensionInventoryResponse({ skills: [skill], workflows: [workflow] });
	await act(async () => root.render(<Consumer name="list" />));
	const response = deferred<unknown>();
	invoke.mockReturnValueOnce(response.promise);
	let pending!: ReturnType<
		ReturnType<typeof useExtensionActions>["toggleSkill"]
	>;
	await act(async () => {
		pending = consumer("list").toggleSkill(skill);
	});

	// A workflow deletion can finish while the skill's full-inventory reply is pending.
	invalidateExtensionInventoryCache();
	invoke.mockResolvedValueOnce({ skills: [skill], workflows: [] });
	await fetchExtensionInventory();
	await act(async () => {
		response.resolve({
			skills: [{ ...skill, enabled: false }],
			workflows: [workflow],
		});
		await pending;
	});
	// The earlier refresh may predate the toggle, so re-read both completed changes.
	expect(getCachedExtensionInventory()).toBeNull();
	invoke.mockResolvedValueOnce({
		skills: [{ ...skill, enabled: false }],
		workflows: [],
	});
	const current = await fetchExtensionInventory();
	expect(current.workflows).toEqual([]);
	expect(current.skills[0]?.enabled).toBe(false);
});
