/**
 * Helpers for Factory settings page tests. A page renders with a fake shell
 * whose `client` answers only the commands a test gives it; every other
 * command rejects as "not available in this build", like the sidecar does
 * for a command it does not know.
 *
 * In a test file:
 *
 *   vi.mock("@/components/ui/select", async () =>
 *     (await import("./test-utils")).nativeSelectModule(),
 *   );
 *   const page = await renderSettingsPage(settingsPage, {
 *     client: { getStorage: async () => storage },
 *   });
 *   page.control("diskUse"); page.button("Remove finished copies…");
 */

import {
	type FactoryWorkflowConfig,
	factoryWorkflowConfigSchema,
} from "@cline/shared/browser";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import {
	HANDS_OFF_PRESET_CONFIG,
	HANDS_OFF_PRESET_NAME,
} from "@/lib/factory-presets";
import {
	type FactoryProjects,
	type FactorySettingsClient,
	FactorySettingsUnavailable,
	factorySettingsClient,
} from "@/lib/factory-settings-client";
import type { DefaultWorkflow } from "./default-workflow";
import type {
	SettingsFocus,
	SettingsPageDefinition,
	SettingsShell,
} from "./types";
import type { SettingsResource } from "./use-settings-resource";

type ClientOverrides = {
	[K in keyof FactorySettingsClient]?: (
		...args: Parameters<FactorySettingsClient[K]>
	) => Promise<Awaited<ReturnType<FactorySettingsClient[K]>>>;
};

/** A client whose every method is a `vi.fn`: given ones answer, the rest are unavailable. */
export function mockClient(overrides: ClientOverrides = {}) {
	const client = Object.fromEntries(
		Object.keys(factorySettingsClient).map((name) => [
			name,
			vi.fn(
				(overrides as Record<string, (...args: unknown[]) => unknown>)[name] ??
					(async () => {
						throw new FactorySettingsUnavailable(name, "build");
					}),
			),
		]),
	);
	return client as unknown as {
		[K in keyof FactorySettingsClient]: FactorySettingsClient[K] &
			ReturnType<typeof vi.fn>;
	};
}

/** A resource already read: ready with `data`, or in the given state. */
export function resource<T>(
	data: T | undefined,
	status: SettingsResource<T>["status"] = data === undefined
		? "unavailable"
		: "ready",
): SettingsResource<T> {
	return {
		status,
		data,
		unavailable: status === "unavailable" ? "build" : undefined,
		reload: vi.fn(),
		set: vi.fn(),
	};
}

/** The default workflow as the shell hands it to a page; `commit` records. */
export function fakeWorkflow(
	config: Partial<FactoryWorkflowConfig> = {},
): DefaultWorkflow {
	const parsed = factoryWorkflowConfigSchema.parse({
		...HANDS_OFF_PRESET_CONFIG,
		...config,
	});
	return {
		config: parsed,
		edit: vi.fn(),
		flush: vi.fn(),
		commit: vi.fn(),
		errorFor: () => undefined,
		name: HANDS_OFF_PRESET_NAME,
		presets: {
			presets: [{ name: HANDS_OFF_PRESET_NAME, config: parsed }],
			setPresets: vi.fn(),
			defaultPreset: HANDS_OFF_PRESET_NAME,
			setDefaultPreset: vi.fn(),
			loading: false,
			error: null,
			reload: vi.fn(),
		},
	} as unknown as DefaultWorkflow;
}

export function fakeShell(
	overrides: Partial<SettingsShell> & { client?: SettingsShell["client"] } = {},
): SettingsShell {
	return {
		workflow: fakeWorkflow(),
		limits: {
			limits: {
				supported: true,
				concurrency: 2,
				paused: false,
				dailyCostUsd: 50,
				spentTodayUsd: 0,
			},
			loading: false,
			saving: false,
			error: null,
			errorFor: null,
			setConcurrency: vi.fn(),
			setDailyCostUsd: vi.fn(),
			setPaused: vi.fn(),
			reload: vi.fn(),
		} as unknown as SettingsShell["limits"],
		client: mockClient(),
		projects: ["/work/app"],
		project: "/work/app",
		setProject: vi.fn(),
		projectsSummary: resource<FactoryProjects>(undefined),
		open: vi.fn(),
		askFactory: vi.fn(),
		openAppSettings: vi.fn(),
		openArchive: vi.fn(),
		openCard: vi.fn(),
		newWork: vi.fn(),
		saved: vi.fn(),
		readOnly: false,
		folded: false,
		...overrides,
	};
}

