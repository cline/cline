import { describe, expect, test } from "bun:test";
import type { Manifest } from "../context/manifest";
import { clineSources } from "../context/sources/index";
import { emptyFold } from "../hub/fold";
import { HubLink } from "../hub/link";
import { EMPTY_BACKLOG } from "./backlog";
import { REVIEW_PROMPT, suggestion, type TurnFacts } from "./candidates";
import { buildPlannerInput, plannerSystemPrompt, unreadSources } from "./input";
import { CORE_KINDS, offerableKinds } from "./kinds";
import { buildModelSet, parsePlannerOutput } from "./output";

/** How the Cline-first sources name themselves, as `NextSession` hands them to the planner. */
function clineSourceNames(): Record<string, string> {
	const link = new HubLink({
		resolveEndpoint: async () => undefined,
		createClient: () => {
			throw new Error("never connects");
		},
		sleep: async () => {},
	});
	const cline = clineSources(link, emptyFold, {}, undefined, { plan: true });
	cline.stop();
	return Object.fromEntries(
		cline.sources.map((source) => [source.id, source.displayName ?? source.id]),
	);
}

function manifestOf(
	sources: Manifest["sources"],
	capabilities: string[] = [],
	mode: Manifest["mode"] = "act",
): Manifest {
	return { client: "cline-cli", mode, sources, capabilities };
}

const turn: TurnFacts = {
	status: "completed",
	filesEdited: 1,
	toolErrored: false,
};
const context = {
	request: "Add a retry. My key is sk-ant-0123456789abcdefghij",
	reply: "Added it.",
	tools: [],
	editedPaths: ["src/retry.ts"],
};

describe("the planner's input", () => {
	test("a stock install hears nothing about sources it does not have", () => {
		const manifest = manifestOf({
			turn: "present",
			git: "present",
			status: "absent",
			tasks: "absent",
			plan: "absent",
			history: "off",
		});
		const input = buildPlannerInput({
			turn,
			context,
			backlog: EMPTY_BACKLOG,
			manifest,
			facts: {},
			names: {},
			kinds: CORE_KINDS,
			excluded: [],
		});
		expect(input.user).not.toMatch(
			/Status Hub|agenda|plan bank|Could not read|other chats/,
		);
		expect(input.user).toContain("[redacted]");
		expect(input.user).not.toContain("0123456789abcdefghij");
	});

	test("present sources say none when empty; unknown ones are named; facts keep their headings", () => {
		const manifest = manifestOf(
			{
				turn: "present",
				status: "present",
				tasks: "present",
				history: "present",
				repo: "present",
				plan: "unknown",
			},
			["github", "remote:github", "mcp:sentry"],
		);
		const facts = {
			history: "unknown" as const,
			repo: {
				heading: "This repository's commands",
				lines: ["bun run check (password=hunter22222)"],
			},
		};
		const input = buildPlannerInput({
			turn,
			context,
			backlog: EMPTY_BACKLOG,
			manifest,
			facts,
			names: clineSourceNames(),
			kinds: offerableKinds(manifest),
			excluded: ["Run the tests."],
		});
		expect(input.user).toContain(
			"## This chat on the Status Hub\nNothing reported for this chat.",
		);
		expect(input.user).toContain("## Tasks on the agenda\nNo open tasks.");
		expect(input.user).toContain(
			"## This repository's commands\n- bun run check (password=[redacted]",
		);
		expect(input.user).toContain(
			"## Connected services the agent can use (names only)\ngithub, mcp:sentry",
		);
		expect(input.user).toContain(
			"- The plan and the plan bank — treat as unknown, not empty.",
		);
		expect(input.user).toContain(
			"- Your other chats — treat as unknown, not empty.",
		);
		expect(input.user).toContain("- Run the tests.");
		expect(unreadSources(manifest, facts)).toEqual(["history", "plan"]);
		expect(input.system).toContain(
			"kind is one of: fix_failure, continue, next_step, verify, review_diff, wrap_up, commit, check_ci, reply_review.",
		);
		expect(input.system).toContain(
			"reply_review: ask the agent to answer review comments on the pull request; the person reads it before it is sent",
		);
	});

	test("plan mode asks for planning prompts", () => {
		expect(plannerSystemPrompt(CORE_KINDS, "plan")).toContain(
			"The chat is in plan mode",
		);
		expect(plannerSystemPrompt(CORE_KINDS, "act")).not.toContain("plan mode");
		expect(plannerSystemPrompt(CORE_KINDS, "act")).toContain(
			"source is one of: turn, status, tasks, plan, repo, connector — ",
		);
	});
});

describe("the planner's output", () => {
	test("keeps good rows, drops kinds this environment does not offer, and marks outward ones", () => {
		const text = `Sure! {"suggestions":[
			{"kind":"verify","source":"turn","prompt":"Run   bun test src/retry.test.ts","why":"retry.ts changed"},
			{"kind":"check_ci","source":"connector","prompt":"Check CI on the PR for this branch.","why":"pushed"},
			{"kind":"reply_review","source":"connector","prompt":"Reply to the review on the retry PR.","why":"review waiting"},
			{"kind":"delete_everything","prompt":"rm -rf the repo please","why":"x"},
			{"kind":"verify","prompt":"short"},
			{"kind":"continue","source":"tasks","prompt":"Do the next task: Ship it","ref":"t1","why":"approved"}
		]}`;
		const stock = parsePlannerOutput(text, CORE_KINDS);
		expect(stock?.map((row) => row.kind)).toEqual(["verify", "continue"]);
		expect(stock?.[0]?.prompt).toBe("Run bun test src/retry.test.ts");
		expect(stock?.[1]).toMatchObject({ source: "tasks", ref: "t1" });
		const github = parsePlannerOutput(
			text,
			offerableKinds({ capabilities: ["github"] }),
		);
		expect(github?.find((row) => row.kind === "reply_review")?.outward).toBe(
			true,
		);
		expect(
			github?.find((row) => row.kind === "check_ci")?.outward,
		).toBeUndefined();
		expect(parsePlannerOutput("no json here", CORE_KINDS)).toBeNull();
		expect(parsePlannerOutput('{"suggestions":[]}', CORE_KINDS)).toBeNull();
	});

	test("blocking rows lead, a failed turn's fix comes next on the first set only, then the model, then the rules", () => {
		const blocking = suggestion(
			"fix_failure",
			"status",
			"Unblock auth: schema",
			"blocked",
			{ ref: "auth" },
		);
		const review = suggestion("review_diff", "turn", REVIEW_PROMPT, "changed");
		const pool = [
			suggestion("verify", "model", "Run the retry tests.", "changed"),
			suggestion("wrap_up", "model", "Summarize the retry work.", "done"),
		];
		const failed: TurnFacts = {
			status: "completed",
			filesEdited: 1,
			toolErrored: true,
		};
		const first = buildModelSet({
			pool,
			rules: [blocking, review],
			turn: failed,
			excluded: [],
		});
		expect(first.map((row) => row.prompt)).toEqual([
			"Unblock auth: schema",
			"Fix the failure from the last turn and run it again.",
			"Run the retry tests.",
		]);
		const later = buildModelSet({
			pool,
			rules: [blocking, review],
			turn: failed,
			excluded: ["Run the retry tests."],
		});
		expect(later.map((row) => row.prompt)).toEqual([
			"Unblock auth: schema",
			"Summarize the retry work.",
			REVIEW_PROMPT,
		]);
	});
});
