import { describe, expect, it } from "vitest";
import { LoopDetectionTracker } from "./loop-detection";

const call = (name: string, input: unknown) => ({ name, input });

describe("LoopDetectionTracker", () => {
	it("hard-escalates on strictly consecutive identical calls", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 3,
			hardThreshold: 5,
		});
		const c = call("run_commands", { commands: ["ls"] });
		const verdicts = Array.from({ length: 5 }, () => tracker.inspect(c).kind);
		expect(verdicts).toEqual(["ok", "ok", "soft", "ok", "hard"]);
	});

	it("catches an interleaved two-call loop the consecutive counter misses", () => {
		const tracker = new LoopDetectionTracker();
		const a = call("run_commands", { commands: ["cat > f << EOF"] });
		const b = call("run_commands", { commands: ["rm -f f"] });
		// Alternating a/b: never consecutive, but `a` recurs within the window.
		const kinds: string[] = [];
		for (let i = 0; i < 12; i++) {
			kinds.push(tracker.inspect(i % 2 === 0 ? a : b).kind);
		}
		// Once the 12-call window is full it holds only 2 distinct actions, which
		// trips the hard stop; the consecutive counter never fired.
		expect(kinds).toContain("hard");
		expect(kinds.slice(0, 11)).not.toContain("hard");
	});

	it("soft-warns on a low-diversity three-action cycle without stopping", () => {
		const tracker = new LoopDetectionTracker();
		const cs = [
			call("run_commands", { commands: ["make"] }),
			call("run_commands", { commands: ["./run"] }),
			call("read_files", { files: ["/log"] }),
		];
		const kinds: string[] = [];
		for (let i = 0; i < 12; i++) kinds.push(tracker.inspect(cs[i % 3]).kind);
		// 3 distinct actions over a full window: a nudge, never a hard stop.
		expect(kinds).toContain("soft");
		expect(kinds).not.toContain("hard");
	});

	it("does not flag a productive edit/test cycle with differing arguments", () => {
		const tracker = new LoopDetectionTracker();
		let sawFlag = false;
		for (let i = 0; i < 20; i++) {
			// Each edit writes different content; the test command is identical but
			// only every other call, so neither the consecutive nor the windowed
			// counter for a single signature crosses its threshold.
			const edit = tracker.inspect(
				call("editor", { path: "/app/x.py", new_text: `line ${i}` }),
			);
			const test = tracker.inspect(
				call("run_commands", { commands: ["pytest -q"] }),
			);
			if (edit.kind !== "ok" || test.kind === "hard") sawFlag = true;
		}
		expect(sawFlag).toBe(false);
	});

	it("resets after reset()", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const c = call("read_files", { files: ["/a"] });
		tracker.inspect(c);
		tracker.inspect(c);
		tracker.reset();
		expect(tracker.inspect(c).kind).toBe("ok");
	});
});
