import type {
	LanguageModelV3CallOptions,
	LanguageModelV3Message,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { convertPromptToR1, r1FormatMiddleware } from "./r1-format";

describe("convertPromptToR1", () => {
	it("demotes the system message to the first user turn", () => {
		const prompt: LanguageModelV3Message[] = [
			{ role: "system", content: "you are helpful" },
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		];

		const out = convertPromptToR1(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toEqual([
			// system text and the first user turn merge into one user message,
			// newline-joined.
			{ role: "user", content: [{ type: "text", text: "you are helpful\nhi" }] },
		]);
	});

	it("merges consecutive same-role turns and keeps strict alternation", () => {
		const prompt: LanguageModelV3Message[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "u1" }] },
			{ role: "assistant", content: [{ type: "text", text: "a1" }] },
			{ role: "assistant", content: [{ type: "text", text: "a2" }] },
			{ role: "user", content: [{ type: "text", text: "u2" }] },
		];

		const out = convertPromptToR1(prompt);

		expect(out.prompt).toEqual([
			{ role: "user", content: [{ type: "text", text: "sys\nu1" }] },
			{ role: "assistant", content: [{ type: "text", text: "a1\na2" }] },
			{ role: "user", content: [{ type: "text", text: "u2" }] },
		]);
		// Result strictly alternates and carries no system role.
		expect(out.prompt.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
		expect(out.prompt.some((m) => m.role === "system")).toBe(false);
	});

	it("preserves image/file parts while coalescing only adjacent text", () => {
		const prompt: LanguageModelV3Message[] = [
			{ role: "system", content: "sys" },
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "file", data: "https://img/x.png", mediaType: "image/png" },
				],
			},
		];

		const out = convertPromptToR1(prompt);

		expect(out.prompt).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "sys\nlook" },
					{ type: "file", data: "https://img/x.png", mediaType: "image/png" },
				],
			},
		]);
	});

	it("leaves an already-R1-shaped prompt unmutated", () => {
		const prompt: LanguageModelV3Message[] = [
			{ role: "user", content: [{ type: "text", text: "u1" }] },
			{ role: "assistant", content: [{ type: "text", text: "a1" }] },
			{ role: "user", content: [{ type: "text", text: "u2" }] },
		];

		const out = convertPromptToR1(prompt);

		expect(out.mutated).toBe(false);
		expect(out.prompt).toEqual(prompt);
	});

	it("does not mutate the caller's message objects", () => {
		const firstUser: LanguageModelV3Message = {
			role: "user",
			content: [{ type: "text", text: "u1" }],
		};
		const prompt: LanguageModelV3Message[] = [
			firstUser,
			{ role: "user", content: [{ type: "text", text: "u2" }] },
		];

		convertPromptToR1(prompt);

		// The original first-user message must be untouched by the merge.
		expect(firstUser.content).toEqual([{ type: "text", text: "u1" }]);
	});
});

describe("r1FormatMiddleware", () => {
	it("returns the same params reference when no reshape is needed", async () => {
		const params: LanguageModelV3CallOptions = {
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		};

		const out = await r1FormatMiddleware.transformParams?.({
			type: "stream",
			params,
			model: undefined as never,
		});

		expect(out).toBe(params);
	});

	it("returns reshaped params when a system message is present", async () => {
		const params: LanguageModelV3CallOptions = {
			prompt: [
				{ role: "system", content: "sys" },
				{ role: "user", content: [{ type: "text", text: "hi" }] },
			],
		};

		const out = await r1FormatMiddleware.transformParams?.({
			type: "stream",
			params,
			model: undefined as never,
		});

		expect(out?.prompt).toEqual([
			{ role: "user", content: [{ type: "text", text: "sys\nhi" }] },
		]);
	});
});
