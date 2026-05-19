import { describe, expect, it } from "vitest";
import {
	computeContentHash,
	inferTriggerKindFromPath,
	parseCronSpecFile,
	splitFrontmatter,
} from "./cron-spec-parser";

describe("inferTriggerKindFromPath", () => {
	it("classifies *.cron.md as schedule", () => {
		expect(inferTriggerKindFromPath("nightly.cron.md")).toBe("schedule");
	});
	it("classifies events/*.event.md as event", () => {
		expect(inferTriggerKindFromPath("events/pr.event.md")).toBe("event");
	});
	it("classifies other *.md as one_off", () => {
		expect(inferTriggerKindFromPath("repo-cleanup.md")).toBe("one_off");
	});
	it("does not classify *.event.md outside events/ as event", () => {
		expect(inferTriggerKindFromPath("weird.event.md")).toBe("one_off");
	});
});

describe("splitFrontmatter", () => {
	it("returns undefined when no frontmatter", () => {
		const result = splitFrontmatter("hello");
		expect(result.frontmatter).toBeUndefined();
		expect(result.body).toBe("hello");
	});
	it("splits frontmatter and body", () => {
		const { frontmatter, body } = splitFrontmatter(
			`---\nid: x\n---\nBody here`,
		);
		expect(frontmatter).toContain("id: x");
		expect(body).toBe("Body here");
	});
});

