import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import type { AtifTrajectory } from "./atif-types";
import schema from "./atif-v1.7.schema.json";
import { validateAtifTrajectory } from "./atif-validate";

function minimal(): AtifTrajectory {
	return {
		schema_version: "ATIF-v1.7",
		session_id: "sess_1",
		trajectory_id: "sess_1",
		agent: { name: "cline", version: "1.0.0", model_name: "fake-model" },
		steps: [
			{
				step_id: 1,
				timestamp: "2026-01-01T00:00:00.000Z",
				source: "user",
				message: "List the files",
			},
			{
				step_id: 2,
				timestamp: "2026-01-01T00:00:01.000Z",
				source: "agent",
				model_name: "fake-model",
				message: "Running ls.",
				reasoning_content: "I should run ls.",
				tool_calls: [
					{
						tool_call_id: "call_1",
						function_name: "run_commands",
						arguments: { commands: ["ls"] },
					},
				],
				observation: {
					results: [{ source_call_id: "call_1", content: "a.txt" }],
				},
				metrics: { prompt_tokens: 100, completion_tokens: 20, cost_usd: 0.001 },
				llm_call_count: 1,
			},
		],
		final_metrics: { total_prompt_tokens: 100, total_steps: 2 },
	};
}

function mutate(change: (trajectory: AtifTrajectory) => void): AtifTrajectory {
	const trajectory = minimal();
	change(trajectory);
	return trajectory;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const ajvValidate = ajv.compile(schema);

describe("validateAtifTrajectory", () => {
	it("accepts a valid trajectory", () => {
		expect(validateAtifTrajectory(minimal())).toEqual({ ok: true, errors: [] });
		expect(ajvValidate(minimal())).toBe(true);
	});

	const schemaCases: Array<[string, unknown, RegExp]> = [
		["a non-object", "nope", /expected object/],
		[
			"a missing agent",
			mutate((t) => {
				delete (t as Partial<AtifTrajectory>).agent;
			}),
			/missing required field "agent"/,
		],
		[
			"an unknown root field",
			{ ...minimal(), surprise: true },
			/unknown field "surprise"/,
		],
		[
			"an unknown schema version",
			{ ...minimal(), schema_version: "ATIF-v2.0" },
			/schema_version: must be one of/,
		],
		[
			"empty steps",
			mutate((t) => {
				t.steps = [];
			}),
			/steps: must have at least 1 item/,
		],
		[
			"a bad step source",
			mutate((t) => {
				(t.steps[0] as { source: string }).source = "tool";
			}),
			/steps\[0\]\.source: must be one of/,
		],
		[
			"a step_id below 1",
			mutate((t) => {
				(t.steps[0] as { step_id: number }).step_id = 0;
			}),
			/steps\[0\]\.step_id: must be >= 1/,
		],
		[
			"a fractional token count",
			mutate((t) => {
				const metrics = t.steps[1]?.metrics;
				if (metrics) metrics.prompt_tokens = 1.5;
			}),
			/prompt_tokens: number does not match any allowed type/,
		],
		[
			"non-object tool arguments",
			mutate((t) => {
				const call = t.steps[1]?.tool_calls?.[0];
				if (call) (call as { arguments: unknown }).arguments = ["ls"];
			}),
			/arguments: expected object, got array/,
		],
		[
			"an unknown observation result field",
			mutate((t) => {
				const result = t.steps[1]?.observation?.results[0];
				if (result) Object.assign(result, { output: "x" });
			}),
			/unknown field "output"/,
		],
		[
			"an image with a bad media type",
			mutate((t) => {
				const step = t.steps[0];
				if (step) {
					step.message = [
						{
							type: "image",
							source: {
								media_type: "image/bmp" as "image/png",
								path: "a.bmp",
							},
						},
					];
				}
			}),
			/media_type: must be one of/,
		],
	];

	it.each(schemaCases)("rejects %s, as ajv does", (_label, value, error) => {
		const result = validateAtifTrajectory(value);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toMatch(error);
		expect(ajvValidate(value)).toBe(false);
	});

	const ruleCases: Array<[string, AtifTrajectory, RegExp]> = [
		[
			"non-sequential step ids",
			mutate((t) => {
				(t.steps[1] as { step_id: number }).step_id = 3;
			}),
			/steps\[1\]\.step_id: expected 2/,
		],
		[
			"a timestamp that is not ISO 8601",
			mutate((t) => {
				(t.steps[0] as { timestamp: string }).timestamp = "yesterday";
			}),
			/steps\[0\]\.timestamp: not an ISO 8601 timestamp/,
		],
		[
			"an impossible date",
			mutate((t) => {
				(t.steps[0] as { timestamp: string }).timestamp =
					"2026-02-30T00:00:00Z";
			}),
			/not an ISO 8601 timestamp/,
		],
		[
			"agent-only fields on a user step",
			mutate((t) => {
				Object.assign(t.steps[0] as object, {
					model_name: "fake-model",
					metrics: { prompt_tokens: 1 },
				});
			}),
			/steps\[0\]\.model_name: only allowed when source is "agent"[\s\S]*steps\[0\]\.metrics/,
		],
		[
			"metrics on an llm_call_count 0 agent step",
			mutate((t) => {
				(t.steps[1] as { llm_call_count: number }).llm_call_count = 0;
			}),
			/reasoning_content: must be absent when llm_call_count is 0/,
		],
		[
			"a source_call_id from another step",
			mutate((t) => {
				const result = t.steps[1]?.observation?.results[0];
				if (result) result.source_call_id = "call_other";
			}),
			/source_call_id: "call_other" is not a tool_call_id of step 2/,
		],
		[
			"a subagent reference without an id or path",
			mutate((t) => {
				const result = t.steps[1]?.observation?.results[0];
				if (result) result.subagent_trajectory_ref = [{ session_id: "x" }];
			}),
			/needs trajectory_id or trajectory_path/,
		],
		[
			"a text part without text",
			mutate((t) => {
				const step = t.steps[0];
				if (step)
					step.message = [{ type: "text" } as { type: "text"; text: string }];
			}),
			/"text" is required when type is "text"/,
		],
		[
			"an embedded subagent without a trajectory_id",
			mutate((t) => {
				const sub = minimal();
				delete sub.trajectory_id;
				t.subagent_trajectories = [sub];
			}),
			/subagent_trajectories\[0\]\.trajectory_id: required/,
		],
		[
			"duplicate embedded trajectory ids",
			mutate((t) => {
				t.subagent_trajectories = [minimal(), minimal()];
			}),
			/subagent_trajectories\[1\]\.trajectory_id: "sess_1" is not unique/,
		],
		[
			"errors inside an embedded subagent",
			mutate((t) => {
				const sub = minimal();
				(sub.steps[1] as { step_id: number }).step_id = 7;
				t.subagent_trajectories = [sub];
			}),
			/subagent_trajectories\[0\]\.steps\[1\]\.step_id: expected 2/,
		],
		[
			"a reference to a trajectory that is not embedded",
			mutate((t) => {
				const result = t.steps[1]?.observation?.results[0];
				if (result)
					result.subagent_trajectory_ref = [{ trajectory_id: "sub_x" }];
			}),
			/trajectory_id "sub_x" does not match an embedded subagent trajectory/,
		],
	];

	it.each(
		ruleCases,
	)("rejects %s, which the schema alone allows", (_label, value, error) => {
		expect(ajvValidate(value)).toBe(true);
		const result = validateAtifTrajectory(value);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toMatch(error);
	});

	it("accepts references to embedded trajectories and external files", () => {
		const trajectory = mutate((t) => {
			const sub = minimal();
			sub.trajectory_id = "sub_1";
			t.subagent_trajectories = [sub];
			const result = t.steps[1]?.observation?.results[0];
			if (result) {
				result.subagent_trajectory_ref = [
					{ trajectory_id: "sub_1", session_id: "sess_1" },
					{ trajectory_id: "elsewhere", trajectory_path: "./other.json" },
				];
			}
		});
		expect(validateAtifTrajectory(trajectory)).toEqual({
			ok: true,
			errors: [],
		});
	});

	it("can leave embedded reference resolution to the reader", () => {
		const trajectory = mutate((t) => {
			const result = t.steps[1]?.observation?.results[0];
			if (result) result.subagent_trajectory_ref = [{ trajectory_id: "sub_x" }];
		});
		expect(
			validateAtifTrajectory(trajectory, { requireResolvableRefs: false }).ok,
		).toBe(true);
	});

	it("accepts the timestamp forms Python's fromisoformat accepts", () => {
		for (const timestamp of [
			"2026-01-01",
			"2026-01-01T10:00",
			"2026-01-01T10:00:00+02:00",
			"2026-01-01 10:00:00.123456",
			"2024-02-29T00:00:00Z",
		]) {
			const trajectory = mutate((t) => {
				(t.steps[0] as { timestamp: string }).timestamp = timestamp;
			});
			expect(validateAtifTrajectory(trajectory).errors).toEqual([]);
		}
	});
});
