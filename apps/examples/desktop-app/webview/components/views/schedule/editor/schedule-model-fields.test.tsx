// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MODEL_SELECTION_CHANGED_EVENT,
	MODEL_SELECTION_STORAGE_KEY,
	readModelSelectionStorageFromWindow,
} from "@/lib/model-selection";
import { loadProviderModelCatalog } from "@/lib/provider-model-catalog";
import type { ProviderModel } from "@/lib/provider-schema";
import { SCHEDULE_TEMPLATES } from "../schedule-templates";
import type { Schedule } from "../schedule-types";
import { ScheduleModelFields } from "./schedule-model-fields";
import { useScheduleEditor } from "./use-schedule-editor";

const { invoke, subscribeToProviderModels } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribeToProviderModels: vi.fn<
		(
			listener: (providerId: string, models: ProviderModel[]) => void,
		) => () => void
	>(() => () => {}),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: vi.fn(async () => ({
		enabledProviderIds: ["cline", "anthropic"],
		providerModels: {
			cline: ["cline-model"],
			anthropic: ["sonnet-model", "opus-model"],
		},
		providerReasoningModels: { cline: [], anthropic: [] },
		providerNames: { cline: "Cline", anthropic: "Anthropic" },
		providerModelDetails: {
			cline: [{ id: "cline-model", name: "Cline Model" }],
			anthropic: [
				{ id: "sonnet-model", name: "Sonnet" },
				{ id: "opus-model", name: "Opus" },
			],
		},
	})),
	loadProviderModels: async () => [],
	subscribeToProviderModels,
	subscribeToProviderCatalogInvalidation: () => () => {},
}));

const rememberedSelection = {
	lastProvider: "cline",
	lastModelByProvider: { cline: "cline-model" },
};
const refreshSchedules = vi.fn(async () => undefined);
const clearActionError = vi.fn();
let editor: ReturnType<typeof useScheduleEditor>;
let container: HTMLDivElement;
let root: Root;

function Harness({ disabled = false }: { disabled?: boolean }) {
	editor = useScheduleEditor({
		schedules: [],
		refreshSchedules,
		clearActionError,
		setScheduleEnabled: async () => true,
	});
	return editor.isOpen ? (
		<ScheduleModelFields editor={editor} disabled={disabled} />
	) : null;
}

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (typeof window.localStorage?.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	window.localStorage.setItem(
		MODEL_SELECTION_STORAGE_KEY,
		JSON.stringify(rememberedSelection),
	);
	invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "get_process_context")
			return { workspaceRoot: "/workspace/project", cwd: "/workspace/project" };
	});
	refreshSchedules.mockClear();
	clearActionError.mockClear();
	subscribeToProviderModels.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => root.render(<Harness />));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	window.localStorage.clear();
	vi.restoreAllMocks();
});

function picker(kind: "Provider" | "Model") {
	const trigger = container.querySelector<HTMLButtonElement>(
		`button[aria-label^="${kind}:"]`,
	);
	if (!trigger) throw new Error(`${kind} picker is missing`);
	return trigger;
}

function option(label: string) {
	const item = Array.from(
		container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
	).find((element) => element.textContent === label);
	if (!item) throw new Error(`Missing picker option: ${label}`);
	return item;
}

async function choose(kind: "Provider" | "Model", label: string) {
	await act(async () => picker(kind).click());
	await act(async () => option(label).click());
}

