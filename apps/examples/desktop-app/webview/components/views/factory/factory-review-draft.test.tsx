// @vitest-environment jsdom

import type {
	FactoryReviewDraft,
	FactoryReviewPullRequest,
} from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopClient } from "@/lib/desktop-client";
import { FactoryReviewDraftPanel } from "./factory-review-draft";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn() },
	openExternalUrl: vi.fn(),
}));

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const pullRequest: FactoryReviewPullRequest = {
	host: "github.com",
	owner: "acme",
	name: "widgets",
	number: 15,
	url: "https://github.com/acme/widgets/pull/15",
	title: "Add a retry to the uploader",
	author: { login: "octo", association: "CONTRIBUTOR" },
	isDraft: false,
	isCrossRepository: true,
	baseRefName: "main",
	baseSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
	headSha: HEAD,
	changedFiles: 2,
	additions: 30,
	deletions: 4,
	viewerLogin: "someone",
};
const comment = (id: string, line: number, body: string) => ({
	id,
	path: "src/upload.ts",
	line,
	side: "RIGHT" as const,
	severity: "major" as const,
	body,
	reviewers: ["Reviewer 1"],
});
const draft: FactoryReviewDraft = {
	schemaVersion: 1,
	headSha: HEAD,
	createdAt: "2026-11-10T10:00:00.000Z",
	verdict: "request_changes",
	// Reviewer text arrives inert (factoryReviewInertMarkdown).
	body: "The retry loop never stops on a permanent error. See !\\[log].",
	comments: [
		comment("c1", 12, "Stop retrying on 4xx; see \\<details> and `a<b>`."),
		comment("c2", 20, "Cap the backoff."),
		comment("c3", 31, "Log the final failure."),
	],
	findings: [],
	questions: [],
	notChecked: [],
	reviewers: [],
	dropped: [],
};

let container: HTMLDivElement;
let root: Root;
const invoke = vi.mocked(desktopClient.invoke);

