import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClineAuthStore, createInMemoryAuthStorage } from "@/cloud";
import { SavedEndpointsStore } from "@/connection";
import { render } from "@/ui/__testing__/render";
import {
	CloudAuthProvider,
	type UseCloudAuth,
	useCloudAccountScope,
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

describe("account selection revision ownership", () => {
	function mountScope() {
		let current!: ReturnType<typeof useCloudAccountScope>;
		function Observe() {
			current = useCloudAccountScope();
			return null;
		}
		const screen = render(
			<CloudAuthProvider>
				<Observe />
			</CloudAuthProvider>,
		);
		return { ...screen, current: () => current };
	}
	it("retires older selections when a newer intent begins, and selection publications are one-shot", () => {
		const screen = mountScope();
		const old = screen.current().beginSelection();
		const latest = screen.current().beginSelection();
		act(() => expect(old({ organizationId: "old" })).toBe(false));
		act(() => expect(latest({ organizationId: "latest" })).toBe(true));
		act(() => expect(latest({ organizationId: "duplicate" })).toBe(false));
		expect(screen.current().scope).toEqual({ organizationId: "latest" });
		screen.unmount();
	});
	it("rejects selection after signout even before React commits the cleared scope", () => {
		const screen = mountScope();
		const pending = screen.current().beginSelection();
		act(() => {
			screen.current().selectScope(undefined);
			expect(pending({ organizationId: "retired" })).toBe(false);
		});
		expect(screen.current().scope).toBeUndefined();
		screen.unmount();
	});
	it("successful selection retires discovery started before and during its RPC", () => {
		const screen = mountScope();
		const before = screen.current().beginRefresh();
		const selected = screen.current().beginSelection();
		const during = screen.current().beginRefresh();
		act(() => expect(selected({ organizationId: "selected" })).toBe(true));
		act(() => {
			before({ organizationId: "old-before" });
			during({ organizationId: "old-during" });
		});
		expect(screen.current().scope).toEqual({ organizationId: "selected" });
		screen.unmount();
	});
});
