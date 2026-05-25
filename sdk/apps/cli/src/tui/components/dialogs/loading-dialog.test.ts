import { describe, expect, it } from "vitest";
import type { DialogActions, DialogId } from "@opentui-ui/dialog/react";
import { withShownDialog } from "./loading-dialog-lifecycle";

type LoadingDialogCall =
	| {
			name: "show";
	  }
	| {
			name: "close";
			id: DialogId | undefined;
	  };

function createDialog(calls: LoadingDialogCall[]) {
	return {
		close: (id?: DialogId): DialogId | undefined => {
			calls.push({ name: "close", id });
			return id;
		},
	} satisfies Pick<DialogActions, "close">;
}

function showLoading(calls: LoadingDialogCall[]): DialogId {
	calls.push({ name: "show" });
	return "loading-dialog";
}

describe("withShownDialog", () => {
	it("shows a loading dialog while work runs", async () => {
		const calls: LoadingDialogCall[] = [];
		const events: string[] = [];
		const dialog = createDialog(calls);

		const result = await withShownDialog(
			dialog,
			() => showLoading(calls),
			async () => {
				events.push("run");
				return 42;
			},
		);

		expect(result).toBe(42);
		expect(events).toEqual(["run"]);
		expect(calls.map((call) => call.name)).toEqual(["show", "close"]);
		expect(calls[1]).toEqual({ name: "close", id: "loading-dialog" });
	});

	it("closes the loading dialog when work fails", async () => {
		const calls: LoadingDialogCall[] = [];
		const dialog = createDialog(calls);

		await expect(
			withShownDialog(
				dialog,
				() => showLoading(calls),
				async () => {
					throw new Error("failed");
				},
			),
		).rejects.toThrow("failed");

		expect(calls.map((call) => call.name)).toEqual(["show", "close"]);
		expect(calls[1]).toEqual({ name: "close", id: "loading-dialog" });
	});
});
