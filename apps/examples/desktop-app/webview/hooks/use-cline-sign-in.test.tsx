// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClineSignIn } from "./use-cline-sign-in";

const { invoke, refreshAccount, invalidateProviderCatalogCache } = vi.hoisted(
	() => ({
		invoke: vi.fn(),
		refreshAccount: vi.fn(async () => undefined),
		invalidateProviderCatalogCache: vi.fn(),
	}),
);
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({ refreshAccount }),
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	invalidateProviderCatalogCache,
}));

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

let login: ReturnType<typeof useClineSignIn>;
let root: Root;
let container: HTMLDivElement;
function Harness() {
	login = useClineSignIn();
	return null;
}

beforeEach(async () => {
	vi.clearAllMocks();
	invoke.mockReset();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	root = createRoot(container);
	await act(async () => root.render(<Harness />));
});
afterEach(async () => {
	await act(async () => root.unmount());
});

describe("Cline sign-in", () => {
	it("waits for cancel acknowledgement and ignores the old result after retry", async () => {
		const first = deferred();
		const cancel = deferred();
		const second = deferred();
		invoke
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(cancel.promise)
			.mockReturnValueOnce(second.promise);
		await act(async () => {
			void login.signIn();
		});
		await act(async () => {
			void login.cancelSignIn();
		});
		expect(login.cancelling).toBe(true);
		await act(async () => {
			expect(await login.signIn()).toBe(false);
		});
		expect(invoke).toHaveBeenCalledTimes(2);
		await act(async () => cancel.resolve());
		expect(login.signingIn).toBe(false);
		await act(async () => {
			void login.signIn();
		});
		await act(async () => first.reject(new Error("Sign-in was cancelled")));
		expect(login.signingIn).toBe(true);
		expect(login.error).toBeNull();
		await act(async () => second.resolve());
		expect(login.signingIn).toBe(false);
		expect(refreshAccount).toHaveBeenCalledTimes(2);
	});

	it("keeps retry disabled if login rejects before cancel is acknowledged", async () => {
		const pending = deferred();
		const cancel = deferred();
		invoke
			.mockReturnValueOnce(pending.promise)
			.mockReturnValueOnce(cancel.promise);
		await act(async () => {
			void login.signIn();
			void login.cancelSignIn();
		});
		await act(async () => pending.reject(new Error("cancelled")));
		expect(login.cancelling).toBe(true);
		expect(login.signingIn).toBe(true);
		await act(async () => cancel.resolve());
		expect(login.signingIn).toBe(false);
		expect(login.error).toBeNull();
	});

	it("shows cancellation failure and allows another cancel without starting another login", async () => {
		const pending = deferred();
		invoke
			.mockReturnValueOnce(pending.promise)
			.mockRejectedValueOnce(new Error("Connection unavailable"))
			.mockResolvedValueOnce({ cancelled: true });
		await act(async () => {
			void login.signIn();
		});
		await act(async () => {
			await login.cancelSignIn();
		});
		expect(login.error).toContain("Could not cancel sign-in");
		expect(login.signingIn).toBe(true);
		expect(login.cancelling).toBe(false);
		await act(async () => {
			expect(await login.signIn()).toBe(false);
			await login.cancelSignIn();
		});
		expect(invoke).toHaveBeenCalledTimes(3);
		expect(login.signingIn).toBe(false);
		expect(login.error).toBeNull();
		await act(async () => pending.reject(new Error("cancelled")));
	});

	it("refreshes saved credentials without advancing setup when success races cancellation", async () => {
		const pending = deferred();
		const cancel = deferred();
		invoke
			.mockReturnValueOnce(pending.promise)
			.mockReturnValueOnce(cancel.promise);
		let result!: Promise<boolean>;
		await act(async () => {
			result = login.signIn();
			void login.cancelSignIn();
		});
		await act(async () => {
			cancel.resolve();
		});
		await act(async () => {
			pending.resolve();
			expect(await result).toBe(false);
		});
		expect(invalidateProviderCatalogCache).toHaveBeenCalledOnce();
		expect(refreshAccount).toHaveBeenCalledOnce();
		expect(login.signingIn).toBe(false);
	});

	it("reports a login failure and permits retry while account refresh is pending", async () => {
		const refresh = deferred();
		refreshAccount.mockReturnValueOnce(refresh.promise);
		invoke
			.mockRejectedValueOnce(new Error("Login failed"))
			.mockResolvedValueOnce({});
		await act(async () => {
			void login.signIn();
		});
		expect(login.error).toBe("Login failed");
		expect(login.signingIn).toBe(false);
		expect(invalidateProviderCatalogCache).toHaveBeenCalledOnce();
		expect(refreshAccount).toHaveBeenCalledOnce();
		await act(async () => {
			expect(await login.signIn()).toBe(true);
		});
		expect(login.error).toBeNull();
		expect(refreshAccount).toHaveBeenCalledTimes(2);
		await act(async () => refresh.resolve());
		expect(login.signingIn).toBe(false);
		expect(login.error).toBeNull();
	});
});