beforeEach(() => {
	sessionStorage.clear();
	invoke.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

async function render(
	props: Partial<Parameters<typeof FactoryReviewDraftPanel>[0]> = {},
) {
	await act(async () =>
		root.render(
			<FactoryReviewDraftPanel
				taskId="task_1"
				reference="acme/widgets#15"
				pullRequest={pullRequest}
				draft={draft}
				postRunning={false}
				archived={false}
				onRefresh={async () => undefined}
				onOpenSession={vi.fn()}
				{...props}
			/>,
		),
	);
}

const button = (name: string) => {
	const found = [...document.querySelectorAll("button")].find(
		(item) =>
			item.textContent?.trim() === name ||
			item.getAttribute("aria-label") === name,
	);
	if (!found) throw new Error(`Missing button ${name}`);
	return found;
};

async function type(label: string, value: string) {
	const field = document.querySelector(`textarea[aria-label="${label}"]`);
	if (!(field instanceof HTMLTextAreaElement)) throw new Error(label);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

describe("FactoryReviewDraftPanel", () => {
	it("posts only the included comments, as edited, as a Comment after confirming", async () => {
		await render();
		// Read without escapes; nothing the reviewers wrote is rendered.
		expect(document.body.textContent).toContain(
			"Stop retrying on 4xx; see <details> and `a<b>`.",
		);
		expect(
			document.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Summary"]',
			)?.value,
		).toBe("The retry loop never stops on a permanent error. See ![log].");
		await act(async () =>
			button("Include the comment on src/upload.ts:20").click(),
		);
		await act(async () =>
			button("Edit the comment on src/upload.ts:31").click(),
		);
		await type("Edit the comment on src/upload.ts:31", "Log it once.");
		await type("Summary", "Two problems.");
		await act(async () => button("Post review…").click());
		// The confirmation says what goes where; nothing is sent before it.
		expect(document.body.textContent).toContain(
			"Post 2 comments to acme/widgets#15 as someone on github.com?",
		);
		expect(invoke).not.toHaveBeenCalled();
		await act(async () => button("Post review").click());
		expect(invoke).toHaveBeenCalledWith(
			"task.factory.review.post",
			{
				taskId: "task_1",
				allWorkspaces: true,
				expectedHead: HEAD,
				expectedDraft: draft.createdAt,
				event: "COMMENT",
				body: "Two problems.",
				// What the person read; the Hub makes it inert again, so the
				// unedited comment posts exactly as drafted.
				comments: [
					{ id: "c1", body: "Stop retrying on 4xx; see <details> and `a<b>`." },
					{ id: "c3", body: "Log it once." },
				],
			},
			{ timeoutMs: null },
		);
	});

	it("keeps typed summary and comment edits when the card is left without leaving the field", async () => {
		await render();
		await act(async () =>
			button("Edit the comment on src/upload.ts:31").click(),
		);
		await type("Edit the comment on src/upload.ts:31", "Log it once.");
		await type("Summary", "Two problems.");
		act(() => root.unmount());
		root = createRoot(container);
		await render();
		expect(
			document.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Summary"]',
			)?.value,
		).toBe("Two problems.");
		expect(document.body.textContent).toContain("Log it once.");
	});

	it("gives the summary its hint as the field's description, outside the text", async () => {
		await render();
		const field = document.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Summary"]',
		);
		const hint = document.getElementById(
			field?.getAttribute("aria-describedby") ?? "",
		);
		expect(hint?.textContent).toBe(
			"Posted as the review's main comment, with its findings and questions.",
		);
		expect(
			field?.compareDocumentPosition(hint as Node) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("marks the chosen verdict with a tint and a check, starting on Comment even when the draft suggests otherwise", async () => {
		await render({ draft: { ...draft, verdict: "approve" } });
		const verdicts = () =>
			[
				...document.querySelectorAll<HTMLElement>(
					'[aria-label="Post as"] button',
				),
			].map((item) => ({
				name: item.textContent?.trim(),
				on: item.dataset.state === "on",
				tinted: item.className.includes("data-[state=on]:bg-primary/15"),
				check: Boolean(item.querySelector("svg")),
			}));
		expect(verdicts().filter((item) => item.on)).toEqual([
			{ name: "Comment", on: true, tinted: true, check: true },
		]);
		expect(verdicts().filter((item) => item.check)).toHaveLength(1);
		await act(async () => button("Request changes").click());
		expect(
			verdicts()
				.filter((item) => item.check)
				.map((item) => item.name),
		).toEqual(["Request changes"]);
	});

	it("leaves a comment out when its text is clicked", async () => {
		await render();
		const text = [...document.querySelectorAll("label")].find(
			(item) => item.textContent === "Cap the backoff.",
		);
		await act(async () => text?.click());
		expect(
			button("Include the comment on src/upload.ts:20").getAttribute(
				"aria-checked",
			),
		).toBe("false");
	});

	it("offers only a comment on the person's own pull request, as GitHub names them", async () => {
		await render({ pullRequest: { ...pullRequest, viewerLogin: "Octo" } });
		expect(document.body.textContent).not.toContain("Request changes");
		expect(document.body.textContent).not.toContain("Approve");
		expect(document.body.textContent).toContain(
			"This is your own pull request",
		);
	});

	it("after a refusal for new commits, offers Review again instead of posting", async () => {
		invoke.mockResolvedValueOnce({
			ok: false,
			error: {
				code: "factory_review_stale_head",
				message: "Any wording.",
			},
		});
		await render();
		await act(async () => button("Post review…").click());
		await act(async () => button("Post review").click());
		expect(document.body.textContent).toContain(
			"The pull request changed since this review.",
		);
		expect(() => button("Post review…")).toThrow();
		invoke.mockResolvedValueOnce({ unchanged: false });
		await act(async () => button("Review again").click());
		expect(invoke).toHaveBeenLastCalledWith("task.factory.review.rerun", {
			taskId: "task_1",
			allWorkspaces: true,
		});
	});

	it("on reload, offers no post the Hub knows GitHub would refuse, and tells a running post from a lost one", async () => {
		await render({
			pullRequestNow: { headSha: HEAD, open: false, at: draft.createdAt },
		});
		expect(document.body.textContent).toContain("The pull request is closed.");
		expect(() => button("Post review…")).toThrow();
		const posting = {
			state: "posting" as const,
			event: "COMMENT" as const,
			headSha: HEAD,
			at: draft.createdAt,
			comments: 3,
		};
		await render({ post: posting, postRunning: true });
		expect(document.body.textContent).toContain("Posting review…");
		expect(document.body.textContent).not.toContain("Posting did not confirm");
		await render({ post: posting, postRunning: false });
		expect(document.body.textContent).toContain("Posting did not confirm");
	});

	it("shows a posted draft as Markdown that fetches nothing", async () => {
		await render({
			draft: {
				...draft,
				// Inert, but for an app image Markdown elsewhere would load.
				body: "Logs: !\\[x\\](https\\://evil.example/p) and \\<img src=x> ![y](/x.png)",
			},
			post: {
				state: "posted",
				event: "COMMENT",
				headSha: HEAD,
				at: draft.createdAt,
				comments: 3,
				url: "https://github.com/acme/widgets/pull/15#pullrequestreview-1",
			},
		});
		expect(document.querySelector("img")).toBeNull();
		expect(document.body.textContent).toContain(
			"Logs: ![x](https://evil.example/p) and <img src=x>",
		);
	});
});
