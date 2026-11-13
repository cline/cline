// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	FactoryFilingNotice,
	latestFactoryFiling,
} from "./factory-filing-notice";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let index = 0;
const tool = (toolName: string, result: unknown): ChatMessage => ({
	id: `m${++index}`,
	sessionId: "s1",
	role: "tool",
	content: JSON.stringify({ toolName, input: {}, result }),
	createdAt: index,
});
const covered = {
	taskId: "t-12",
	factoryId: "F12",
	title: "Retry flaky uploads",
	state: "Review",
	at: "2026-11-12T10:00:00Z",
};
const blocked = {
	ok: true,
	existing: true,
	task: { taskId: "t-12", title: "Retry flaky uploads", status: "in_progress" },
	duplicateOf: covered,
	reason: "Same change",
	fileAnyway: "Pass allow_duplicate: true",
};

describe("latestFactoryFiling", () => {
	it("reads a blocked filing, also from a string result", () => {
		expect(latestFactoryFiling([tool("factory", blocked)])).toEqual({
			kind: "duplicate",
			card: covered,
		});
		expect(
			latestFactoryFiling([tool("factory", JSON.stringify(blocked))]),
		).toEqual({ kind: "duplicate", card: covered });
	});

	it("names related cards of a created one, and nothing for a plain filing", () => {
		const related = [{ taskId: "t-7", factoryId: "F7", title: "Upload UI" }];
		expect(
			latestFactoryFiling([
				tool("factory", blocked),
				tool("factory", { ok: true, existing: false, relatedTo: related }),
			]),
		).toEqual({ kind: "related", cards: related });
		// The latest filing decides: a later plain filing clears the notice.
		expect(
			latestFactoryFiling([
				tool("factory", blocked),
				tool("factory_list", { ok: true }),
				tool("factory", { ok: true, existing: false }),
			]),
		).toBeUndefined();
		expect(latestFactoryFiling([tool("read_file", blocked)])).toBeUndefined();
		// Only this turn's filing: a later message from the person clears it.
		expect(
			latestFactoryFiling([
				tool("factory", blocked),
				{ ...tool("x", null), role: "user", content: "Thanks" },
			]),
		).toBeUndefined();
	});
});

describe("FactoryFilingNotice", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	const buttons = () => [...container.querySelectorAll("button")];

	it("says which card covers the work, opens it, and files anyway once the chat is idle", async () => {
		const onOpenCard = vi.fn();
		const onFileAnyway = vi.fn();
		const render = (busy: boolean) =>
			act(async () =>
				root.render(
					<FactoryFilingNotice
						filing={{ kind: "duplicate", card: covered }}
						busy={busy}
						onOpenCard={onOpenCard}
						onFileAnyway={onFileAnyway}
					/>,
				),
			);
		await render(true);
		expect(container.textContent).toContain(
			"F12 already covers this — it is in Review.",
		);
		expect(buttons().map((button) => button.textContent)).toEqual([
			"Open F12",
			"File anyway",
		]);
		// File anyway is a command, so it is bordered like Open, not caption-like text.
		for (const button of buttons())
			expect(button.classList.contains("border")).toBe(true);
		expect(buttons()[1]?.disabled).toBe(true);
		await act(async () => buttons()[0]?.click());
		expect(onOpenCard).toHaveBeenCalledWith("t-12");
		await render(false);
		await act(async () => buttons()[1]?.click());
		expect(onFileAnyway).toHaveBeenCalledTimes(1);
	});

	it("names the related cards as links", async () => {
		const onOpenCard = vi.fn();
		await act(async () =>
			root.render(
				<FactoryFilingNotice
					filing={{
						kind: "related",
						cards: [
							{ taskId: "t-7", factoryId: "F7", title: "Upload UI" },
							{ taskId: "t-9", factoryId: "F9", title: "Upload API" },
						],
					}}
					busy={false}
					onOpenCard={onOpenCard}
					onFileAnyway={vi.fn()}
				/>,
			),
		);
		expect(container.textContent).toBe("Related: F7, F9");
		await act(async () => buttons()[1]?.click());
		expect(onOpenCard).toHaveBeenCalledWith("t-9");
	});
});
