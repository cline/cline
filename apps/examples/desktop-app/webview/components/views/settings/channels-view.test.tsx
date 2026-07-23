// @vitest-environment jsdom

import { act, type HTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsContent } from "./channels-view";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

vi.mock("@/components/ui/scroll-area", () => ({
	ScrollArea: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
		<div {...props}>{children}</div>
	),
}));

const telegramChannel = {
	id: "telegram",
	name: "Telegram",
	type: "polling" as const,
	hint: "No public URL needed.",
	fields: [
		{
			flag: "-k",
			label: "Bot token",
			placeholder: "7123456789:AAH...",
			required: true,
			help: ["Copy the token from @BotFather."],
		},
	],
	security: {
		prompt: "Restrict access to your Telegram user ID?",
		fields: [
			{
				key: "userId",
				label: "Your Telegram user ID",
				placeholder: "123456789",
				requiredMessage: "User ID is required to restrict access",
			},
		],
	},
};

const slackChannel = {
	id: "slack",
	name: "Slack",
	type: "hybrid" as const,
	hint: "Public URL for webhook mode; leave blank for socket mode.",
	fields: [
		{
			flag: "--bot-token",
			label: "Bot token",
			required: true,
		},
		{
			flag: "--base-url",
			label: "Public base URL",
			placeholder: "leave blank for socket mode",
		},
		{
			flag: "--signing-secret",
			label: "Signing secret",
			required: true,
			includeWhen: { flag: "--base-url", notEquals: "" },
		},
		{
			flag: "--app-token",
			label: "App-level token",
			required: true,
			includeWhen: { flag: "--base-url", equals: "" },
		},
	],
};

const gchatChannel = {
	id: "gchat",
	name: "Google Chat",
	type: "webhook" as const,
	hint: "Requires Google Cloud credentials and a public URL.",
	fields: [
		{
			flag: "--credentials-json",
			label: "Service account credentials JSON",
			required: true,
		},
	],
};

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

