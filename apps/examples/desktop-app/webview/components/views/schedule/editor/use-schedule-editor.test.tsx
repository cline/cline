// @vitest-environment jsdom

import { ANTHROPIC_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderModelCatalog } from "@/lib/provider-model-catalog";
import {
	LOCAL_WORKSPACE_ENVIRONMENT_ID,
	writeWorkspaceSelectionToWindow,
} from "@/lib/workspace-paths";
import { SCHEDULE_TEMPLATES } from "../schedule-templates";
import type { Schedule } from "../schedule-types";
import { useScheduleEditor } from "./use-schedule-editor";

const { invoke, readSelection, loadCatalog } = vi.hoisted(() => ({
	invoke: vi.fn(),
	readSelection: vi.fn(),
	loadCatalog: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
}));
vi.mock("@/lib/model-selection", () => ({
	readModelSelectionStorageFromWindow: readSelection,
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: loadCatalog,
}));

const catalog: ProviderModelCatalog = {
	providers: [],
	enabledProviderIds: ["cline-pass", "anthropic"],
	providerModels: {
		"cline-pass": ["pass-first", "pass-second"],
		anthropic: ["anthropic-first", "anthropic-remembered"],
	},
	providerModelDetails: {},
	providerNames: {},
	providerReasoningModels: {},
	voiceInput: null,
};

const savedSchedule: Schedule = {
	scheduleId: "saved-schedule",
	name: "Existing schedule",
	cronPattern: "0 9 * * *",
	prompt: "Review changes",
	provider: "cline",
	model: "cline-test",
	mode: "plan",
	workspaceRoot: "/workspace/project",
	maxParallel: 1,
	enabled: true,
	createdAt: 1,
	updatedAt: 1,
};

const refreshSchedules = vi.fn(async () => undefined);
const clearActionError = vi.fn();
const setScheduleEnabled = vi.fn(async () => true);
let editor: ReturnType<typeof useScheduleEditor>;
let container: HTMLDivElement;
let root: Root;

function Harness() {
	editor = useScheduleEditor({
		schedules: [],
		refreshSchedules,
		clearActionError,
		setScheduleEnabled,
	});
	return null;
}

