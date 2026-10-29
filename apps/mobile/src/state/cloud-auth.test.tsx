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
import { cloudStartStore } from "./cloud-starts";
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
afterEach(() => cloudStartStore.clear());

it.each([
	"same",
	"different",
	"signed-out",
	"unprovable",
])("keeps a failed Cloud prompt/photo only for the same stable identity (%s)", async (change) => {
	const credentials = {
		access: "old",
		refresh: "r",
		expires: Date.now() + 86400000,
		...(change === "unprovable" ? {} : { accountId: "person-a" }),
	};
	const store = new ClineAuthStore({
		storage: createInMemoryAuthStorage(credentials),
	});
	await store.getCredentials();
	render(
		<CloudAuthProvider store={store}>
			<></>
		</CloudAuthProvider>,
	);
	const descriptor = {
		mode: "cloud" as const,
		url: "https://fixture.invalid/ready",
		remoteSessionId: "ready",
	};
	const provision = vi
		.fn()
		.mockRejectedValueOnce(new Error("Not signed in (401)"))
		.mockResolvedValueOnce(descriptor);
	let id!: string;
	await act(async () => {
		id = cloudStartStore.start({
			target: {
				id: "target",
				mode: "cloud",
				repoUrl: "https://github.com/fixture/repo",
				label: "repo",
				modelId: "model",
			},
			message: "Only private caption",
			attachments: { userImages: ["data:image/png;base64,cGhvdG8="] },
			provision,
		});
	});
	const failed = cloudStartStore.getSnapshot()[0];
	expect(failed?.phase).toBe("error");
	await act(async () => {
		if (change === "signed-out") await store.signOut();
		else
			await store.setCredentials({
				...credentials,
				access: "fresh",
				accountId: change === "same" ? "person-a" : "person-b",
			});
	});
	if (change === "same") {
		expect(cloudStartStore.getSnapshot()[0]).toBe(failed);
		expect(provision).toHaveBeenCalledOnce();
		await act(async () => cloudStartStore.retry(id));
		expect(provision).toHaveBeenCalledTimes(2);
		expect(cloudStartStore.getSnapshot()[0]).toMatchObject({
			id,
			phase: "ready",
			message: "Only private caption",
			attachments: { userImages: ["data:image/png;base64,cGhvdG8="] },
		});
	} else {
		expect(cloudStartStore.getSnapshot()).toEqual([]);
		act(() => cloudStartStore.retry(id));
		expect(provision).toHaveBeenCalledOnce();
	}
});

it("retires private drafts and pending submissions when token resolution signs out automatically", async () => {
	const store = new ClineAuthStore({
		storage: createInMemoryAuthStorage({
			access: "expired",
			refresh: "expired-refresh",
			expires: 0,
		}),
		resolveCredentials: async () => null,
	});
	const endpoints = new SavedEndpointsStore();
	await endpoints.save({
		mode: "cloud",
		url: "https://fixture.invalid/workspace",
		pendingInitialMessage: "Old account pending input",
	});
	const mounted = render(
		<EndpointsProvider store={endpoints}>
			<CloudAuthProvider store={store}>
				<></>
			</CloudAuthProvider>
		</EndpointsProvider>,
	);
	await act(async () => {});
	writeSessionDraft("old-account-chat", "Old account private text");
	writeSessionDraftImages("old-account-chat", [
		"data:image/png;base64,cHJpdmF0ZQ==",
	]);
	const launchId = stagePendingHomeSubmission({
		text: "Old account initial prompt",
	});
	await act(async () => {
		expect(await store.getValidAccessToken()).toBeNull();
	});
	expect(readSessionDraft("old-account-chat")).toBeUndefined();
	expect(readSessionDraftImages("old-account-chat")).toBeUndefined();
	expect(readPendingHomeSubmission(launchId)).toBeUndefined();
	expect(endpoints.list()[0].pendingInitialMessage).toBeUndefined();
	mounted.unmount();
});