describe("ScheduleModelFields", () => {
	it("keeps provider and model choices in the schedule draft without changing chat defaults", async () => {
		const writeStorage = vi.spyOn(Storage.prototype, "setItem");
		const selectionChanged = vi.fn();
		window.addEventListener(MODEL_SELECTION_CHANGED_EVENT, selectionChanged);
		try {
			await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
			expect(
				container.querySelectorAll('[data-slot="detail-list-item"]'),
			).toHaveLength(1);
			await choose("Provider", "Anthropic");
			await choose("Model", "Opus");

			expect(editor.form.provider).toBe("anthropic");
			expect(editor.form.model).toBe("opus-model");
			expect(readModelSelectionStorageFromWindow()).toEqual(
				rememberedSelection,
			);
			expect(writeStorage).not.toHaveBeenCalled();
			expect(selectionChanged).not.toHaveBeenCalled();
			// A chat choosing another model must not overwrite an in-progress schedule.
			await act(async () =>
				window.dispatchEvent(
					new CustomEvent(MODEL_SELECTION_CHANGED_EVENT, {
						detail: { providerId: "cline", modelId: "chat-model" },
					}),
				),
			);
			expect(editor.form.model).toBe("opus-model");
			await act(async () => editor.save());
			expect(invoke).toHaveBeenCalledWith(
				"create_routine_schedule",
				expect.objectContaining({
					provider: "anthropic",
					model: "opus-model",
				}),
			);
			expect(readModelSelectionStorageFromWindow()).toEqual(
				rememberedSelection,
			);
			expect(writeStorage).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener(
				MODEL_SELECTION_CHANGED_EVENT,
				selectionChanged,
			);
		}
	});

	it("disables both pickers and rejects an open model option while the draft is saving", async () => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		await choose("Provider", "Anthropic");
		await act(async () => picker("Model").click());
		const pending = Promise.withResolvers<unknown>();
		invoke.mockImplementation(async (command: string) =>
			command === "create_routine_schedule" ? pending.promise : undefined,
		);
		let saving: ReturnType<typeof editor.save>;
		await act(async () => {
			saving = editor.save();
		});

		expect(picker("Provider").disabled).toBe(true);
		expect(picker("Model").disabled).toBe(true);
		await act(async () => option("Opus").click());
		expect(editor.form.model).toBe("sonnet-model");
		await act(async () => {
			pending.resolve({});
			await saving;
		});
		expect(editor.isOpen).toBe(true);
		expect(invoke).toHaveBeenCalledWith(
			"create_routine_schedule",
			expect.objectContaining({ model: "sonnet-model" }),
		);
	});

	it("rejects an open model option while another schedule action disables the form", async () => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		await choose("Provider", "Anthropic");
		await act(async () => picker("Model").click());
		await act(async () => root.render(<Harness disabled />));
		expect(picker("Provider").disabled).toBe(true);
		expect(picker("Model").disabled).toBe(true);
		await act(async () => option("Opus").click());
		expect(editor.form.model).toBe("sonnet-model");
	});

	it("preserves a saved provider and model missing from the catalog through refresh and save", async () => {
		const schedule: Schedule = {
			scheduleId: "private-schedule",
			name: "Private model review",
			cronPattern: "0 9 * * *",
			prompt: "Review changes",
			provider: "custom-provider",
			model: "private-model",
			mode: "plan",
			workspaceRoot: "/workspace/project",
			maxParallel: 1,
			enabled: true,
			createdAt: 1,
			updatedAt: 1,
		};
		await act(async () => editor.openEdit(schedule));
		expect(picker("Provider").textContent).toContain("custom-provider");
		expect(picker("Model").textContent).toContain("private-model");
		const listener = subscribeToProviderModels.mock.calls.at(-1)?.[0];
		await act(async () =>
			listener?.("custom-provider", [
				{ id: "different-model", name: "Different Model" },
			] as ProviderModel[]),
		);
		await act(async () => picker("Model").click());
		expect(option("private-model")).toBeDefined();
		expect(editor.form.provider).toBe("custom-provider");
		expect(editor.form.model).toBe("private-model");
		await act(async () => editor.save());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				provider: "custom-provider",
				model: "private-model",
			}),
		);
	});

	it("preserves the saved selection when another provider publishes before the initial catalog resolves", async () => {
		const catalog = await loadProviderModelCatalog();
		const pendingCatalog = Promise.withResolvers<typeof catalog>();
		vi.mocked(loadProviderModelCatalog).mockReturnValueOnce(
			pendingCatalog.promise,
		);
		await act(async () =>
			editor.openEdit({
				scheduleId: "private-schedule",
				name: "Private model review",
				cronPattern: "0 9 * * *",
				prompt: "Review changes",
				provider: "custom-provider",
				model: "private-model",
				mode: "plan",
				workspaceRoot: "/workspace/project",
				maxParallel: 1,
				enabled: true,
				createdAt: 1,
				updatedAt: 1,
			}),
		);
		const listener = subscribeToProviderModels.mock.calls.at(-1)?.[0];
		await act(async () =>
			listener?.("anthropic", [{ id: "sonnet-model", name: "Sonnet" }]),
		);
		expect(editor.form.provider).toBe("custom-provider");
		expect(editor.form.model).toBe("private-model");
		expect(picker("Provider").textContent).toContain("custom-provider");
		expect(picker("Model").textContent).toContain("private-model");
		await act(async () => pendingCatalog.resolve(catalog));
		await act(async () => editor.save());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				provider: "custom-provider",
				model: "private-model",
			}),
		);
	});
});
