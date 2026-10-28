import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClineAuthStore, createInMemoryAuthStorage } from "@/cloud";
import { SavedEndpointsStore } from "@/connection";
import { render } from "@/ui/__testing__/render";
import {
	CloudAuthProvider,
	type UseCloudAuth,
	useCloudAuth,
} from "./cloud-auth";
import { EndpointsProvider } from "./endpoints";
import {
	readPendingHomeSubmission,
	stagePendingHomeSubmission,
} from "./pending-home-message";
import {
	clearAllSessionDrafts,
	readSessionDraft,
	readSessionDraftImages,
	writeSessionDraft,
	writeSessionDraftImages,
} from "./session-drafts";

afterEach(clearAllSessionDrafts);

describe("explicit Cloud sign-out privacy", () => {
	it("invalidates credentials before waiting for slow saved-endpoint cleanup", async () => {
		const store = new ClineAuthStore({ storage: createInMemoryAuthStorage() });
		const signOut = vi.spyOn(store, "signOut");
		const endpoints = new SavedEndpointsStore();
		let release!: () => void;
		vi.spyOn(endpoints, "retirePendingInitialMessages").mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		let auth!: UseCloudAuth;
		function Observe() {
			auth = useCloudAuth();
			return null;
		}
		const mounted = render(
			<EndpointsProvider store={endpoints}>
				<CloudAuthProvider store={store}>
					<Observe />
				</CloudAuthProvider>
			</EndpointsProvider>,
		);
		await act(async () => {});
		let pending!: Promise<void>;
		act(() => {
			pending = auth.signOut();
		});
		expect(signOut).toHaveBeenCalledOnce();
		await act(async () => {
			release();
			await pending;
		});
		mounted.unmount();
	});

	for (const fails of [false, true]) {
		it(`clears text and image drafts when credential sign-out ${fails ? "fails" : "succeeds"}`, async () => {
			const store = new ClineAuthStore({
				storage: createInMemoryAuthStorage({
					access: "test-access",
					refresh: "test-refresh",
					expires: Date.now() + 60_000,
					accountId: "fixture-user",
					email: "fixture@example.invalid",
					metadata: { provider: "cline" },
				}),
			});
			const endpoints = new SavedEndpointsStore();
			await endpoints.save({
				mode: "cloud",
				url: "https://fixture.invalid/workspace",
				pendingInitialMessage: "Private recoverable ask",
				repoUrl: "https://github.com/fixture/repo",
			});
			const launchId = stagePendingHomeSubmission({
				text: "Private launch",
				attachments: { userImages: ["data:image/png;base64,cHJpdmF0ZQ=="] },
			});
			let auth!: UseCloudAuth;
			function Observe() {
				auth = useCloudAuth();
				return null;
			}
			const mounted = render(
				<EndpointsProvider store={endpoints}>
					<CloudAuthProvider store={store}>
						<Observe />
					</CloudAuthProvider>
				</EndpointsProvider>,
			);
			await act(async () => {});
			expect(auth.account.phase).toBe("signed-in");
			writeSessionDraft("first-route", "Private unsent first draft");
			writeSessionDraftImages("first-route", [
				"data:image/png;base64,cHJpdmF0ZQ==",
			]);
			writeSessionDraft("second-route", "Private unsent second draft");
			if (fails)
				vi.spyOn(store, "signOut").mockRejectedValueOnce(
					new Error("Credential storage unavailable"),
				);
			await act(async () => {
				await auth.signOut();
			});
			expect(auth.account.phase).toBe("signed-out");
			expect(readPendingHomeSubmission(launchId)).toBeUndefined();
			expect(endpoints.list()).toEqual([
				{
					mode: "cloud",
					url: "https://fixture.invalid/workspace",
					repoUrl: "https://github.com/fixture/repo",
				},
			]);
			expect(readSessionDraft("first-route")).toBeUndefined();
			expect(readSessionDraftImages("first-route")).toBeUndefined();
			expect(readSessionDraft("second-route")).toBeUndefined();
			mounted.unmount();
		});
	}
});
