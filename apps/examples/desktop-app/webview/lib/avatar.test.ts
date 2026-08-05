import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
}));

import {
	getSelectedAvatar,
	listAvatars,
	performAvatarOverlayAction,
	selectAvatar,
	setAvatarEnabled,
} from "./avatar";

beforeEach(() => mocks.invoke.mockReset());

describe("avatar client", () => {
	it("uses the native avatar discovery commands", async () => {
		mocks.invoke.mockResolvedValueOnce([{ id: "mom", displayName: "Mom" }]);
		await listAvatars();
		expect(mocks.invoke).toHaveBeenCalledWith("list_avatars");

		mocks.invoke.mockResolvedValueOnce({ id: "mom", spriteUrl: "/mom.webp" });
		await getSelectedAvatar();
		expect(mocks.invoke).toHaveBeenCalledWith("get_selected_avatar");
	});

	it("persists selection and dispatches overlay actions", async () => {
		mocks.invoke.mockResolvedValue(undefined);
		await selectAvatar("other-avatar");
		await performAvatarOverlayAction("open-cline");

		expect(mocks.invoke).toHaveBeenCalledWith("set_selected_avatar", {
			id: "other-avatar",
		});
		expect(mocks.invoke).toHaveBeenCalledWith("handle_avatar_overlay_action", {
			action: "open-cline",
		});
	});

	it("updates avatar visibility independently from selection", async () => {
		mocks.invoke.mockResolvedValue(undefined);
		await setAvatarEnabled(false);
		expect(mocks.invoke).toHaveBeenCalledWith("set_avatar_enabled", {
			enabled: false,
		});
	});
});
