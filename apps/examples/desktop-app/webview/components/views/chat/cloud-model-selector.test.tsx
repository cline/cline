// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudPickerModel } from "@/lib/cloud-model-catalog";
import { CloudModelSelector } from "./cloud-model-selector";

const { loadCatalog, subscribe, account } = vi.hoisted(() => ({
	loadCatalog: vi.fn(),
	subscribe: vi.fn(() => vi.fn()),
	account: {
		user: { id: "user" },
		activeOrganization: null as { id: string } | null,
	},
}));
vi.mock("@/lib/cloud-model-catalog", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/cloud-model-catalog")>()),
	loadCloudModelCatalog: loadCatalog,
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { subscribe } }));
vi.mock("@/contexts/account-context", () => ({ useAccount: () => account }));

const models: CloudPickerModel[] = [
	{
		id: "paid",
		name: "Paid model",
		catalogId: "cline",
		inputModalities: ["text", "image"],
	},
	{
		id: "cline-pass/pass",
		name: "Pass model",
		catalogId: "cline-pass",
		supportsReasoning: true,
	},
	{ id: "cline-cloud/free", name: "Free model", catalogId: "cline-cloud" },
];
let root: Root;
let container: HTMLDivElement;
let onModelChange: ReturnType<typeof vi.fn>;
let onPending: ReturnType<typeof vi.fn>;
let onImages: ReturnType<typeof vi.fn>;
let onReasoning: ReturnType<typeof vi.fn>;

function Harness({
	initialModel = "paid",
	active = false,
}: {
	initialModel?: string;
	active?: boolean;
}) {
	const [model, setModel] = useState(initialModel);
	return (
		<CloudModelSelector
			isBusy={false}
			model={model}
			preserveUnavailableModel={active}
			onModelChange={(value) => {
				onModelChange(value);
				setModel(value);
			}}
			onSelectionPendingChange={onPending}
			onModelSupportsImagesChange={onImages}
			onModelSupportsReasoningChange={onReasoning}
		/>
	);
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
	await act(async () => root.render(<Harness {...props} />));
}
async function open(label: string) {
	const button = container.querySelector<HTMLButtonElement>(
		`[aria-label^="${label}:"]`,
	);
	expect(button).not.toBeNull();
	await act(async () => button?.click());
}
async function choose(label: string) {
	const button = [
		...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
	].find((option) => option.textContent?.includes(label));
	expect(button).toBeDefined();
	await act(async () => button?.click());
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollIntoView = vi.fn();
	account.activeOrganization = null;
	subscribe.mockClear();
	loadCatalog.mockReset().mockResolvedValue(models);
	onModelChange = vi.fn();
	onPending = vi.fn();
	onImages = vi.fn();
	onReasoning = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("cloud model selection", () => {
	it("switches all three catalogs by model ID and waits for an explicit model selection", async () => {
		await render();
		expect(onImages).toHaveBeenLastCalledWith(true);
		await open("Provider");
		for (const label of ["Cline Usage-Billing", "ClinePass", "ClineFree"]) {
			expect(container.textContent).toContain(label);
		}
		expect(container.textContent).not.toContain("Set up another provider");
		await choose("ClinePass");
		expect(onModelChange).not.toHaveBeenCalled();
		expect(onPending).toHaveBeenLastCalledWith(true);
		await open("Model");
		await choose("Pass model");
		expect(onModelChange).toHaveBeenLastCalledWith("cline-pass/pass");
		expect(onReasoning).toHaveBeenLastCalledWith(true);
		expect(onPending).toHaveBeenLastCalledWith(false);
		await open("Provider");
		await choose("ClineFree");
		await open("Model");
		await choose("Free model");
		expect(onModelChange).toHaveBeenLastCalledWith("cline-cloud/free");
		await open("Provider");
		await choose("Cline Usage-Billing");
		await open("Model");
		await choose("Paid model");
		expect(onModelChange).toHaveBeenLastCalledWith("paid");
	});

	it("prefers a free model for a new session with an unavailable local model", async () => {
		await render({ initialModel: "local-only" });
		expect(onModelChange).toHaveBeenCalledExactlyOnceWith("cline-cloud/free");
		expect(onPending).toHaveBeenLastCalledWith(false);
	});

	it("preserves an existing session's unavailable model and its catalog", async () => {
		await render({ initialModel: "cline-pass/retired", active: true });
		expect(onModelChange).not.toHaveBeenCalled();
		expect(onPending).toHaveBeenLastCalledWith(false);
		expect(container.textContent).toContain("ClinePass");
		expect(container.textContent).toContain("cline-pass/retired");
	});

	it("hides Pass after an account switch and ignores an old in-flight catalog", async () => {
		let resolveOld!: (models: CloudPickerModel[]) => void;
		loadCatalog.mockReturnValueOnce(
			new Promise<CloudPickerModel[]>((resolve) => {
				resolveOld = resolve;
			}),
		);
		await render({ initialModel: "cline-pass/pass" });
		account.activeOrganization = { id: "org" };
		loadCatalog.mockResolvedValue(
			models.filter((model) => model.catalogId !== "cline-pass"),
		);
		await render();
		await act(async () => resolveOld(models));
		await open("Provider");
		expect(container.textContent).not.toContain("ClinePass");
		expect(onModelChange).toHaveBeenLastCalledWith("cline-cloud/free");
	});

	it("blocks a new session on catalog failure and supports retry without choosing a local model", async () => {
		loadCatalog.mockRejectedValueOnce(new Error("offline"));
		await render();
		expect(onPending).toHaveBeenLastCalledWith(true);
		expect(onModelChange).not.toHaveBeenCalled();
		const retry = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Retry"),
		);
		expect(retry).toBeDefined();
		await act(async () => retry?.click());
		expect(onPending).toHaveBeenLastCalledWith(false);
	});

	it("allows continuation of an existing cloud session when the catalog is offline", async () => {
		loadCatalog.mockRejectedValueOnce(new Error("offline"));
		await render({ initialModel: "cline-cloud/free", active: true });
		expect(onPending).toHaveBeenLastCalledWith(false);
		expect(onModelChange).not.toHaveBeenCalled();
	});
});
