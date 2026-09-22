// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentComposer,
	AgentComposerActions,
	AgentComposerAttachments,
	AgentComposerBody,
	AgentComposerField,
	AgentComposerSendButton,
	AgentComposerSettings,
	AgentComposerSettingsEnd,
	AgentComposerSettingsGroup,
	AgentComposerStopButton,
	AgentComposerTextarea,
} from "../components/index.js";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("AgentComposer", () => {
	it("keeps host refs, controlled input, focus, keyboard and button events on the original native elements", async () => {
		const textarea = createRef<HTMLTextAreaElement>();
		const onKeyDown = vi.fn();
		const onSend = vi.fn();
		const onStop = vi.fn();
		const render = (value: string, disabled: boolean) =>
			root.render(
				<AgentComposer>
					<div data-host-header />
					<AgentComposerBody>
						<div data-host-queue />
						<div className="relative">
							<div data-host-suggestions />
							<AgentComposerField onMouseDown={() => textarea.current?.focus()}>
								<AgentComposerTextarea
									ref={textarea}
									aria-label="Prompt"
									role="combobox"
									aria-controls="host-options"
									value={value}
									onChange={() => {}}
									onKeyDown={onKeyDown}
									rows={3}
									style={{ maxHeight: "20rem" }}
								/>
								<AgentComposerActions>
									<AgentComposerStopButton type="button" onClick={onStop}>
										Stop
									</AgentComposerStopButton>
									<AgentComposerSendButton
										type="button"
										disabled={disabled}
										onClick={onSend}
									>
										Send
									</AgentComposerSendButton>
								</AgentComposerActions>
							</AgentComposerField>
						</div>
						<output data-host-error />
						<AgentComposerAttachments>
							<button type="button">Remove attachment</button>
						</AgentComposerAttachments>
					</AgentComposerBody>
					<AgentComposerSettings>
						<AgentComposerSettingsGroup>Models</AgentComposerSettingsGroup>
						<AgentComposerSettingsEnd>Usage</AgentComposerSettingsEnd>
					</AgentComposerSettings>
				</AgentComposer>,
			);
		await act(async () => render("Draft", false));
		const input = textarea.current;
		if (!input) throw new Error("Missing textarea ref");
		expect(input).toBe(container.querySelector("textarea"));
		expect(input.value).toBe("Draft");
		expect(input.getAttribute("aria-controls")).toBe("host-options");
		expect(input.rows).toBe(3);
		expect(input.style.maxHeight).toBe("20rem");
		await act(async () => {
			input.parentElement?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					isComposing: true,
				}),
			);
			container.querySelectorAll<HTMLButtonElement>("button")[0].click();
			container.querySelectorAll<HTMLButtonElement>("button")[1].click();
		});
		expect(document.activeElement).toBe(input);
		expect(onKeyDown).toHaveBeenCalledOnce();
		expect(onKeyDown.mock.calls[0][0].nativeEvent.isComposing).toBe(true);
		expect(onSend).toHaveBeenCalledOnce();
		expect(onStop).toHaveBeenCalledOnce();
		await act(async () => render("Updated draft", true));
		expect(textarea.current).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(input.value).toBe("Updated draft");
		await act(async () =>
			container.querySelectorAll<HTMLButtonElement>("button")[1].click(),
		);
		expect(onSend).toHaveBeenCalledOnce();
		expect(container.firstElementChild?.children).toHaveLength(3);
		expect(
			container.querySelector("[data-host-error]")?.nextElementSibling
				?.firstElementChild?.textContent,
		).toBe("Remove attachment");
	});

	it.each([
		["welcome", false, "px-4 py-3 pb-2 pt-4"],
		["welcome", true, "px-4 py-3 pb-2 pt-4"],
		["conversation", false, "px-4 py-4"],
		["conversation", true, "px-4 py-3 pb-4 pt-0"],
	] as const)("preserves %s body spacing with queue=%s", async (variant, hasQueue, expected) => {
		await act(async () =>
			root.render(
				<AgentComposerBody variant={variant} hasQueue={hasQueue}>
					<div>Host queue and input</div>
				</AgentComposerBody>,
			),
		);
		expect(container.firstElementChild?.className).toBe(expected);
		expect(container.firstElementChild?.children).toHaveLength(1);
	});
});
