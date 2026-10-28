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
			const storage = createInMemoryAuthStorage({
				access: "test-access",
				refresh: "test-refresh",
				expires: Date.now() + 60_000,
				accountId: "fixture-user",
				email: "fixture@example.invalid",
				metadata: { provider: "cline" },
			});
			const store = new ClineAuthStore({ storage });
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
				vi.spyOn(storage, "clear").mockRejectedValueOnce(
					new Error("Credential storage unavailable"),
				);
			await act(async () => {
				await auth.signOut();
			});
			expect(auth.account.phase).toBe("signed-out");
			expect(await store.getCredentials()).toBeNull();
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

describe("identity observers and delayed sign-out ownership", () => {
	it("retires every mounted identity view immediately and does not overwrite a newer sign-in after cleanup", async () => {
		const credentials = {
			access: "old",
			refresh: "r",
			expires: Date.now() + 600000,
			email: "old@example.invalid",
		};
		const storage = createInMemoryAuthStorage(credentials);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.spyOn(storage, "clear").mockImplementation(async () => {
			await blocked;
		});
		const store = new ClineAuthStore({ storage });
		let first!: UseCloudAuth;
		let second!: UseCloudAuth;
		function First() {
			first = useCloudAuth();
			return null;
		}
		function Second() {
			second = useCloudAuth();
			return null;
		}
		render(
			<CloudAuthProvider store={store}>
				<First />
				<Second />
			</CloudAuthProvider>,
		);
		await act(async () => {});
		expect(second.account.phase).toBe("signed-in");
		let logout!: Promise<void>;
		act(() => {
			logout = first.signOut();
		});
		expect(first.account.phase).toBe("signed-out");
		expect(second.account.phase).toBe("signed-out");
		let login!: Promise<void>;
		act(() => {
			login = store.setCredentials({
				...credentials,
				access: "new",
				email: "new@example.invalid",
			});
		});
		await act(async () => {
			release();
			await Promise.all([logout, login]);
		});
		expect(first.account).toMatchObject({
			phase: "signed-in",
			email: "new@example.invalid",
		});
		expect(second.account).toMatchObject({
			phase: "signed-in",
			email: "new@example.invalid",
		});
	});

	it("keeps the new identity when an old initial storage read settles later", async () => {
		let finish!: (value: {
			access: string;
			refresh: string;
			expires: number;
			email: string;
		}) => void;
		const storage = createInMemoryAuthStorage();
		vi.spyOn(storage, "load").mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const store = new ClineAuthStore({ storage });
		let auth!: UseCloudAuth;
		function Observe() {
			auth = useCloudAuth();
			return null;
		}
		render(
			<CloudAuthProvider store={store}>
				<Observe />
			</CloudAuthProvider>,
		);
		const credentials = {
			access: "new",
			refresh: "r",
			expires: Date.now() + 600000,
			email: "new@example.invalid",
		};
		await act(async () => {
			await store.setCredentials(credentials);
		});
		await act(async () => {
			finish({ ...credentials, access: "old", email: "old@example.invalid" });
		});
		expect(auth.account).toMatchObject({
			phase: "signed-in",
			email: "new@example.invalid",
		});
	});
});
