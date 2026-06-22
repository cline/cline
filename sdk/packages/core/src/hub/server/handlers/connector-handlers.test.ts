import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __test__ } from "./connector-handlers";

describe("connector hub handlers", () => {
	const previousDataDir = process.env.CLINE_DATA_DIR;
	const tempRoots: string[] = [];

	afterEach(() => {
		process.env.CLINE_DATA_DIR = previousDataDir;
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	function useTempDataDir(): string {
		const root = mkdtempSync(join(tmpdir(), "hub-connectors-"));
		tempRoots.push(root);
		process.env.CLINE_DATA_DIR = root;
		return root;
	}

	it("configures a connector through hub settings without starting it", () => {
		useTempDataDir();

		const response = __test__.configureConnector({
			channel: "telegram",
			values: { "-k": "123456:fake-token" },
			security: { enabled: true, values: { userId: "123456789" } },
		});

		expect(response.active).toEqual([]);
		expect(response.configured).toEqual([
			expect.objectContaining({ id: "telegram", type: "telegram" }),
		]);

		const persisted = JSON.parse(
			readFileSync(__test__.resolveConnectorSettingsPath(), "utf8"),
		) as {
			connectors: {
				telegram: {
					values: Record<string, string>;
					security: { enabled: boolean; values: Record<string, string> };
				};
			};
		};
		expect(persisted.connectors.telegram.values["-k"]).toBe(
			"123456:fake-token",
		);
		expect(persisted.connectors.telegram.security).toEqual({
			enabled: true,
			values: { userId: "123456789" },
		});
	});

	it("validates security fields before persisting connector settings", () => {
		useTempDataDir();

		expect(() =>
			__test__.configureConnector({
				channel: "telegram",
				values: { "-k": "123456:fake-token" },
				security: { enabled: true, values: { userId: "not-a-number" } },
			}),
		).toThrow("Telegram user ID must contain digits only");
		expect(__test__.connectorChannelsPayload().configured).toEqual([]);
	});
});
