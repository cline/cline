// @vitest-environment jsdom

import type { CloudArtifactDownload } from "@cline/core/cloud";
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
	return { invoke: vi.fn(), open: vi.fn(), account, native: true };
});
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	openExternalUrl: mocks.open,
	isTauriAvailable: () => mocks.native,
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
	autoLoad = false,
}: {
	sessionId?: string;
	artifactId?: string;
	autoLoad?: boolean;
}) {
	const hook = useArtifactResource({
		sessionId,
		reference: { type: "artifact", artifactId },
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
	let resolve: (resource: CloudArtifactDownload) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<CloudArtifactDownload>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.native = true;
	mocks.account = {
		user: { id: "account-one" },
		activeOrganization: { organizationId: "org-one" },
		accountReady: true,
	};
	mocks.invoke.mockReset().mockResolvedValue({
		url: "https://storage.example/first",
		expiresAt: "2030-01-01T00:01:00Z",
	});
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
	vi.unstubAllGlobals();
});

it("waits for account hydration before resolving a cloud resource", async () => {
	mocks.account.accountReady = false;
	await render({ autoLoad: true });
	expect(mocks.invoke).not.toHaveBeenCalled();
	mocks.account.accountReady = true;
	await render({ autoLoad: true });
	expect(container.textContent).toBe("https://storage.example/first");
	expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: "artifact-one",
	});
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
		.mockResolvedValue({
			url: "https://storage.example/refreshed",
			expiresAt: "2030-01-01T00:01:00Z",
		});
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
		pending.resolve({
			url: "https://storage.example/old-scope",
			expiresAt: "2030-01-01T00:01:00Z",
		}),
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
	mocks.invoke.mockResolvedValueOnce({
		url: "https://storage.example/newest",
		expiresAt: "2030-01-01T00:01:00Z",
	});
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
		pending.resolve({
			url: "https://storage.example/unmounted",
			expiresAt: "2030-01-01T00:01:00Z",
		}),
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

function browserWindow() {
	mocks.native = false;
	const popup = {
		opener: window,
		document: document.implementation.createHTMLDocument(),
		link: document.createElement("a"),
		closed: false,
		close: vi.fn(),
	};
	popup.link.click = vi.fn();
	vi.spyOn(popup.document, "createElement").mockReturnValue(popup.link);
	const open = vi.fn(() => popup);
	vi.stubGlobal("open", open);
	return { popup, open };
}

it("reserves a browser tab before URL resolution and navigates it afterward", async () => {
	const { popup, open } = browserWindow();
	const pending = pendingResource();
	mocks.invoke.mockReturnValueOnce(pending.promise);
	await render();
	await act(async () => {
		void current.open();
	});
	expect(open).toHaveBeenCalledWith("about:blank", "_blank");
	expect(open.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.invoke.mock.invocationCallOrder[0],
	);
	expect(popup.opener).toBeNull();

	expect(popup.link.click).not.toHaveBeenCalled();
	await act(async () =>
		pending.resolve({
			url: "https://storage.example/ready",
			expiresAt: "2030-01-01T00:01:00Z",
		}),
	);
	expect(popup.link.click).toHaveBeenCalledOnce();
	expect(popup.link.href).toBe("https://storage.example/ready");
	expect(popup.link.referrerPolicy).toBe("no-referrer");
	expect(mocks.open).not.toHaveBeenCalled();
	await act(async () => root.render(null));
	expect(popup.close).not.toHaveBeenCalled();
});

it("reports a blocked browser tab without requesting a URL", async () => {
	mocks.native = false;
	vi.stubGlobal(
		"open",
		vi.fn(() => null),
	);
	await render();
	await act(async () => current.open());
	expect(container.textContent).toBe("error");
	expect(mocks.invoke).not.toHaveBeenCalled();
});

it.each([
	"request failure",
	"account change",
	"unmount",
])("closes a pending browser tab on %s", async (reason) => {
	const { popup } = browserWindow();
	const pending = pendingResource();
	mocks.invoke.mockReturnValueOnce(pending.promise);
	await render();
	await act(async () => {
		void current.open();
	});
	if (reason === "request failure")
		await act(async () => pending.reject(new Error("Unavailable")));
	else if (reason === "account change") {
		mocks.account.user = { id: "account-two" };
		await render();
	} else await act(async () => root.render(null));
	expect(popup.close).toHaveBeenCalled();
	await act(async () =>
		pending.resolve({
			url: "https://storage.example/old",
			expiresAt: "2030-01-01T00:01:00Z",
		}),
	);
	expect(popup.link.click).not.toHaveBeenCalled();
});

it("does not let stale completion close a newer browser tab", async () => {
	const first = browserWindow().popup;
	const pending = pendingResource();
	mocks.invoke.mockReturnValueOnce(pending.promise);
	await render();
	await act(async () => {
		void current.open();
	});
	const second = browserWindow().popup;
	const newer = pendingResource();
	mocks.invoke.mockReturnValueOnce(newer.promise);
	await act(async () => {
		void current.open();
	});
	expect(first.close).toHaveBeenCalled();
	await act(async () =>
		pending.resolve({
			url: "https://storage.example/old",
			expiresAt: "2030-01-01T00:01:00Z",
		}),
	);
	expect(first.link.click).not.toHaveBeenCalled();
	expect(second.close).not.toHaveBeenCalled();
	expect(second.link.click).not.toHaveBeenCalled();
	await act(async () =>
		newer.resolve({
			url: "https://storage.example/first",
			expiresAt: "2030-01-01T00:01:00Z",
		}),
	);
	expect(second.link.click).toHaveBeenCalledOnce();
	expect(second.link.href).toBe("https://storage.example/first");
	expect(second.close).not.toHaveBeenCalled();
});
