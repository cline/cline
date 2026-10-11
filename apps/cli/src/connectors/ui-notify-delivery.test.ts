import { describe, expect, it } from "vitest";

import {
	resolveNotifyMessageKey,
	resolveNotifyTargets,
} from "./ui-notify-delivery";

const bindings = {
	"telegram:-100:49": {
		state: { cwd: "/code/partyshare", workspaceRoot: "/code/partyshare" },
	},
	"telegram:-100:2": {
		state: { cwd: "/code/other", workspaceRoot: "/code/other" },
	},
	"telegram:946217355": { state: {} },
};

describe("resolveNotifyTargets", () => {
	it("routes to the thread bound to the workspace the notification came from", () => {
		expect(
			resolveNotifyTargets(bindings, { workspacePath: "/code/partyshare" }),
		).toEqual(["telegram:-100:49"]);
	});

	// The whole reason `source` exists. Delivering to every thread, or to whichever was most
	// recently active, is a guess -- and a guess that fails silently, because the message does
	// arrive somewhere. Silence is the correct answer when we do not know where it belongs.
	it("delivers nowhere when no thread is bound to that workspace", () => {
		expect(
			resolveNotifyTargets(bindings, { workspacePath: "/code/unrelated" }),
		).toEqual([]);
	});

	it("delivers nowhere when the notification carries no source", () => {
		expect(resolveNotifyTargets(bindings, undefined)).toEqual([]);
		expect(resolveNotifyTargets(bindings, {})).toEqual([]);
	});

	it("ignores a trailing separator, which is the same directory", () => {
		expect(
			resolveNotifyTargets(bindings, { workspacePath: "/code/partyshare/" }),
		).toEqual(["telegram:-100:49"]);
	});

	// A workspace can legitimately have more than one conversation bound to it -- two topics on
	// the same repo, for instance. Both are correct targets; picking one would be the guess
	// this module exists to avoid.
	it("routes to every thread bound to that workspace", () => {
		const many = {
			a: { state: { cwd: "/code/app" } },
			b: { state: { cwd: "/code/app" } },
			c: { state: { cwd: "/code/elsewhere" } },
		};
		expect(
			resolveNotifyTargets(many, { workspacePath: "/code/app" }).sort(),
		).toEqual(["a", "b"]);
	});

	it("matches on workspaceRoot when cwd is a subdirectory of it", () => {
		const nested = {
			x: {
				state: { cwd: "/code/app/packages/web", workspaceRoot: "/code/app" },
			},
		};
		expect(
			resolveNotifyTargets(nested, { workspacePath: "/code/app" }),
		).toEqual(["x"]);
	});
});

describe("resolveNotifyMessageKey", () => {
	it("pairs the conversation with the thing the notification is about", () => {
		const key = resolveNotifyMessageKey("telegram:-100:49", "461e5");
		expect(key).toContain("telegram:-100:49");
		expect(key).toContain("461e5");
	});

	it("keeps the same item in different conversations apart", () => {
		expect(resolveNotifyMessageKey("telegram:a", "461e5")).not.toBe(
			resolveNotifyMessageKey("telegram:b", "461e5"),
		);
	});

	it("refuses to track a notification that names no item", () => {
		// Nothing to supersede, and updating whatever was posted last would overwrite an
		// unrelated message.
		expect(resolveNotifyMessageKey("telegram:a", undefined)).toBeUndefined();
		expect(resolveNotifyMessageKey("telegram:a", "   ")).toBeUndefined();
	});

	it("cannot be confused by an id that looks like a joined key", () => {
		expect(resolveNotifyMessageKey("x", 'y","z')).not.toBe(
			resolveNotifyMessageKey('x","y', "z"),
		);
	});
});