beforeEach(() => {
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockReset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function renderChannels() {
	await act(async () => {
		root.render(<ChannelsContent />);
	});
	await vi.waitFor(() => {
		expect(invokeMock).toHaveBeenCalledWith("list_connector_channels");
	});
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

async function changeInput(
	input: HTMLInputElement,
	value: string,
): Promise<void> {
	const setValue = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setValue?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function changeTextarea(
	textarea: HTMLTextAreaElement,
	value: string,
): Promise<void> {
	const setValue = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setValue?.call(textarea, value);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function buttonWithText(text: string, rootElement: ParentNode = container) {
	const button = [
		...rootElement.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}

function channelListIds(): string[] {
	return [
		...container.querySelectorAll<HTMLButtonElement>(
			'button[id^="channel-"][id$="-trigger"]',
		),
	].map((button) =>
		button.id.replace(/^channel-/, "").replace(/-trigger$/, ""),
	);
}

describe("ChannelsContent", () => {
	it("renders the backend catalog and starts Telegram with canonical field and security keys", async () => {
		const initialResponse = {
			available: [telegramChannel, slackChannel],
			active: [],
		};
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_connector_channels") {
				return initialResponse;
			}
			if (command === "start_connector_channel") {
				return {
					...initialResponse,
					active: [
						{
							id: "telegram:test_bot",
							type: "telegram",
							pid: 42,
							hubUrl: "ws://127.0.0.1:4317",
							botUsername: "test_bot",
						},
					],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await renderChannels();
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Telegram");
			expect(container.textContent).toContain("Slack");
		});
		expect(channelListIds()).toEqual(["slack", "telegram"]);
		expect(container.textContent).not.toContain("Mattermost");
		expect(
			container
				.querySelector('button[aria-label="Connect Telegram"]')
				?.getAttribute("aria-checked"),
		).toBe("false");

		await click(buttonWithText("Telegram"));
		const tokenInput = container.querySelector<HTMLInputElement>(
			"#channel-telegram-credential--k",
		) as HTMLInputElement;
		await changeInput(tokenInput, "7123456789:test-token");
		await click(
			container.querySelector('button[aria-label="Show Bot token"]') as Element,
		);
		expect(tokenInput.type).toBe("text");
		await click(
			container.querySelector("#channel-telegram-security-toggle") as Element,
		);
		await changeInput(
			container.querySelector<HTMLInputElement>(
				"#channel-telegram-security-userId",
			) as HTMLInputElement,
			"123456789",
		);
		await click(buttonWithText("Save"));

		await vi.waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("start_connector_channel", {
				channel: "telegram",
				values: { "-k": "7123456789:test-token" },
				security: {
					enabled: true,
					values: { userId: "123456789" },
				},
			});
			expect(container.textContent).toContain("@test_bot");
			expect(
				container
					.querySelector('button[aria-label="Disconnect Telegram"]')
					?.getAttribute("aria-checked"),
			).toBe("true");
			expect(channelListIds()).toEqual(["telegram", "slack"]);
			expect(tokenInput.type).toBe("password");
			expect(tokenInput.value).toBe("7123456789:test-token");
		});
	});

	it("masks multiline credentials before and after connecting", async () => {
		const initialResponse = { available: [gchatChannel], active: [] };
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_connector_channels") {
				return initialResponse;
			}
			if (command === "start_connector_channel") {
				return {
					...initialResponse,
					active: [
						{
							id: "gchat:cline-bot",
							type: "gchat",
							pid: 43,
							hubUrl: "ws://127.0.0.1:4317",
							userName: "cline-bot",
						},
					],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await renderChannels();
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Google Chat");
		});
		await click(buttonWithText("Google Chat"));
		const textarea = container.querySelector<HTMLTextAreaElement>(
			"#channel-gchat-credential---credentials-json",
		) as HTMLTextAreaElement;
		expect(textarea.className).toContain("[-webkit-text-security:disc]");
		await changeTextarea(textarea, '{"private_key":"secret"}');
		await click(
			container.querySelector(
				'button[aria-label="Show Service account credentials JSON"]',
			) as Element,
		);
		expect(textarea.className).not.toContain("[-webkit-text-security:disc]");
		await click(buttonWithText("Save"));

		await vi.waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("start_connector_channel", {
				channel: "gchat",
				values: { "--credentials-json": '{"private_key":"secret"}' },
				security: { enabled: false, values: {} },
			});
			expect(textarea.className).toContain("[-webkit-text-security:disc]");
			expect(textarea.disabled).toBe(false);
		});
	});

	it("retains submitted credentials when connecting fails", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_connector_channels") {
				return { available: [telegramChannel], active: [] };
			}
			if (command === "start_connector_channel") {
				throw new Error("connector failed to start");
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await renderChannels();
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Telegram");
		});
		await click(buttonWithText("Telegram"));
		const tokenInput = container.querySelector<HTMLInputElement>(
			"#channel-telegram-credential--k",
		) as HTMLInputElement;
		await changeInput(tokenInput, "7123456789:retry-token");
		await click(buttonWithText("Save"));

		await vi.waitFor(() => {
			expect(container.textContent).toContain("connector failed to start");
			expect(tokenInput.value).toBe("7123456789:retry-token");
			expect(tokenInput.disabled).toBe(false);
			expect(
				container
					.querySelector("#channel-telegram-trigger")
					?.getAttribute("aria-expanded"),
			).toBe("true");
		});
	});

	it("saves edited configuration for an active channel", async () => {
		const activeConnector = {
			id: "telegram:first_bot",
			type: "telegram",
			pid: 41,
			hubUrl: "ws://127.0.0.1:4317",
			botUsername: "first_bot",
		};
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_connector_channels") {
				return { available: [telegramChannel], active: [activeConnector] };
			}
			if (command === "start_connector_channel") {
				return {
					available: [telegramChannel],
					active: [activeConnector],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await renderChannels();
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Telegram");
		});
		await click(buttonWithText("Telegram"));
		const tokenInput = container.querySelector<HTMLInputElement>(
			"#channel-telegram-credential--k",
		) as HTMLInputElement;
		expect(tokenInput.disabled).toBe(false);
		expect(
			(
				container.querySelector(
					"#channel-telegram-security-toggle",
				) as HTMLButtonElement
			).disabled,
		).toBe(false);
		expect(container.textContent).not.toContain("New Connection");
		await changeInput(tokenInput, "7123456789:updated-token");
		await click(buttonWithText("Save"));

		await vi.waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("start_connector_channel", {
				channel: "telegram",
				values: { "-k": "7123456789:updated-token" },
				security: { enabled: false, values: {} },
			});
			expect(container.textContent).toContain("@first_bot");
			expect(container.textContent).toContain("Active connection");
		});
	});

	it("switches Slack conditional fields and blocks a missing visible required field", async () => {
		invokeMock.mockResolvedValue({ available: [slackChannel], active: [] });

		await renderChannels();
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Slack");
		});
		const slackTrigger = container.querySelector(
			"#channel-slack-trigger",
		) as HTMLButtonElement;
		expect(slackTrigger.getAttribute("aria-expanded")).toBe("false");
		await click(
			container.querySelector('button[aria-label="Connect Slack"]') as Element,
		);

		expect(slackTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(container.textContent).toContain("Bot token is required");
		expect(container.textContent).toContain("App-level token");
		expect(container.textContent).not.toContain("Signing secret");
		await changeInput(
			container.querySelector<HTMLInputElement>(
				"#channel-slack-credential---base-url",
			) as HTMLInputElement,
			"https://example.com",
		);
		expect(container.textContent).toContain("Signing secret");
		expect(container.textContent).not.toContain("App-level token");

		await click(buttonWithText("Save"));
		expect(container.textContent).toContain("Bot token is required");
		expect(invokeMock).not.toHaveBeenCalledWith(
			"start_connector_channel",
			expect.anything(),
		);
	});

	it("resets the active connection from the expanded channel footer", async () => {
		const activeConnector = {
			id: "telegram:test_bot",
			type: "telegram",
			pid: 42,
			hubUrl: "ws://127.0.0.1:4317",
			botUsername: "test_bot",
		};
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_connector_channels") {
				return { available: [telegramChannel], active: [activeConnector] };
			}
			if (command === "stop_connector_channel") {
				return { available: [telegramChannel], active: [] };
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await renderChannels();
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Telegram");
		});
		await click(buttonWithText("Telegram"));
		expect(
			container.querySelector('button[aria-label^="Disconnect @"]'),
		).toBeNull();
		await click(buttonWithText("Reset"));

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("Reset Telegram?");
		});
		await click(
			buttonWithText(
				"Reset",
				document.querySelector('[role="alertdialog"]') as Element,
			),
		);

		await vi.waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("stop_connector_channel", {
				channel: "telegram",
			});
			expect(
				container
					.querySelector('button[aria-label="Connect Telegram"]')
					?.getAttribute("aria-checked"),
			).toBe("false");
		});
	});
});