beforeEach(async () => {
	vi.useFakeTimers();
	if (typeof window.localStorage?.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	});
	invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "get_process_context") {
			return {
				workspaceRoot: "/workspace/project",
				cwd: "/workspace/project/src",
			};
		}
	});
	readSelection.mockReset().mockReturnValue({
		lastProvider: "anthropic",
		lastModelByProvider: { anthropic: "anthropic-remembered" },
	});
	loadCatalog.mockReset().mockResolvedValue(catalog);
	refreshSchedules.mockClear();
	clearActionError.mockClear();
	setScheduleEnabled.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => root.render(<Harness />));
	await act(async () => vi.advanceTimersByTimeAsync(0));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	window.localStorage.clear();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("schedule editor", () => {
	it("starts each new schedule in YOLO mode after a different draft mode", async () => {
		expect(editor.form.mode).toBe("yolo");
		await act(async () => editor.openCreate());
		expect(editor.form.mode).toBe("yolo");
		await act(async () =>
			editor.setForm((form) => ({ ...form, mode: "plan" })),
		);
		await act(async () => editor.dismissEditor());
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		expect(editor.form.mode).toBe("yolo");
	});

	it.each([
		"act",
		"plan",
	] as const)("creates a schedule with the selected %s mode", async (mode) => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		await act(async () => editor.setForm((form) => ({ ...form, mode })));
		await act(async () => editor.save());
		expect(invoke).toHaveBeenCalledWith(
			"create_routine_schedule",
			expect.objectContaining({ mode }),
		);
	});

	it.each([
		{ mode: "act", savedMode: "act" },
		{ mode: "plan", savedMode: "plan" },
		{ mode: "yolo", savedMode: "yolo" },
		{ mode: "yolo", savedMode: "plan" },
	] as const)("loads $mode mode and saves $savedMode mode", async ({
		mode,
		savedMode,
	}) => {
		await act(async () =>
			editor.openEdit({
				...savedSchedule,
				scheduleId: "saved-mode",
				mode,
			}),
		);
		expect(editor.form.mode).toBe(mode);
		await act(async () =>
			editor.setForm((form) => ({
				...form,
				name: "Renamed schedule",
				...(savedMode !== mode ? { mode: savedMode } : {}),
			})),
		);
		await act(async () => editor.save());
		expect(invoke).toHaveBeenCalledExactlyOnceWith(
			"update_routine_schedule",
			expect.objectContaining({ schedule_id: "saved-mode", mode: savedMode }),
		);
	});

	it("uses the current remembered local project immediately instead of the launch folder", async () => {
		writeWorkspaceSelectionToWindow(LOCAL_WORKSPACE_ENVIRONMENT_ID, {
			lastWorkspace: "/work/remembered-project",
			workspaces: [],
		});
		invoke.mockResolvedValue({ workspaceRoot: "/", cwd: "/" });
		const pendingCatalog = Promise.withResolvers<ProviderModelCatalog>();
		loadCatalog.mockReturnValueOnce(pendingCatalog.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate();
		});
		expect(editor.form.workspaceRoot).toBe("/work/remembered-project");
		expect(invoke).not.toHaveBeenCalledWith(
			"get_process_context",
			expect.anything(),
		);
		await act(async () => {
			pendingCatalog.resolve(catalog);
			await pendingOpen;
		});
		await act(async () => editor.dismissEditor());
		writeWorkspaceSelectionToWindow(LOCAL_WORKSPACE_ENVIRONMENT_ID, {
			lastWorkspace: "/work/another-project",
			workspaces: [],
		});
		await act(async () => editor.openCreate());
		expect(editor.form.workspaceRoot).toBe("/work/another-project");
	});

	it.each([
		"/",
		"\\",
		"C:\\",
		"C:/",
	])("leaves the project blank when process context only offers root %s", async (rootPath) => {
		invoke.mockResolvedValue({ workspaceRoot: rootPath, cwd: rootPath });
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		expect(editor.form.workspaceRoot).toBe("");
		expect(invoke).toHaveBeenCalledWith("get_process_context", {
			environmentId: LOCAL_WORKSPACE_ENVIRONMENT_ID,
		});
		await act(async () => editor.save());
		expect(editor.error).toBe("Choose a project folder.");
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("falls back to a meaningful local process cwd when remembered and process roots are unusable", async () => {
		writeWorkspaceSelectionToWindow(LOCAL_WORKSPACE_ENVIRONMENT_ID, {
			lastWorkspace: "/",
			workspaces: [],
		});
		invoke.mockResolvedValue({
			workspaceRoot: "/",
			cwd: "/work/local-project",
		});
		await act(async () => editor.openCreate());
		expect(editor.form.workspaceRoot).toBe("/work/local-project");
	});

	it("ignores remote workspace memory and explicitly requests local process context", async () => {
		writeWorkspaceSelectionToWindow("ssh-host", {
			lastWorkspace: "/remote/project",
			workspaces: [],
		});
		invoke.mockImplementation(
			async (_command: string, args?: { environmentId?: string }) =>
				args?.environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID
					? { workspaceRoot: "/", cwd: "/" }
					: { workspaceRoot: "/remote/project", cwd: "/remote/project" },
		);
		await act(async () => editor.openCreate());
		expect(editor.form.workspaceRoot).toBe("");
		expect(invoke).toHaveBeenCalledExactlyOnceWith("get_process_context", {
			environmentId: LOCAL_WORKSPACE_ENVIRONMENT_ID,
		});
	});

	it("leaves an existing saved root folder unchanged", async () => {
		writeWorkspaceSelectionToWindow(LOCAL_WORKSPACE_ENVIRONMENT_ID, {
			lastWorkspace: "/work/remembered-project",
			workspaces: [],
		});
		await act(async () =>
			editor.openEdit({
				...savedSchedule,
				scheduleId: "saved-root",
				name: "Existing root schedule",
				workspaceRoot: "/",
			}),
		);
		expect(editor.form.workspaceRoot).toBe("/");
		expect(invoke).not.toHaveBeenCalled();
	});

	it("defaults to the first configured provider and model without a remembered choice", async () => {
		readSelection.mockReturnValue({
			lastProvider: "",
			lastModelByProvider: {},
		});
		await act(async () => editor.openCreate());
		expect(editor.form.provider).toBe("cline-pass");
		expect(editor.form.model).toBe("pass-first");
	});

	it("keeps an available remembered provider and model", async () => {
		await act(async () => editor.openCreate());
		expect(editor.form.provider).toBe("anthropic");
		expect(editor.form.model).toBe("anthropic-remembered");
	});

	it("keeps a remembered built-in provider still listed in the catalog", async () => {
		loadCatalog.mockResolvedValueOnce({
			...catalog,
			enabledProviderIds: ["cline-pass"],
		});
		await act(async () => editor.openCreate());
		expect(editor.form.provider).toBe("anthropic");
		expect(editor.form.model).toBe("anthropic-remembered");
	});

	it("uses the provider's first model when the remembered model is unavailable", async () => {
		readSelection.mockReturnValue({
			lastProvider: "anthropic",
			lastModelByProvider: { anthropic: "retired-model" },
		});
		await act(async () => editor.openCreate());
		expect(editor.form.provider).toBe("anthropic");
		expect(editor.form.model).toBe("anthropic-first");
	});

	it("uses the first configured provider when the remembered provider is unavailable", async () => {
		readSelection.mockReturnValue({
			lastProvider: "removed-provider",
			lastModelByProvider: { "removed-provider": "removed-model" },
		});
		await act(async () => editor.openCreate());
		expect(editor.form.provider).toBe("cline-pass");
		expect(editor.form.model).toBe("pass-first");
	});

	it.each([
		{
			label: "preserves a nested cwd when the project folder is unchanged",
			cwd: "/workspace/project/src",
			workspaceRoot: "/workspace/project",
			expectedCwd: "/workspace/project/src",
		},
		{
			label:
				"preserves a nested cwd for an equivalent folder with trailing separators and whitespace",
			cwd: "/workspace/project/src",
			workspaceRoot: " /workspace/project/ ",
			expectedCwd: "/workspace/project/src",
		},
		{
			label: "preserves an unset cwd when the project folder is unchanged",
			cwd: undefined,
			workspaceRoot: "/workspace/project",
			expectedCwd: null,
		},
		{
			label: "moves cwd to the selected project folder when it changes",
			cwd: "/workspace/project/src",
			workspaceRoot: "/workspace/other-project",
			expectedCwd: "/workspace/other-project",
		},
	])("$label", async ({ cwd, workspaceRoot, expectedCwd }) => {
		const schedule: Schedule = {
			...savedSchedule,
			scheduleId: "workspace-review",
			name: "Workspace review",
			cwd,
		};
		await act(async () => editor.openEdit(schedule));
		await act(async () =>
			editor.setForm((form) => ({ ...form, workspaceRoot })),
		);
		await act(async () => editor.save());

		expect(invoke).toHaveBeenCalledExactlyOnceWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: schedule.scheduleId,
				workspace_root: workspaceRoot.trim(),
				cwd: expectedCwd,
			}),
		);
	});

	it.each([
		"failure",
		"empty",
	])("keeps original provider fallbacks after catalog %s", async (result) => {
		if (result === "failure")
			loadCatalog.mockRejectedValueOnce(new Error("Offline"));
		else
			loadCatalog.mockResolvedValueOnce({
				...catalog,
				enabledProviderIds: [],
				providerModels: {},
			});
		await act(async () => editor.openCreate());
		expect(editor.form.provider).toBe("anthropic");
		expect(editor.form.model).toBe(ANTHROPIC_DEFAULT_MODEL_ID);
		expect(editor.form.workspaceRoot).toBe("/workspace/project");
	});

	it("does not overwrite a manually changed provider and model with late defaults", async () => {
		const pendingCatalog = Promise.withResolvers<ProviderModelCatalog>();
		loadCatalog.mockReturnValueOnce(pendingCatalog.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate();
		});
		expect(editor.form.workspaceRoot).toBe("/workspace/project");
		await act(async () =>
			editor.setForm((form) => ({
				...form,
				provider: "manual-provider",
				model: "manual-model",
			})),
		);
		await act(async () => {
			pendingCatalog.resolve(catalog);
			await pendingOpen;
		});
		expect(editor.form.provider).toBe("manual-provider");
		expect(editor.form.model).toBe("manual-model");
	});

	it("does not apply pending create defaults to a saved schedule opened afterward", async () => {
		const pendingCatalog = Promise.withResolvers<ProviderModelCatalog>();
		loadCatalog.mockReturnValueOnce(pendingCatalog.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate();
		});
		await act(async () =>
			editor.openEdit({
				...savedSchedule,
				name: "Saved schedule",
				provider: "saved-provider",
				model: "saved-model",
				workspaceRoot: "/saved/project",
			}),
		);
		await act(async () => {
			pendingCatalog.resolve(catalog);
			await pendingOpen;
		});
		expect(editor.form.provider).toBe("saved-provider");
		expect(editor.form.model).toBe("saved-model");
		expect(editor.form.workspaceRoot).toBe("/saved/project");
		expect(loadCatalog).toHaveBeenCalledOnce();
	});

	it("does not change the submitted selection when defaults arrive after a failed save", async () => {
		const pendingCatalog = Promise.withResolvers<ProviderModelCatalog>();
		loadCatalog.mockReturnValueOnce(pendingCatalog.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate(SCHEDULE_TEMPLATES[0]);
		});
		invoke.mockRejectedValueOnce(new Error("Save failed"));
		await act(async () => editor.save());
		expect(editor.error).toBe("Save failed");
		await act(async () => {
			pendingCatalog.resolve(catalog);
			await pendingOpen;
		});
		expect(editor.form.provider).toBe("anthropic");
		expect(editor.form.model).toBe(ANTHROPIC_DEFAULT_MODEL_ID);
		expect(invoke).toHaveBeenCalledWith(
			"create_routine_schedule",
			expect.objectContaining({
				provider: "anthropic",
				model: ANTHROPIC_DEFAULT_MODEL_ID,
			}),
		);
	});

	it("opens immediately and preserves other edits when workspace defaults arrive", async () => {
		const context = Promise.withResolvers<{
			workspaceRoot: string;
			cwd: string;
		}>();
		invoke.mockReturnValueOnce(context.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate();
		});
		expect(editor.isOpen).toBe(true);
		await act(async () =>
			editor.setForm((form) => ({ ...form, name: "My new schedule" })),
		);
		await act(async () => {
			context.resolve({ workspaceRoot: "/late/default", cwd: "/late/default" });
			await pendingOpen;
		});
		expect(editor.form.name).toBe("My new schedule");
		expect(editor.form.workspaceRoot).toBe("/late/default");
	});

	it("does not replace a workspace changed and cleared while context loads", async () => {
		const context = Promise.withResolvers<{
			workspaceRoot: string;
			cwd: string;
		}>();
		invoke.mockReturnValueOnce(context.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate();
		});
		await act(async () => {
			editor.setForm((form) => ({ ...form, workspaceRoot: "/my/project" }));
			editor.setForm((form) => ({ ...form, workspaceRoot: "" }));
		});
		await act(async () => {
			context.resolve({ workspaceRoot: "/late/default", cwd: "/late/default" });
			await pendingOpen;
		});
		expect(editor.form.workspaceRoot).toBe("");
	});

	it("does not reopen a cancelled editor after its context request completes", async () => {
		const context = Promise.withResolvers<{
			workspaceRoot: string;
			cwd: string;
		}>();
		invoke.mockReturnValueOnce(context.promise);
		let pendingOpen: Promise<void>;
		await act(async () => {
			pendingOpen = editor.openCreate(SCHEDULE_TEMPLATES[0]);
		});
		await act(async () => editor.dismissEditor());
		await act(async () => {
			context.resolve({ workspaceRoot: "/late/default", cwd: "/late/default" });
			await pendingOpen;
		});
		expect(editor.isOpen).toBe(false);
		expect(editor.form.workspaceRoot).toBe("");
	});

	it("ignores an older context lookup after another editor opens", async () => {
		const first = Promise.withResolvers<{
			workspaceRoot: string;
			cwd: string;
		}>();
		const second = Promise.withResolvers<{
			workspaceRoot: string;
			cwd: string;
		}>();
		invoke
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		let firstOpen: Promise<void>;
		let secondOpen: Promise<void>;
		await act(async () => {
			firstOpen = editor.openCreate(SCHEDULE_TEMPLATES[0]);
		});
		await act(async () => {
			secondOpen = editor.openCreate(SCHEDULE_TEMPLATES[1]);
		});
		await act(async () => {
			second.resolve({
				workspaceRoot: "/current/project",
				cwd: "/current/project",
			});
			await secondOpen;
			first.resolve({ workspaceRoot: "/stale/project", cwd: "/stale/project" });
			await firstOpen;
		});
		expect(editor.form.name).toBe(SCHEDULE_TEMPLATES[1].name);
		expect(editor.form.workspaceRoot).toBe("/current/project");
	});

	it("submits once for duplicate saves and briefly confirms success", async () => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		const response = Promise.withResolvers<unknown>();
		invoke.mockClear().mockReturnValueOnce(response.promise);
		let pendingSave: ReturnType<typeof editor.save>;
		await act(async () => {
			pendingSave = editor.save();
			void editor.save();
		});
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(editor.isOpen).toBe(true);
		expect(editor.isSaving).toBe(true);
		expect(editor.isSaved).toBe(false);
		await act(async () => {
			response.resolve({});
			await pendingSave;
		});
		expect(editor.isOpen).toBe(true);
		expect(editor.isSaving).toBe(false);
		expect(editor.isSaved).toBe(true);
		expect(refreshSchedules).toHaveBeenCalledOnce();
		await act(async () => vi.advanceTimersByTimeAsync(2_999));
		expect(editor.isSaved).toBe(true);
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(editor.isSaved).toBe(false);
		expect(editor.isOpen).toBe(true);
	});

	it("keeps the draft and error available after a failed save", async () => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		await act(async () =>
			editor.setForm((form) => ({
				...form,
				description: "My edited description",
			})),
		);
		invoke.mockRejectedValueOnce(new Error("Schedule could not be saved"));
		await act(async () => editor.save());
		expect(editor.isOpen).toBe(true);
		expect(editor.isSaving).toBe(false);
		expect(editor.isSaved).toBe(false);
		expect(editor.error).toBe("Schedule could not be saved");
		expect(editor.form.name).toBe(SCHEDULE_TEMPLATES[0].name);
		expect(editor.form.description).toBe("My edited description");
		expect(refreshSchedules).not.toHaveBeenCalled();
	});

	it.each([
		"1.5",
		"1e3",
		"0",
		"-1",
		"9007199254740993",
		"9".repeat(310),
	])("rejects an invalid timeout without changing the saved schedule: %s", async (timeoutSeconds) => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		invoke.mockClear();
		await act(async () =>
			editor.setForm((form) => ({ ...form, timeoutSeconds })),
		);
		await act(async () => expect(await editor.save()).toBe(false));
		expect(editor.validation?.field).toBe("timeoutSeconds");
		expect(editor.form.timeoutSeconds).toBe(timeoutSeconds);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("does not refresh or navigate after unmounting during a save", async () => {
		await act(async () => editor.openCreate(SCHEDULE_TEMPLATES[0]));
		const response = Promise.withResolvers<unknown>();
		invoke.mockReturnValueOnce(response.promise);
		let pendingSave: ReturnType<typeof editor.save>;
		await act(async () => {
			pendingSave = editor.save();
		});
		await act(async () => root.render(null));
		await act(async () => {
			response.resolve({});
			await pendingSave;
		});
		expect(refreshSchedules).not.toHaveBeenCalled();
	});

	it("prefills a suggestion and creates it with the remembered model and local timezone", async () => {
		const template = SCHEDULE_TEMPLATES.find(
			(item) => item.id === "security-scan",
		);
		if (!template) throw new Error("Security scan suggestion is missing");
		await act(async () => editor.openCreate(template));
		await act(async () => vi.advanceTimersByTimeAsync(0));

		expect(editor.form.name).toBe(template.name);
		expect(editor.form.description).toBe(template.description);
		expect(editor.form.prompt).toBe(template.prompt);
		expect(editor.form.workspaceRoot).toBe("/workspace/project");
		expect(editor.form.scheduleHour).toBe("8");
		await act(async () =>
			editor.setForm((form) => ({
				...form,
				description: "  Review authentication changes.\nSummarize risks.  ",
			})),
		);

		await act(async () => editor.save());

		expect(invoke).toHaveBeenCalledWith(
			"create_routine_schedule",
			expect.objectContaining({
				name: template.name,
				description: "Review authentication changes.\nSummarize risks.",
				prompt: template.prompt,
				schedule_type: "recurring",
				cron_pattern: "0 8 * * MON",
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				provider: "anthropic",
				model: "anthropic-remembered",
				mode: "yolo",
				workspace_root: "/workspace/project",
				cwd: "/workspace/project",
				enabled: true,
			}),
		);
		expect(refreshSchedules).toHaveBeenCalledExactlyOnceWith({
			showLoading: false,
		});
		expect(editor.isOpen).toBe(true);
		expect(editor.isSaved).toBe(true);
		expect(editor.hasUnsavedChanges).toBe(false);
		await act(async () =>
			editor.setForm((form) => ({ ...form, name: "Updated security review" })),
		);
		expect(editor.isSaved).toBe(false);
		expect(editor.hasUnsavedChanges).toBe(true);
	});

	it.each([
		undefined,
		"Asia/Tokyo",
	])("preserves an advanced cron and timezone %s when only the name changes", async (timezone) => {
		const schedule: Schedule = {
			...savedSchedule,
			scheduleId: "monthly-review",
			name: "Monthly review",
			cronPattern: "0 9 1 * *",
			timezone,
			cwd: "/workspace/project/src",
			enabled: false,
		};
		await act(async () => editor.openEdit(schedule));
		expect(editor.form.description).toBe("");
		await act(async () => vi.advanceTimersByTimeAsync(0));
		await act(async () =>
			editor.setForm((form) => ({ ...form, name: "Renamed review" })),
		);

		await act(async () => editor.save());

		expect(invoke).toHaveBeenCalledExactlyOnceWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: schedule.scheduleId,
				name: "Renamed review",
				description: "",
				cron_pattern: "0 9 1 * *",
				timezone,
				provider: "cline",
				model: "cline-test",
				mode: "plan",
				cwd: "/workspace/project/src",
				enabled: false,
			}),
		);
		expect(refreshSchedules).toHaveBeenCalledExactlyOnceWith({
			showLoading: false,
		});
		expect(editor.isOpen).toBe(true);
		expect(editor.isSaved).toBe(true);
	});
});
