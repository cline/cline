// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	invalidateExtensionInventoryCache,
} from "./extension-inventory";
import { useExtensionInventory } from "./use-extension-inventory";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
}));

let root: Root;
let container: HTMLDivElement;
function Inventory({ name }: { name: string }) {
	const { inventory, loading, error } = useExtensionInventory();
	return (
		<output aria-label={name}>
			{loading
				? "Loading"
				: (error ?? inventory?.rules.map((rule) => rule.name).join(","))}
		</output>
	);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
const inventory = (name: string) => ({
	rules: [{ name, instructions: "", path: `/rules/${name}.md` }],
});

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invalidateExtensionInventoryCache();
	invoke.mockReset();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	invalidateExtensionInventoryCache();
});

it("shares one reactive inventory across categories and publishes mutations to every consumer", async () => {
	const pending = deferred<ReturnType<typeof inventory>>();
	invoke.mockReturnValue(pending.promise);
	await act(async () =>
		root.render(
			<>
				<Inventory name="first" />
				<Inventory name="second" />
			</>,
		),
	);
	expect(invoke).toHaveBeenCalledOnce();
	expect(container.textContent).toBe("LoadingLoading");
	await act(async () => pending.resolve(inventory("initial")));
	expect(container.textContent).toBe("initialinitial");
	await act(async () => {
		commitExtensionInventoryResponse(inventory("updated"));
	});
	expect(container.textContent).toBe("updatedupdated");
	expect(invoke).toHaveBeenCalledOnce();
});

it.each([
	"success",
	"failure",
])("keeps a mutation when an older read finishes with %s", async (outcome) => {
	const old = deferred<ReturnType<typeof inventory>>();
	invoke.mockReturnValue(old.promise);
	await act(async () => root.render(<Inventory name="inventory" />));
	await act(async () => {
		commitExtensionInventoryResponse(inventory("committed"));
	});
	await act(async () => {
		if (outcome === "success") old.resolve(inventory("obsolete"));
		else old.reject(new Error("obsolete failure"));
	});
	expect(container.textContent).toBe("committed");
});

it("reconciles invalidation while unmounted instead of returning a previous consumer's inventory", async () => {
	invoke.mockResolvedValueOnce(inventory("old"));
	await act(async () => root.render(<Inventory name="inventory" />));
	await act(async () => root.render(null));
	invalidateExtensionInventoryCache();
	const next = deferred<ReturnType<typeof inventory>>();
	invoke.mockReturnValueOnce(next.promise);
	await act(async () => root.render(<Inventory name="inventory" />));
	expect(container.textContent).toBe("Loading");
	await act(async () => next.resolve(inventory("new")));
	expect(container.textContent).toBe("new");
});
