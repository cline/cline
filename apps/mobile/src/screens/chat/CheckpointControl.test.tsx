import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { fakeConnection, allText } from "../__testing__/harness";
import { CheckpointControl } from "./CheckpointControl";

describe("conversation checkpoint fork", () => {
	it("does not duplicate a fork when saving its destination fails", async () => {
		const fork = vi.fn(async () => "new-session");
		const navigate = vi
			.fn()
			.mockRejectedValueOnce(new Error("Storage unavailable"))
			.mockResolvedValue(undefined);
		const connection = fakeConnection({
			listCheckpoints: async () => [
				{ runCount: 2, createdAt: 100, ref: "synthetic-ref" },
			],
			forkAtCheckpoint: fork,
		});
		const { root } = render(
			<CheckpointControl
				connection={connection}
				disabled={false}
				onFork={navigate}
			/>,
		);
		const press = (label: string) =>
			root
				.findAll(
					(node) =>
						node.type === "Pressable" &&
						node.props.accessibilityLabel === label,
				)[0]
				?.props.onPress();
		await act(async () => {
			press("Fork from checkpoint");
		});
		expect(allText(root)).toContain("does not roll files back");
		await act(async () => {
			press("Fork before turn 2");
		});
		expect(fork).toHaveBeenCalledWith(2);
		await act(async () => {
			press("Open created fork");
		});
		expect(fork).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledTimes(2);
		expect(navigate).toHaveBeenLastCalledWith("new-session");
	});
});
