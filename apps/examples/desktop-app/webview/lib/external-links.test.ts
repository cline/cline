import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleExternalLinkClick } from "./external-links";

const { isTauriAvailableMock, openUrlMock } = vi.hoisted(() => ({
	isTauriAvailableMock: vi.fn(),
	openUrlMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	isTauriAvailable: isTauriAvailableMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: openUrlMock,
}));

function createClickEvent(url: string) {
	return {
		currentTarget: { href: url },
		preventDefault: vi.fn(),
	} as unknown as Parameters<typeof handleExternalLinkClick>[0];
}

describe("handleExternalLinkClick", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		openUrlMock.mockResolvedValue(undefined);
	});

	it("uses native anchor navigation outside Tauri", () => {
		isTauriAvailableMock.mockReturnValue(false);
		const event = createClickEvent("https://app.cline.bot/dashboard");

		handleExternalLinkClick(event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(openUrlMock).not.toHaveBeenCalled();
	});

	it("opens the URL with Tauri's opener inside the desktop shell", () => {
		isTauriAvailableMock.mockReturnValue(true);
		const event = createClickEvent("https://app.cline.bot/dashboard");

		handleExternalLinkClick(event);

		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(openUrlMock).toHaveBeenCalledWith("https://app.cline.bot/dashboard");
	});
});
