import { describe, expect, it } from "vitest";
import {
	createBedrockTransport,
	validateBedrockConnection,
} from "./bedrock-transport";

describe("Bedrock transport", () => {
	it("rejects invalid regions and non-HTTPS endpoints", () => {
		expect(() =>
			validateBedrockConnection({ region: "not a region" }),
		).toThrow("BEDROCK_REGION");
		expect(() =>
			validateBedrockConnection({
				region: "us-east-1",
				endpoint: "http://localhost:8080",
			}),
		).toThrow("BEDROCK_ENDPOINT");
		expect(() =>
			validateBedrockConnection({
				region: "us-east-1",
				controlPlaneEndpoint: "http://bedrock.us-east-1.amazonaws.com",
			}),
		).toThrow("BEDROCK_CONTROL_PLANE_ENDPOINT");
	});

	it("requires a workspace for relative CA paths", async () => {
		await expect(
			createBedrockTransport({
				region: "us-east-1",
				caBundlePath: "company-ca.pem",
			}),
		).rejects.toThrow("relative CA bundle path requires an open workspace");
	});

	it("builds both AWS SDK and streaming transports from one CA bundle", async () => {
		const transport = await createBedrockTransport(
			{
				region: "us-east-1",
				caBundlePath: "src/test-fixtures/test-ca.pem",
			},
			process.cwd(),
		);
		try {
			expect(transport.ca).toContain("BEGIN CERTIFICATE");
			expect(transport.requestHandler).toBeDefined();
			expect(transport.fetch).not.toBe(globalThis.fetch);
		} finally {
			await transport.dispose();
		}
	});
});