describe("computeContentHash", () => {
	it("is stable under key order", () => {
		expect(computeContentHash({ b: 1, a: 2 }, "body")).toBe(
			computeContentHash({ a: 2, b: 1 }, "body"),
		);
	});

	describe("parseCronSpecFile: one-off", () => {
		it("parses with body prompt", () => {
			const raw = `---\nid: cleanup\ntitle: Clean\nworkspaceRoot: /ws\nmode: act\n---\nRemove stale files.`;
			const r = parseCronSpecFile({ relativePath: "cleanup.md", raw });
			expect(r.error).toBeUndefined();
			expect(r.externalId).toBe("cleanup");
			expect(r.triggerKind).toBe("one_off");
			expect(r.spec?.title).toBe("Clean");
			expect(r.spec?.prompt).toBe("Remove stale files.");
		});

		it("defaults to yolo and parses cron runtime fields", () => {
			const raw = `---\nid: cleanup\nworkspaceRoot: /ws\ntools: run_commands,read_files\nnotesDirectory: /notes\nextensions:\n  - rules\n  - skills\nsource: automation\n---\nBody`;
			const r = parseCronSpecFile({ relativePath: "cleanup.md", raw });
			expect(r.error).toBeUndefined();
			expect(r.spec?.mode).toBe("yolo");
			expect(r.spec?.tools).toEqual(["run_commands", "read_files"]);
			expect(r.spec?.notesDirectory).toBe("/notes");
			expect(r.spec?.extensions).toEqual(["rules", "skills"]);
			expect(r.spec?.source).toBe("automation");
		});

		it("preserves explicit empty tools and extensions lists", () => {
			const raw = `---\nid: cleanup\nworkspaceRoot: /ws\ntools: []\nextensions: []\n---\nBody`;
			const r = parseCronSpecFile({ relativePath: "cleanup.md", raw });
			expect(r.error).toBeUndefined();
			expect(r.spec?.tools).toEqual([]);
			expect(r.spec?.extensions).toEqual([]);
		});

		it("falls back to filename stem title", () => {
			const raw = `---\nworkspaceRoot: /ws\n---\ndo work`;
			const r = parseCronSpecFile({
				relativePath: "nested/fix-thing.md",
				raw,
			});
			expect(r.error).toBeUndefined();
			expect(r.externalId).toBe("nested/fix-thing.md");
			expect(r.spec?.title).toBe("fix-thing");
		});

		it("fails without workspaceRoot", () => {
			const r = parseCronSpecFile({
				relativePath: "x.md",
				raw: `---\nid: x\n---\nbody`,
			});
			expect(r.error).toMatch(/workspaceRoot/);
		});

		it("fails when prompt and body both empty", () => {
			const r = parseCronSpecFile({
				relativePath: "x.md",
				raw: `---\nworkspaceRoot: /ws\n---\n`,
			});
			expect(r.error).toMatch(/prompt is required/);
		});

		it("rejects schedule fields on one-off", () => {
			const r = parseCronSpecFile({
				relativePath: "x.md",
				raw: `---\nworkspaceRoot: /ws\nschedule: "* * * * *"\n---\nbody`,
			});
			expect(r.error).toMatch(/schedule/);
		});

		it("rejects event fields on one-off", () => {
			const r = parseCronSpecFile({
				relativePath: "x.md",
				raw: `---\nworkspaceRoot: /ws\nevent: github.pr\n---\nbody`,
			});
			expect(r.error).toMatch(/event/);
		});

		it("rejects removed cwd field", () => {
			const r = parseCronSpecFile({
				relativePath: "x.md",
				raw: `---\nworkspaceRoot: /ws\ncwd: /ws/subdir\n---\nbody`,
			});
			expect(r.error).toMatch(/cwd/);
		});

		it("rejects invalid mode values", () => {
			const r = parseCronSpecFile({
				relativePath: "x.md",
				raw: `---\nworkspaceRoot: /ws\nmode: autopilot\n---\nbody`,
			});
			expect(r.error).toMatch(/mode/);
		});
	});

	describe("parseCronSpecFile: schedule", () => {
		it("parses a valid *.cron.md", () => {
			const raw = `---\nid: nightly\nworkspaceRoot: /ws\nschedule: "0 2 * * *"\ntimezone: UTC\n---\nDo work.`;
			const r = parseCronSpecFile({ relativePath: "nightly.cron.md", raw });
			expect(r.error).toBeUndefined();
			expect(r.spec?.triggerKind).toBe("schedule");
			if (r.spec?.triggerKind === "schedule") {
				expect(r.spec.schedule).toBe("0 2 * * *");
				expect(r.spec.timezone).toBe("UTC");
			}
		});
		it("fails on *.cron.md without schedule", () => {
			const r = parseCronSpecFile({
				relativePath: "x.cron.md",
				raw: `---\nworkspaceRoot: /ws\n---\nbody`,
			});
			expect(r.error).toMatch(/schedule/);
		});

		it("fails on invalid cron pattern", () => {
			const r = parseCronSpecFile({
				relativePath: "x.cron.md",
				raw: `---\nworkspaceRoot: /ws\nschedule: "bad cron"\n---\nbody`,
			});
			expect(r.error).toMatch(/Invalid cron pattern/);
		});
	});

	describe("parseCronSpecFile: event", () => {
		it("parses events/*.event.md", () => {
			const raw = `---\nid: pr\nworkspaceRoot: /ws\nevent: gh.pr.opened\nfilters:\n  repo: acme\ndebounceSeconds: 30\nmaxParallel: 2\n---\nReview PR.`;
			const r = parseCronSpecFile({
				relativePath: "events/pr.event.md",
				raw,
			});
			expect(r.error).toBeUndefined();
			expect(r.triggerKind).toBe("event");
			if (r.spec?.triggerKind === "event") {
				expect(r.spec.event).toBe("gh.pr.opened");
				expect(r.spec.filters?.repo).toBe("acme");
				expect(r.spec.maxParallel).toBe(2);
			}
		});
		it("fails on event spec without event", () => {
			const r = parseCronSpecFile({
				relativePath: "events/x.event.md",
				raw: `---\nworkspaceRoot: /ws\n---\nbody`,
			});
			expect(r.error).toMatch(/event/);
		});
	});

	describe("parseCronSpecFile: invalid frontmatter", () => {
		it("records parse error without throwing", () => {
			const r = parseCronSpecFile({
				relativePath: "bad.md",
				raw: `---\nid: [unclosed\n---\nbody`,
			});
			expect(r.error).toBeDefined();
			expect(r.spec).toBeUndefined();
		});
	});
});
