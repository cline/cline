// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleWorkspaceField } from "./schedule-workspace-field";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

const onChange = vi.fn();
let container: HTMLDivElement;
let root: Root;

function Harness({
	disabled = false,
	initialValue = "/workspace/project",
}: {
	disabled?: boolean;
	initialValue?: string;
}) {
	const [value, setValue] = useState(initialValue);
	return (
		<ScheduleWorkspaceField
			disabled={disabled}
			onChange={(next) => {
				onChange(next);
				setValue(next);
			}}
			value={value}
		/>
	);
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset();
	onChange.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function renderField(props: Parameters<typeof Harness>[0] = {}) {
	await act(async () => root.render(<Harness {...props} />));
}

function input() {
	const field = container.querySelector<HTMLTextAreaElement>(
		"#schedule-workspace",
	);
	if (!field) throw new Error("Project folder input is missing");
	return field;
}

function browseButton() {
	const button = Array.from(
		container.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent === "Browse…");
	if (!button) throw new Error("Browse button is missing");
	return button;
}

async function enterPath(value: string) {
	await act(async () => {
		const field = input();
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

describe("ScheduleWorkspaceField", () => {
	it("labels the required folder, explains its purpose, and supports manual editing", async () => {
		await renderField();
		expect(input().value).toBe("/workspace/project");
		expect(input().required).toBe(true);
		expect(input().labels?.[0]?.textContent).toBe("Project folder");
		expect(container.textContent).toContain(
			"Runs in this folder and uses its project settings.",
		);
		await enterPath("/another/project");
		expect(onChange).toHaveBeenCalledExactlyOnceWith("/another/project");
		expect(input().value).toBe("/another/project");
		expect(invoke).not.toHaveBeenCalled();
	});

	it("names the Browse button with its visible label first", async () => {
		await renderField();
		expect(browseButton().getAttribute("aria-label")).toBe(
			"Browse for project folder…",
		);
	});

	it("behaves as a single-line field: Enter submits and line breaks are dropped", async () => {
		const onSubmit = vi.fn((event: Event) => event.preventDefault());
		await act(async () =>
			root.render(
				<form onSubmit={(event) => onSubmit(event.nativeEvent)}>
					<Harness />
				</form>,
			),
		);
		const enter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			input().dispatchEvent(enter);
		});
		expect(enter.defaultPrevented).toBe(true);
		expect(onSubmit).toHaveBeenCalledOnce();
		await enterPath("/pasted/pro\nject\r\n");
		expect(onChange).toHaveBeenLastCalledWith("/pasted/project");
		expect(input().value).toBe("/pasted/project");
	});

	it("starts one picker from the current path and applies a trimmed selection", async () => {
		const selection = Promise.withResolvers<string | null>();
		invoke.mockReturnValueOnce(selection.promise);
		await renderField({ initialValue: " /workspace/project " });
		await act(async () => {
			browseButton().click();
			browseButton().click();
		});
		expect(invoke).toHaveBeenCalledExactlyOnceWith("pick_workspace_directory", {
			initialPath: "/workspace/project",
		});
		expect(input().disabled).toBe(true);
		expect(browseButton().disabled).toBe(true);
		await act(async () => selection.resolve(" /picked/project "));
		expect(onChange).toHaveBeenCalledExactlyOnceWith("/picked/project");
		expect(input().value).toBe("/picked/project");
		expect(input().disabled).toBe(false);
		expect(browseButton().disabled).toBe(false);
	});

	it("retains the current value when the picker is cancelled", async () => {
		invoke.mockResolvedValueOnce(null);
		await renderField({ initialValue: " " });
		await act(async () => browseButton().click());
		expect(invoke).toHaveBeenCalledExactlyOnceWith("pick_workspace_directory", {
			initialPath: undefined,
		});
		expect(input().value).toBe(" ");
		expect(onChange).not.toHaveBeenCalled();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(input().disabled).toBe(false);
	});

	it("explains picker failures and keeps manual entry available", async () => {
		invoke.mockRejectedValueOnce(new Error("Native picker unavailable"));
		await renderField();
		await act(async () => browseButton().click());
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not open the folder picker. Enter a folder path instead.",
		);
		expect(input().disabled).toBe(false);
		expect(browseButton().disabled).toBe(false);
		await enterPath("/manual/project");
		expect(onChange).toHaveBeenCalledExactlyOnceWith("/manual/project");
		expect(input().value).toBe("/manual/project");
	});

	it("blocks picking when disabled and ignores a pending selection after becoming disabled", async () => {
		await renderField({ disabled: true });
		expect(input().disabled).toBe(true);
		await act(async () => browseButton().click());
		expect(invoke).not.toHaveBeenCalled();
		await renderField({ disabled: false });
		const selection = Promise.withResolvers<string | null>();
		invoke.mockReturnValueOnce(selection.promise);
		await act(async () => browseButton().click());
		await renderField({ disabled: true });
		await act(async () => selection.resolve("/late/project"));
		expect(onChange).not.toHaveBeenCalled();
		expect(input().value).toBe("/workspace/project");
		expect(input().disabled).toBe(true);
	});

	it("ignores a pending selection after the field unmounts", async () => {
		const selection = Promise.withResolvers<string | null>();
		invoke.mockReturnValueOnce(selection.promise);
		await renderField();
		await act(async () => browseButton().click());
		await act(async () => root.render(null));
		await act(async () => selection.resolve("/late/project"));
		expect(onChange).not.toHaveBeenCalled();
	});
});
