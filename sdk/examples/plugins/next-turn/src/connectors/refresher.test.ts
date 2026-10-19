import { describe, expect, test } from "bun:test";
import type { SourceEnv } from "../context/source";
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
		expect(refreshed).toEqual(["pr", "ci", "pr"]);
		await refresher.onTurn({ pushed: true });
		await refresher.onTurn({ pushed: false });
		expect(refreshed).toEqual(["pr", "ci", "pr", "pr"]);
		env = { ...repoEnv, git: { branch: "next", remotes: [] } };
		await refresher.onTurn();
		await refresher.onTurn();
		expect(refreshed).toEqual(["pr", "ci", "pr", "pr", "pr", "ci"]);
		refresher.stop();
	});

	function onBranch(branch: string): SourceEnv {
		return { ...repoEnv, git: { branch, remotes: [] } };
	}

	function held() {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		return { gate, release };
	}

	function branchStub(reads: string[], gate: () => Promise<void> | undefined) {
		return {
			...stub([]),
			refresh: async (scope: string, env: SourceEnv) => {
				reads.push(`${scope}@${env.git?.branch}`);
				await gate();
			},
		};
	}

	test("a branch change during a read of the old branch reads the new branch once that read ends", async () => {
		const reads: string[] = [];
		let gate: Promise<void> | undefined;
		let env = onBranch("main");
		let now = 0;
		let tick: () => void = () => undefined;
		const github = branchStub(reads, () => gate);
		const refresher = new Refresher({
			connectors: () => [github],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => env,
			now: () => now,
			startTicking: (run) => {
				tick = run;
				return () => undefined;
			},
		});
		await refresher.start();
		const read = held();
		gate = read.gate;
		now = 5 * 60_000;
		tick();
		env = onBranch("feature");
		const turn = refresher.onTurn();
		await Bun.sleep(0);
		expect(reads).toEqual(["pr@main", "ci@main", "pr@main", "ci@feature"]);
		read.release();
		await turn;
		await Bun.sleep(0);
		expect(reads).toEqual([
			"pr@main",
			"ci@main",
			"pr@main",
			"ci@feature",
			"pr@feature",
		]);
	});

	test("requests during one read merge into one read after it", async () => {
		const reads: string[] = [];
		const read = held();
		let env = onBranch("main");
		const github = branchStub(reads, () => read.gate);
		const refresher = new Refresher({
			connectors: () => [github],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => env,
			startTicking: () => () => undefined,
		});
		const started = refresher.start();
		await refresher.onTurn({ pushed: true });
		await refresher.onTurn({ pushed: true });
		env = onBranch("feature");
		await refresher.onTurn();
		expect(reads).toEqual(["pr@main", "ci@main"]);
		read.release();
		await started;
		expect(reads).toEqual(["pr@main", "ci@main", "pr@feature", "ci@feature"]);
	});

	test("a request missed during a read is dropped when the refresher stops, turns inactive, or the scope is unchosen", async () => {
		const missed = async (
			change: (
				refresher: Refresher,
				state: { active: boolean; scopes: string[] },
			) => void,
		) => {
			const reads: string[] = [];
			const read = held();
			const state = { active: true, scopes: ["pr", "ci"] };
			const github = branchStub(reads, () => read.gate);
			const refresher = new Refresher({
				connectors: () => [github],
				access: () => ({
					role: "read",
					scopes: state.scopes,
					readAllowed: true,
				}),
				env: () => onBranch("main"),
				active: () => state.active,
				startTicking: () => () => undefined,
			});
			const started = refresher.start();
			await refresher.onTurn({ pushed: true });
			change(refresher, state);
			read.release();
			await started;
			return reads;
		};
		const once = ["pr@main", "ci@main"];
		expect(await missed((refresher) => refresher.stop())).toEqual(once);
		expect(
			await missed((_, state) => {
				state.active = false;
			}),
		).toEqual(once);
		expect(
			await missed((_, state) => {
				state.scopes = ["ci"];
			}),
		).toEqual(once);
		expect(await missed(() => undefined)).toEqual([...once, "pr@main"]);
	});

	test("a scope whose revision changed reads at the next tick; an unchanged one waits out its cadence", async () => {
		const refreshed: string[] = [];
		let revision = "a";
		const pinned = {
			...stub(refreshed),
			get scopes() {
				return [{ id: "mine", label: "Mine", everyMinutes: 15, revision }];
			},
		};
		let now = 0;
		let tick: () => void = () => undefined;
		const refresher = new Refresher({
			connectors: () => [pinned],
			access: () => ({ role: "read", scopes: ["mine"], readAllowed: true }),
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
		await at(1);
		expect(refreshed).toEqual(["mine"]);
		revision = "b";
		await at(2);
		await at(3);
		expect(refreshed).toEqual(["mine", "mine"]);
		await at(16);
		expect(refreshed).toEqual(["mine", "mine"]);
		await at(17);
		expect(refreshed).toEqual(["mine", "mine", "mine"]);
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
