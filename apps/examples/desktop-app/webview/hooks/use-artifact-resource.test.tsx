// @vitest-environment jsdom

import type { ArtifactResolver, ArtifactResource } from "@cline/shared/browser";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useArtifactResource } from "./use-artifact-resource";

type AccountScope = {
	user: { id: string } | null;
	activeOrganization: { organizationId: string };
	accountReady: boolean;
};

const mocks = vi.hoisted(() => {
	const account: AccountScope = {
		user: { id: "account-one" },
		activeOrganization: { organizationId: "org-one" },
		accountReady: true,
	};
	return { invoke: vi.fn(), open: vi.fn(), account };
});
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	openExternalUrl: mocks.open,
}));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => mocks.account,
}));

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useArtifactResource>;
let renderedUrls: (string | undefined)[];

function Harness({
	sessionId = "ses-one",
	artifactId = "artifact-one",
	resolver,
	autoLoad = false,
}: {
	sessionId?: string;
	artifactId?: string;
	resolver?: ArtifactResolver;
	autoLoad?: boolean;
}) {
	const hook = useArtifactResource({
		sessionId,
		reference: { type: "artifact", artifactId },
		resolver,
	});
	current = hook;
	const url =
		hook.state.status === "ready" ? hook.state.resource.url : undefined;
	renderedUrls.push(url);
	useEffect(() => {
		if (autoLoad) void hook.load();
	}, [autoLoad, hook.load]);
	return <output>{url ?? hook.state.status}</output>;
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
	await act(async () => root.render(<Harness {...props} />));
}

function pendingResource() {
	let resolve: (resource: ArtifactResource) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<ArtifactResource>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.account = {
		user: { id: "account-one" },
		activeOrganization: { organizationId: "org-one" },
		accountReady: true,
	};
	mocks.invoke
		.mockReset()
		.mockResolvedValue({ url: "https://storage.example/first" });
	mocks.open.mockReset().mockResolvedValue(undefined);
	renderedUrls = [];
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

it("waits for account hydration, then supports a nonexpiring local resource while signed out", async () => {
	mocks.account.user = null;
	mocks.account.accountReady = false;
	const resolver = vi
		.fn<ArtifactResolver>()
		.mockResolvedValue({ url: "blob:local-file" });
	await render({ resolver, autoLoad: true });
	expect(resolver).not.toHaveBeenCalled();
	mocks.account.accountReady = true;
	await render({ resolver, autoLoad: true });
	expect(container.textContent).toBe("blob:local-file");
	await act(async () => current.open());
	await act(async () => current.open());
	expect(resolver).toHaveBeenCalledExactlyOnceWith({
		type: "artifact",
		artifactId: "artifact-one",
	});
	expect(mocks.open).toHaveBeenNthCalledWith(2, "blob:local-file");
	expect(mocks.invoke).not.toHaveBeenCalled();
});

it("reuses a fresh resource but refreshes within the expiry margin on the next use", async () => {
	const now = vi
		.spyOn(Date, "now")
		.mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
	mocks.invoke
		.mockResolvedValueOnce({
			url: "https://storage.example/first",
			expiresAt: "2030-01-01T00:01:00Z",
		})
		.mockResolvedValue({ url: "https://storage.example/refreshed" });
	await render({ autoLoad: true });
	await act(async () => current.open());
	expect(mocks.invoke).toHaveBeenCalledTimes(1);
	now.mockReturnValue(Date.parse("2030-01-01T00:00:31Z"));
	await act(async () => current.open());
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	expect(mocks.open).toHaveBeenLastCalledWith(
		"https://storage.example/refreshed",
	);
});

it("does not invalidate a resource when an account object refresh preserves identity", async () => {
	await render({ autoLoad: true });
	mocks.account.user = { id: "account-one" };
	mocks.account.activeOrganization = { organizationId: "org-one" };
	await render({ autoLoad: true });
	await act(async () => current.open());
	expect(mocks.invoke).toHaveBeenCalledOnce();
	expect(mocks.open).toHaveBeenCalledWith("https://storage.example/first");
});

it.each([
	"account",
	"organization",
	"session",
	"artifact",
])("hides the cached resource on the first render after a %s switch", async (change) => {
	await render({ autoLoad: true });
	const previousOpen = current.open;
	if (change === "account") mocks.account.user = null;
	if (change === "organization")
		mocks.account.activeOrganization = { organizationId: "org-two" };
	const props = {
		sessionId: change === "session" ? "ses-two" : "ses-one",
		artifactId: change === "artifact" ? "artifact-two" : "artifact-one",
	};
	const frameCount = renderedUrls.length;
	await render(props);
	expect(renderedUrls.slice(frameCount)).not.toContain(
		"https://storage.example/first",
	);
	expect(container.textContent).toBe("idle");
	await act(async () => previousOpen());
	expect(mocks.open).not.toHaveBeenCalled();
	await act(async () => current.open());
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	expect(mocks.invoke).toHaveBeenLastCalledWith("resolve_artifact", {
		sessionId: props.sessionId,
		artifactId: props.artifactId,
	});
});

it("discards a pending open when the organization changes away and back", async () => {
	const pending = pendingResource();
	mocks.invoke.mockReturnValueOnce(pending.promise);
	await render();
	await act(async () => {
		void current.open();
	});
	mocks.account.activeOrganization = { organizationId: "org-two" };
	await render();
	mocks.account.activeOrganization = { organizationId: "org-one" };
	await render();
	await act(async () =>
		pending.resolve({ url: "https://storage.example/old-scope" }),
	);
	expect(mocks.open).not.toHaveBeenCalled();
	expect(container.textContent).toBe("idle");
});

it("forces manual retries and ignores an older failure for the same artifact", async () => {
	await render({ autoLoad: true });
	const older = pendingResource();
	mocks.invoke.mockReturnValueOnce(older.promise);
	await act(async () => {
		void current.retry();
	});
	mocks.invoke.mockResolvedValueOnce({ url: "https://storage.example/newest" });
	await act(async () => current.retry());
	await act(async () => older.reject(new Error("Stale failure")));
	expect(container.textContent).toBe("https://storage.example/newest");
	expect(mocks.invoke).toHaveBeenCalledTimes(3);
});

it("does not open an in-flight resource after unmount and resolves anew after remount", async () => {
	const pending = pendingResource();
	mocks.invoke.mockReturnValueOnce(pending.promise);
	await render();
	await act(async () => {
		void current.open();
	});
	await act(async () => root.render(null));
	await act(async () =>
		pending.resolve({ url: "https://storage.example/unmounted" }),
	);
	expect(mocks.open).not.toHaveBeenCalled();
	await render({ autoLoad: true });
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	expect(container.textContent).toBe("https://storage.example/first");
});

it("keeps an external-open failure retryable and obtains a fresh resource", async () => {
	mocks.open.mockRejectedValueOnce(new Error("Cannot open browser"));
	await render();
	await act(async () => current.open());
	expect(container.textContent).toBe("error");
	await act(async () => current.open());
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	expect(mocks.open).toHaveBeenCalledTimes(2);
	expect(container.textContent).toBe("https://storage.example/first");
});
