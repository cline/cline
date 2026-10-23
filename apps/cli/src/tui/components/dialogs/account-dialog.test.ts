import { describe, expect, it, vi } from "vitest";
import type { ClineAccountSnapshot } from "../../cline-account";
import { accountActions } from "./account-dialog";

vi.mock("@opentui-ui/dialog/react", () => ({
	useDialogKeyboard: () => undefined,
}));

function snapshot(
	overrides: Partial<ClineAccountSnapshot> = {},
): ClineAccountSnapshot {
	return {
		user: {
			id: "user-1",
			email: "harrison@cline.bot",
			displayName: "Harrison",
			photoUrl: "",
			createdAt: "",
			updatedAt: "",
			organizations: [],
		},
		balance: { balance: 10, userId: "user-1" },
		organizationBalance: null,
		organizations: [],
		activeOrganization: null,
		displayedBalance: 10,
		...overrides,
	};
}

describe("accountActions", () => {
	it("offers privacy settings when the account has a privacy settings link", () => {
		const actions = accountActions(
			snapshot({
				privacySettingsUrl:
					"https://app.cline.bot/dashboard/account?tab=privacy&client=cline-cli",
			}),
		);

		expect(actions.map((action) => action.id)).toContain("privacy-settings");
	});

	it("leaves privacy settings out without a link", () => {
		const actions = accountActions(snapshot());

		expect(actions.map((action) => action.id)).not.toContain(
			"privacy-settings",
		);
	});
});
