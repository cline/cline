// @vitest-environment jsdom
import type { AgendaTaskRecord } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FactoryAttention } from "@/hooks/use-factory-attention";
import {
	FACTORY_DECISION,
	FACTORY_LINE,
	FACTORY_MESSAGES,
} from "@/lib/factory-copy";
import {
	FactoryRowStages,
	FactoryStationLine,
	type FactoryStationState,
	factoryCardStations,
} from "./factory-line";
import { type FactoryTone, factoryActivity } from "./factory-ui";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const state = (
	station: FactoryStationState["station"],
	extra: Partial<FactoryStationState> = {},
): FactoryStationState => ({
	station,
	stopped: false,
	skipped: [],
	deliveredToday: false,
	...extra,
});
const states = (value: FactoryStationState) =>
	factoryCardStations(value).map((item) => `${item.station}:${item.state}`);

describe("factoryCardStations", () => {
	it("draws five stages, checks inside Build, with done, current, upcoming and skipped", () => {
		expect(
			states(state("build", { checks: true, skipped: ["verify"] })),
		).toEqual([
			"scope:done",
			"build:current",
			"verify:skipped",
			"review:upcoming",
			"delivered:upcoming",
		]);
		expect(states(state("review", { stopped: true }))[3]).toBe(
			"review:stopped",
		);
		// Waiting is a state before the stages, not one of them.
		expect(
			factoryCardStations(state("waiting")).every(
				(item) => item.state === "upcoming",
			),
		).toBe(true);
		// Done is the end of the line, done rather than in progress.
		expect(
			factoryCardStations(state("delivered")).every(
				(item) => item.state === "done",
			),
		).toBe(true);
	});
});

describe("FactoryStationLine", () => {
	it("draws the card's stages as a stepper, its own stage marked", async () => {
		await act(async () =>
			root.render(
				<FactoryStationLine
					aria-label="Where this card is"
					stations={factoryCardStations(
						state("build", { stopped: true, skipped: ["verify"] }),
					)}
				/>,
			),
		);
		const line = container.querySelector('[data-factory-line="compact"]');
		expect(line?.tagName).toBe("OL");
		expect(line?.textContent).toBe("ScopeBuild, Stopped at BuildReviewDone");
		expect(
			container
				.querySelector('[aria-current="step"]')
				?.getAttribute("data-factory-station"),
		).toBe("build");
		const items = Array.from(
			line?.querySelectorAll("li[data-factory-station]") ?? [],
		);
		expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
			"done",
			"stopped",
			"upcoming",
			"upcoming",
		]);
		expect(items[1]?.querySelector("svg")?.getAttribute("class")).toContain(
			"text-error-text",
		);
		// A connector trails every step but the last, so a wrapped line never
		// starts with one.
		const connectors = items.map(
			(item) => item.lastElementChild?.className === "mx-1.5 h-px w-2.5 bg-border",
		);
		expect(connectors).toEqual([true, true, true, false]);
		expect(items[0]?.className).toContain("whitespace-nowrap");
	});
});

describe("FactoryRowStages", () => {
	const render = async (
		value: FactoryStationState,
		tone: FactoryTone = "working",
	) =>
		act(async () =>
			root.render(<FactoryRowStages state={value} tone={tone} />),
		);
	const segments = () =>
		Array.from(container.querySelectorAll("[data-factory-segment]")).map(
			(item) => item.getAttribute("data-state"),
		);

	it("draws five segments with the stage's name and a spoken label", async () => {
		await render(state("verify"));
		expect(segments()).toEqual([
			"done",
			"done",
			"current",
			"upcoming",
			"upcoming",
		]);
		expect(
			container.querySelector('[role="img"]')?.getAttribute("aria-label"),
		).toBe("Verify, stage 3 of 5");
		expect(container.textContent).toBe("Verify");
		expect(
			container.querySelector('[data-factory-segment="verify"]')?.className,
		).toContain("bg-sky-500");
	});

	it("marks a stop in red and a skipped stage as a dash", async () => {
		await render(
			state("review", { stopped: true, skipped: ["verify"] }),
			"danger",
		);
		expect(segments()).toEqual([
			"done",
			"done",
			"skipped",
			"stopped",
			"upcoming",
		]);
		expect(
			container.querySelector('[role="img"]')?.getAttribute("aria-label"),
		).toBe("Stopped at Review");
		expect(
			container
				.querySelector('[data-factory-segment="verify"]')
				?.getAttribute("title"),
		).toBe("Verify: Skipped for this card");
		expect(
			container.querySelector('[data-factory-segment="review"]')?.className,
		).toContain("bg-destructive");
	});
});

describe("one vocabulary", () => {
	const task = (overrides: Partial<AgendaTaskRecord>): AgendaTaskRecord =>
		({
			taskId: "card",
			title: "Card",
			instructions: "Build it.",
			type: "todo",
			scope: "workspace",
			workspaceRoot: "/repo",
			status: "failed",
			resourcePaths: [],
			priority: 2,
			availableAt: "2026-01-01T00:00:00Z",
			expiresAt: "2027-01-01T00:00:00Z",
			automationEligible: false,
			revision: 3,
			approvedRevision: 3,
			createdBy: { kind: "user" },
			updatedBy: { kind: "user" },
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			factory: {
				execution: "local",
				approval: "required",
				maxRepairRounds: 2,
				checks: [],
				publishPullRequest: false,
			},
			...overrides,
		}) as AgendaTaskRecord;
	const attention = (
		outcome?: Partial<NonNullable<FactoryAttention["outcome"]>>,
	): FactoryAttention => ({
		taskId: "card",
		revision: 3,
		questions: [],
		needsAttention: true,
		...(outcome
			? {
					outcome: {
						phase: "blocked",
						repairRound: 0,
						activeRoles: [],
						activeSessions: [],
						followupPaused: false,
						...outcome,
					} as FactoryAttention["outcome"],
				}
			: {}),
	});

	it("calls a card stopped on the line exactly when its label says so", () => {
		const cases: [AgendaTaskRecord, FactoryAttention | undefined][] = [
			[task({}), attention()],
			[task({ status: "completed" }), attention({ phase: "blocked" })],
			[task({ status: "completed" }), attention({ phase: "ready" })],
			[task({ status: "in_progress" }), attention({ phase: "verifying" })],
			[
				task({ status: "completed" }),
				attention({
					phase: "blocked",
					audit: { finding: "Off", selectedAt: "x" },
				}),
			],
		];
		for (const [card, item] of cases) {
			const activity = factoryActivity(card, item);
			expect(activity.station.stopped).toBe(
				activity.label === FACTORY_DECISION.failure ||
					activity.label === FACTORY_DECISION.blocker,
			);
		}
		expect(factoryActivity(task({}), attention()).action).toBe(
			FACTORY_LINE.tryAgain,
		);
	});

	it("uses the review's wording", () => {
		expect(FACTORY_DECISION.failure).toBe("Stopped");
		expect(FACTORY_MESSAGES.paused(1)).toBe(
			"Paused: nothing new starts. 1 card is finishing.",
		);
		expect(FACTORY_MESSAGES.paused(0)).toBe("Paused: nothing new starts.");
		expect(Object.values(FACTORY_LINE.stations)).not.toContain("Checks");
	});
});
