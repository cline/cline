import assert from "node:assert/strict";
import { UxVerificationReportSchema } from "@cline/shared";
import { test } from "vitest";
import { createUxVerificationReportTool } from "./ux-verification";

const context = { agentId: "test", sessionId: "local", iteration: 1 };

test("returns captions and observed outcomes with durable screenshot references", async () => {
	const tool = createUxVerificationReportTool();
	const output = await tool.execute(
		{
			title: "Counter checks",
			subtitle: "Desktop and mobile",
			checks: [
				{
					title: "Increment",
					subtitle: "The counter shows 1",
					status: "passed",
					action: "Clicked increment",
					screenshot: { artifactId: "counter", mediaType: "image/png" },
				},
				{
					title: "Label",
					subtitle: "The button label is clipped",
					status: "failed",
					screenshot: { artifactId: "counter", mediaType: "image/png" },
				},
				{
					title: "Mobile",
					subtitle: "Screenshot publication failed",
					status: "blocked",
				},
			],
		},
		context,
	);
	assert.equal(output.kind, "ux_verification");
	assert.equal(output.version, 1);
	assert.equal(output.title, "Counter checks");
	assert.equal(output.subtitle, "Desktop and mobile");
	assert.deepEqual(
		output.checks.map(({ id, subtitle, status }) => ({ id, subtitle, status })),
		[
			{ id: "1", subtitle: "The counter shows 1", status: "passed" },
			{ id: "2", subtitle: "The button label is clipped", status: "failed" },
			{ id: "3", subtitle: "Screenshot publication failed", status: "blocked" },
		],
	);
	assert.equal(output.checks[0].action, "Clicked increment");
	assert.deepEqual(output.checks[0].screenshot, {
		id: "counter",
		modality: "image",
		mediaType: "image/png",
		source: { type: "artifact", artifactId: "counter" },
	});
	assert.equal(output.checks[2].screenshot, undefined);
	assert.deepEqual(UxVerificationReportSchema.parse(output), output);
});

test("rejects missing evidence and non-artifact screenshot inputs", async () => {
	const tool = createUxVerificationReportTool();
	for (const screenshot of [
		undefined,
		{ artifactId: "counter", mediaType: "image/svg+xml" },
		{
			mediaType: "image/png",
			source: { type: "url", url: "https://example.com/image.png" },
		},
		{ mediaType: "image/png", source: { type: "base64", data: "AAAA" } },
	]) {
		await assert.rejects(async () =>
			tool.execute(
				{
					title: "Checks",
					subtitle: "Visual verification",
					checks: [
						{
							title: "Counter",
							subtitle: "Observed result",
							status: "passed",
							screenshot,
						},
					],
				},
				context,
			),
		);
	}
});