/**
 * Renders one page with a fake shell. `client` overrides answer commands;
 * the result has the shell (its `vi.fn`s), the container and finders.
 */
export async function renderSettingsPage(
	definition: SettingsPageDefinition,
	{
		client,
		shell: shellOverrides,
		focus,
	}: {
		client?: ClientOverrides;
		shell?: Partial<SettingsShell>;
		focus?: Omit<SettingsFocus, "page">;
	} = {},
) {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const shell = fakeShell({ client: mockClient(client), ...shellOverrides });
	const { Page } = definition;
	const render = async (next: SettingsShell = shell) => {
		await act(async () =>
			root.render(<Page shell={next} headingId="page-heading" focus={focus} />),
		);
		await act(async () => {});
	};
	await render();
	return {
		container,
		shell,
		/** Renders again, with a changed shell. */
		rerender: render,
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
		row: (id: string) =>
			container.querySelector<HTMLElement>(`[data-setting="${id}"]`),
		/** A row's control: its select, input, switch or button. */
		control: <T extends HTMLElement = HTMLElement>(id: string) =>
			container.querySelector<T>(
				`[data-setting="${id}"] [data-setting-control], [data-setting="${id}"] select, [data-setting="${id}"] input, [data-setting="${id}"] [role="switch"], [data-setting="${id}"] button`,
			),
		/** Buttons by accessible name or text, anywhere in the document (dialogs too). */
		buttons: (name: string | RegExp) =>
			[...document.querySelectorAll("button")].filter((button) => {
				const label =
					button.getAttribute("aria-label") ?? button.textContent ?? "";
				return typeof name === "string" ? label === name : name.test(label);
			}),
		text: () => container.textContent ?? "",
	};
}

export async function click(element: Element | null | undefined) {
	await act(async () => (element as HTMLElement | undefined)?.click());
	await act(async () => {});
}

/** Picks a value in a native select (see `nativeSelectModule`). */
export async function choose(select: HTMLSelectElement | null, value: string) {
	if (!select) throw new Error("No select");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLSelectElement.prototype,
			"value",
		)?.set?.call(select, value);
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await act(async () => {});
}

/** Types into a field (React sees the change); blur or Enter commits. */
export async function type(
	input: HTMLInputElement | HTMLTextAreaElement | null,
	value: string,
) {
	if (!input) throw new Error("No input");
	await act(async () => {
		input.focus();
		const proto =
			input instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

export async function blur(element: HTMLElement | null) {
	await act(async () => element?.blur());
	await act(async () => {});
}

/**
 * The app's Radix select as a native one (the trigger's labels go on it), for
 * `vi.mock("@/components/ui/select", …)`.
 */
export function nativeSelectModule() {
	type Ctx = {
		value?: string;
		disabled?: boolean;
		onValueChange: (value: string) => void;
		trigger: Record<string, unknown>;
	};
	const Context = React.createContext<Ctx | null>(null);
	return {
		Select: ({
			value,
			disabled,
			onValueChange,
			children,
		}: Omit<Ctx, "trigger"> & { children: React.ReactNode }) => (
			<Context.Provider value={{ value, disabled, onValueChange, trigger: {} }}>
				{children}
			</Context.Provider>
		),
		SelectTrigger: ({
			children: _children,
			className: _className,
			size: _size,
			...props
		}: Record<string, unknown>) => {
			const context = React.useContext(Context);
			if (context) Object.assign(context.trigger, props);
			return null;
		},
		SelectValue: () => null,
		SelectContent: ({ children }: { children: React.ReactNode }) => {
			const context = React.useContext(Context);
			return (
				<select
					{...(context?.trigger ?? {})}
					value={context?.value ?? ""}
					disabled={context?.disabled}
					onChange={(event) => context?.onValueChange(event.target.value)}
				>
					{children}
				</select>
			);
		},
		SelectItem: ({
			value,
			disabled,
			children,
		}: {
			value: string;
			disabled?: boolean;
			children: React.ReactNode;
		}) => (
			<option value={value} disabled={disabled}>
				{children}
			</option>
		),
	};
}

/**
 * The structural "no dead rows" check: every row on screen has a control, a
 * link or button, or a disclosure. Returns the ids of rows that do not.
 */
export function deadRows(container: HTMLElement): string[] {
	return [...container.querySelectorAll<HTMLElement>("[data-setting]")]
		.filter(
			(row) =>
				!row.querySelector(
					'button, select, input, textarea, a[href], [role="switch"], [data-setting-control]',
				),
		)
		.map((row) => row.dataset.setting ?? "");
}