it.each([
	{ previousId: "person-a", nextId: "person-b", retire: true },
	{ previousId: undefined, nextId: "person-b", retire: true },
	{ previousId: "person-a", nextId: "person-a", retire: false },
	{ previousId: null, nextId: "person-b", retire: false },
])("protects private input on credential replacement ($previousId → $nextId, retire=$retire)", async ({
	previousId,
	nextId,
	retire,
}) => {
	const credentials = {
		access: "old",
		refresh: "old-refresh",
		expires: Date.now() + 60_000,
		...(previousId ? { accountId: previousId } : {}),
	};
	const store = new ClineAuthStore({
		storage: createInMemoryAuthStorage(
			previousId === null ? null : credentials,
		),
	});
	await store.getCredentials();
	const endpoints = new SavedEndpointsStore();
	await endpoints.save({
		mode: "cloud",
		url: "https://fixture.invalid/workspace",
		pendingInitialMessage: "Private input",
	});
	const mounted = render(
		<EndpointsProvider store={endpoints}>
			<CloudAuthProvider store={store}>
				<></>
			</CloudAuthProvider>
		</EndpointsProvider>,
	);
	await act(async () => {});
	writeSessionDraft("identity-test", "Private input");
	writeSessionDraftImages("identity-test", [
		"data:image/png;base64,cHJpdmF0ZQ==",
	]);
	const launchId = stagePendingHomeSubmission({ text: "Private input" });
	await act(async () => {
		await store.setCredentials({
			...credentials,
			access: "new",
			accountId: nextId,
		});
	});
	expect(readSessionDraft("identity-test")).toBe(
		retire ? undefined : "Private input",
	);
	expect(readSessionDraftImages("identity-test")).toEqual(
		retire ? undefined : ["data:image/png;base64,cHJpdmF0ZQ=="],
	);
	expect(readPendingHomeSubmission(launchId)?.text).toBe(
		retire ? undefined : "Private input",
	);
	expect(endpoints.list()[0].pendingInitialMessage).toBe(
		retire ? undefined : "Private input",
	);
	mounted.unmount();
});

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
		expect(endpoints.retirePendingInitialMessages).toHaveBeenCalledOnce();
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
	it("updates display metadata only through an accepted scope publication", () => {
		const screen = mountScope();
		act(() =>
			screen
				.current()
				.selectScope({ organizationId: "org-1", accountName: "Old name" }),
		);
		const refresh = screen.current().beginRefresh();
		act(() => refresh({ organizationId: "org-1", accountName: "New name" }));
		expect(screen.current().scope).toEqual({
			organizationId: "org-1",
			accountName: "New name",
		});
		expect(
			screen
				.current()
				.isScopeCurrent({ organizationId: "org-1", accountName: "Old name" }),
		).toBe(true);
		const stale = screen.current().beginRefresh();
		act(() =>
			screen
				.current()
				.selectScope({ organizationId: "org-2", accountName: "Selected team" }),
		);
		act(() => stale({ organizationId: "org-1", accountName: "Retired team" }));
		expect(screen.current().scope).toEqual({
			organizationId: "org-2",
			accountName: "Selected team",
		});
	});
	it("clears a failed-selection notice only after a fresh accepted account discovery", () => {
		const screen = mountScope();
		act(() => screen.current().selectScope({}));
		let failed!: ReturnType<
			ReturnType<typeof useCloudAccountScope>["beginSelection"]
		>;
		act(() => {
			failed = screen.current().beginSelection();
		});
		const stale = screen.current().beginRefresh();
		act(() => {
			failed.fail();
		});
		act(() => stale({ organizationId: "stale" }));
		expect(screen.current().selectionError).toBeDefined();
		const fresh = screen.current().beginRefresh();
		act(() => fresh({}));
		expect(screen.current().selectionError).toBeUndefined();
		expect(screen.current().scope).toEqual({});
	});
	it("keeps selection pending through stale discovery and rejects an old failure after a newer selection starts", () => {
		const screen = mountScope();
		act(() => screen.current().selectScope({}));
		expect(screen.current().isScopeCurrent(undefined)).toBe(false);
		expect(screen.current().isScopeCurrent({})).toBe(true);
		let first!: ReturnType<
			ReturnType<typeof useCloudAccountScope>["beginSelection"]
		>;
		let second!: typeof first;
		act(() => {
			first = screen.current().beginSelection();
		});
		const during = screen.current().beginRefresh();
		act(() => during({ organizationId: "stale" }));
		expect(screen.current().scope).toEqual({});
		expect(screen.current().selectionPending).toBe(true);
		act(() => {
			second = screen.current().beginSelection();
		});
		act(() => expect(first.fail()).toBe(false));
		expect(screen.current().selectionPending).toBe(true);
		act(() => expect(second.fail()).toBe(true));
		expect(screen.current().scope).toEqual({});
		expect(screen.current().selectionPending).toBe(false);
		expect(screen.current().selectionError).toContain(
			"previous account is still selected",
		);
		act(() => during({ organizationId: "late-after-failure" }));
		expect(screen.current().scope).toEqual({});
	});
	it("retires a canceled selection without an error and prevents its late response", () => {
		const screen = mountScope();
		act(() => screen.current().selectScope({}));
		let pending!: ReturnType<
			ReturnType<typeof useCloudAccountScope>["beginSelection"]
		>;
		act(() => {
			pending = screen.current().beginSelection();
		});
		act(() => expect(pending.cancel()).toBe(true));
		act(() => expect(pending({ organizationId: "retired" })).toBe(false));
		expect(screen.current().selectionPending).toBe(false);
		expect(screen.current().selectionError).toBeUndefined();
		expect(screen.current().scope).toEqual({});
	});
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
			expect(pending.fail()).toBe(false);
		});
		expect(screen.current().scope).toBeUndefined();
		expect(screen.current().selectionPending).toBe(false);
		expect(screen.current().selectionError).toBeUndefined();
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
