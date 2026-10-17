import { describe, expect, test } from "bun:test";
import { repoEnv } from "./connectors.fixtures";
import { Refresher } from "./refresher";

describe("the refresher", () => {
	function stub(refreshed: string[], gate?: Promise<void>) {
		return {
			id: "github",
			tier: "T3" as const,
			scopes: [
				{ id: "pr", label: "PR", everyMinutes: 5, onPush: true },
				{ id: "ci", label: "CI", everyMinutes: 15 },
			],
			probe: () => "present" as const,
			refresh: async (scope: string) => {
				refreshed.push(scope);
				await gate;
			},
		};
	}

	test("start and a branch change refresh every chosen scope; a push only the push-sensitive ones; never two at once", async () => {
		const refreshed: string[] = [];
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let env = repoEnv;
		const refresher = new Refresher({
			connectors: () => [stub(refreshed, gate)],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => env,
			startTicking: () => () => undefined,
		});
		const started = refresher.start();
		await refresher.onTurn({ pushed: true });
		expect(refreshed).toEqual(["pr", "ci"]);
		release();
		await started;
		await refresher.onTurn({ pushed: true });
		await refresher.onTurn({ pushed: false });
		expect(refreshed).toEqual(["pr", "ci", "pr"]);
		env = { ...repoEnv, git: { branch: "next", remotes: [] } };
		await refresher.onTurn();
		await refresher.onTurn();
		expect(refreshed).toEqual(["pr", "ci", "pr", "pr", "ci"]);
		refresher.stop();
	});

	test("the tick refreshes each scope on its own cadence, and only scopes the person chose", async () => {
		const refreshed: string[] = [];
		const github = stub(refreshed);
		let now = 0;
		let tick: () => void = () => undefined;
		const refresher = new Refresher({
			connectors: () => [github],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => repoEnv,
			now: () => now,
			startTicking: (run) => {
				tick = run;
				return () => undefined;
			},
		});
		await refresher.start();
		const at = async (minutes: number) => {
			now = minutes * 60_000;
			tick();
			await Bun.sleep(0);
		};
		await at(4);
		await at(5);
		await at(15);
		expect(refreshed).toEqual(["pr", "ci", "pr", "pr", "ci"]);
		const off = new Refresher({
			connectors: () => [stub(refreshed)],
			access: () => ({ role: "mention", scopes: ["pr"], readAllowed: false }),
			env: () => repoEnv,
			startTicking: () => () => undefined,
		});
		await off.start();
		expect(refreshed).toHaveLength(5);
	});

	test("a connector found again after it was removed reads at the next tick, without waiting out its cadence", async () => {
		const refreshed: string[] = [];
		let connector = stub(refreshed);
		let tick: () => void = () => undefined;
		const refresher = new Refresher({
			connectors: () => [connector],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => repoEnv,
			now: () => 0,
			startTicking: (run) => {
				tick = run;
				return () => undefined;
			},
		});
		await refresher.start();
		tick();
		await Bun.sleep(0);
		expect(refreshed).toEqual(["pr", "ci"]);
		connector = stub(refreshed);
		tick();
		await Bun.sleep(0);
		expect(refreshed).toEqual(["pr", "ci", "pr", "ci"]);
	});
});
