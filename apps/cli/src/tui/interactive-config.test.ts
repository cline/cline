import { describe, expect, it } from "vitest";
import { getMcpDescription } from "./interactive-config";

describe("getMcpDescription", () => {
	it("discloses the default initialize timeout for unconfigured stdio servers", () => {
		expect(
			getMcpDescription({
				name: "local",
				transport: { type: "stdio", command: "node" },
			}),
		).toBe("stdio, local, request timeout 60s, initialize timeout 3s");
	});

	it("shows one configured timeout when it also applies to initialize", () => {
		expect(
			getMcpDescription({
				name: "local",
				transport: { type: "stdio", command: "node" },
				timeoutSeconds: 120,
			}),
		).toBe("stdio, local, timeout 120s");
	});

	it("shows the request default for URL transports", () => {
		expect(
			getMcpDescription({
				name: "remote",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.test",
				},
			}),
		).toBe("streamableHttp, no auth, timeout 60s");
	});

	it("reports malformed programmatic timeouts as unconfigured", () => {
		expect(
			getMcpDescription({
				name: "local",
				transport: { type: "stdio", command: "node" },
				timeoutSeconds: Number.NaN,
			}),
		).toBe("stdio, local, request timeout 60s, initialize timeout 3s");
	});
});
