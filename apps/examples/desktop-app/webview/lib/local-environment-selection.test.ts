// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from "vitest";
import { getInitialChatConfig } from "@/hooks/chat-session/constants";
import { createLocalEnvironmentSelection } from "./local-environment-selection";
import {
	readExecutionTargetFromWindow,
	writeExecutionTargetToWindow,
} from "./model-selection";

beforeEach(() => {
	window.localStorage.clear();
	writeExecutionTargetToWindow("cloud");
});

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

it("waits for an explicit Local switch before mounting a draft when the event arrives first", async () => {
	const selection = createLocalEnvironmentSelection();
	const disconnect = deferred();
	const mountedTargets: string[] = [];
	const selectDraft = vi.fn(() => {
		mountedTargets.push(getInitialChatConfig("local").executionTarget);
	});
	const switched = selection.select(() => {
		// The real sidecar emits this before its command reply.
		selection.onDisconnected(selectDraft);
		return disconnect.promise;
	}, selectDraft);
	expect(selectDraft).not.toHaveBeenCalled();
	expect(readExecutionTargetFromWindow()).toBe("cloud");
	disconnect.resolve();
	await switched;
	expect(mountedTargets).toEqual(["local"]);
	// A later duplicate event also sees the committed preference.
	selection.onDisconnected(selectDraft);
	expect(mountedTargets).toEqual(["local", "local"]);
});

it("does not schedule deferred navigation while an explicit switch is pending", async () => {
	const selection = createLocalEnvironmentSelection();
	const disconnect = deferred();
	const deferNavigation = vi.fn();
	const switched = selection.select(() => disconnect.promise, vi.fn());
	selection.onDisconnected(deferNavigation);
	expect(deferNavigation).not.toHaveBeenCalled();
	disconnect.resolve();
	await switched;
});

it("keeps Cloud remembered after failure and continues handling unsolicited disconnects", async () => {
	const selection = createLocalEnvironmentSelection();
	const disconnect = deferred();
	const selectDraft = vi.fn();
	const switched = selection.select(() => disconnect.promise, selectDraft);
	disconnect.reject(new Error("disconnect failed"));
	await expect(switched).rejects.toThrow("disconnect failed");
	expect(selectDraft).not.toHaveBeenCalled();
	expect(readExecutionTargetFromWindow()).toBe("cloud");
	selection.onDisconnected(selectDraft);
	expect(selectDraft).toHaveBeenCalledTimes(1);
	expect(readExecutionTargetFromWindow()).toBe("cloud");
});

it("retains event coordination until overlapping explicit switches have both settled", async () => {
	const selection = createLocalEnvironmentSelection();
	const first = deferred();
	const second = deferred();
	const selectDraft = vi.fn();
	const firstSwitch = selection.select(() => first.promise, selectDraft);
	const secondSwitch = selection.select(() => second.promise, selectDraft);
	first.resolve();
	await firstSwitch;
	selection.onDisconnected(selectDraft);
	expect(selectDraft).toHaveBeenCalledTimes(1);
	second.resolve();
	await secondSwitch;
	expect(selectDraft).toHaveBeenCalledTimes(2);
	selection.onDisconnected(selectDraft);
	expect(selectDraft).toHaveBeenCalledTimes(3);
});
