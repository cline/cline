import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../ui/__testing__/render";
import { ArchivedChatScreen } from "./ArchivedChatScreen";
import { CloudArchiveRoute } from "./CloudArchiveRoute";

const mocks = vi.hoisted(() => ({ readHistory: vi.fn(), options: vi.fn() }));
vi.mock("@/cloud", () => ({
	cloudAuthStore: { getValidAccessToken: async () => "token" },
	CloudSessionGateway: class {
		constructor(options: unknown) {
			mocks.options(options);
		}
		readHistory = mocks.readHistory;
	},
}));
const descriptor = {
	mode: "cloud" as const,
	url: "https://api.test/session/one",
	remoteSessionId: "one",
	organizationId: "org-1",
};
const actions = { onBack() {}, onNewChat() {}, onSignIn() {} };
beforeEach(() => vi.clearAllMocks());
describe("Cloud archive route", () => {
	it("reads the exact workspace/account and preserves empty versus missing history", async () => {
		mocks.readHistory
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(undefined);
		const { root } = render(
			<CloudArchiveRoute descriptor={descriptor} {...actions} />,
		);
		await act(async () => {});
		expect(mocks.readHistory).toHaveBeenCalledWith("one");
		expect(mocks.options).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
		);
		expect(
			root.find((node) => node.type === ArchivedChatScreen).props.history,
		).toEqual([]);
		await act(async () =>
			root.find((node) => node.type === ArchivedChatScreen).props.onRetry(),
		);
		expect(
			root.find((node) => node.type === ArchivedChatScreen).props.history,
		).toBeUndefined();
	});
	it("does not let a late archive overwrite another conversation", async () => {
		let finish!: (history: unknown[]) => void;
		mocks.readHistory
			.mockReturnValueOnce(
				new Promise((resolve) => {
					finish = resolve;
				}),
			)
			.mockResolvedValueOnce([]);
		const { root, renderer } = render(
			<CloudArchiveRoute descriptor={descriptor} {...actions} />,
		);
		await act(async () =>
			renderer.update(
				<CloudArchiveRoute
					descriptor={{ ...descriptor, remoteSessionId: "two" }}
					{...actions}
				/>,
			),
		);
		await act(async () => finish([{ id: "stale" }]));
		expect(
			root.find((node) => node.type === ArchivedChatScreen).props.history,
		).toEqual([]);
	});
});
