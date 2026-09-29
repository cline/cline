import { beforeEach, describe, expect, it, vi } from "vitest";

type TestKey = { name: string; ctrl: boolean; preventDefault?: () => void };

const hooks = vi.hoisted(() => ({
	keyboard: undefined as ((key: TestKey) => void) | undefined,
}));
vi.mock("@opentui/react", () => ({
	useKeyboard: (handler: (key: TestKey) => void) => {
		hooks.keyboard = handler;
	},
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (current: unknown) => ({ current }),
}));
vi.mock("../contexts/session-context", () => ({
	useSession: () => ({ isExitRequested: false }),
}));

import { useRootKeyboard } from "./use-root-keyboard";

describe("root keyboard cloud isolation", () => {
	beforeEach(() => {
		hooks.keyboard = undefined;
	});
	it("never invokes local keyboard paths while the cloud view owns input", () => {
		const touched = vi.fn();
		const input = new Proxy(
			{ appView: "cloud" },
			{
				get(target, key) {
					if (key === "appView") return target.appView;
					touched(key);
					throw new Error(`Unexpected local keyboard access: ${String(key)}`);
				},
			},
		);
		useRootKeyboard(input as Parameters<typeof useRootKeyboard>[0]);
		for (const name of [
			"c",
			"s",
			"l",
			"p",
			"tab",
			"escape",
			"return",
			"up",
			"down",
		])
			hooks.keyboard?.({ name, ctrl: true });
		expect(touched).not.toHaveBeenCalled();
	});
});
