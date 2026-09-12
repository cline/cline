// @vitest-environment jsdom

import { Switch } from "@cline/ui";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

describe("shared switch integration", () => {
	it("supports the desktop tooltip trigger without changing input semantics", async () => {
		const ref = createRef<HTMLInputElement>();
		const onCheckedChange = vi.fn();
		await act(async () => {
			root.render(
				<Tooltip>
					<TooltipTrigger asChild>
						<Switch
							aria-label="Enable schedule"
							onCheckedChange={onCheckedChange}
							ref={ref}
						/>
					</TooltipTrigger>
					<TooltipContent>Enable this schedule</TooltipContent>
				</Tooltip>,
			);
		});

		const toggle = container.querySelector<HTMLInputElement>('[role="switch"]');
		expect(ref.current).toBe(toggle);
		expect(toggle?.type).toBe("checkbox");
		await act(async () => toggle?.focus());
		expect(document.activeElement).toBe(toggle);
		const tooltipId = toggle?.getAttribute("aria-describedby");
		expect(tooltipId).toBeTruthy();
		expect(document.getElementById(tooltipId ?? "")?.textContent).toBe(
			"Enable this schedule",
		);
		await act(async () => toggle?.click());
		expect(toggle?.checked).toBe(true);
		expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
	});
});
