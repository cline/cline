import { describe, expect, it, vi } from "vitest";
import type { HandoffGitPreview } from "../../sidecar/cloud-handoff-git";
import { prepareHandoffWithGit } from "./cloud-handoff-preparation";

const ready = {
	fingerprint: {
		repoUrl: "https://github.com/cline/todo-app",
		branch: "main",
		headSha: "abc",
		modelId: "model",
	},
	repoUrl: "https://github.com/cline/todo-app",
	branch: "main",
	modelId: "model",
};
const plan: HandoffGitPreview = {
	id: "approved-plan",
	repoUrl: ready.repoUrl,
	remote: "origin",
	branch: "cline/handoff-qa",
	sourceBranch: "main",
	files: [{ path: "file.txt", status: " M" }],
	commits: [],
};

describe("prepareHandoffWithGit", () => {
	it("keeps the ready path unchanged", async () => {
		const inspect = vi.fn().mockResolvedValue(ready),
			confirm = vi.fn(),
			apply = vi.fn();
		expect(await prepareHandoffWithGit({ inspect, confirm, apply })).toBe(
			ready,
		);
		expect(confirm).not.toHaveBeenCalled();
		expect(apply).not.toHaveBeenCalled();
	});
	it("cancellation publishes nothing", async () => {
		const inspect = vi.fn().mockResolvedValue({ gitPreparation: plan }),
			confirm = vi.fn().mockResolvedValue(false),
			apply = vi.fn();
		expect(await prepareHandoffWithGit({ inspect, confirm, apply })).toBeNull();
		expect(inspect).toHaveBeenCalledOnce();
		expect(apply).not.toHaveBeenCalled();
	});
	it("waits for explicit approval, applies only its token, and verifies again", async () => {
		let decide: (value: boolean) => void = () => {};
		const inspect = vi
			.fn()
			.mockResolvedValueOnce({ gitPreparation: plan })
			.mockResolvedValueOnce(ready);
		const confirm = vi.fn(
				() =>
					new Promise<boolean>((resolve) => {
						decide = resolve;
					}),
			),
			apply = vi.fn();
		const result = prepareHandoffWithGit({ inspect, confirm, apply });
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(plan));
		expect(apply).not.toHaveBeenCalled();
		decide(true);
		expect(await result).toBe(ready);
		expect(apply).toHaveBeenCalledExactlyOnceWith(plan.id);
		expect(inspect).toHaveBeenCalledTimes(2);
	});
	it("does not retry a failed push or a still-blocked verification", async () => {
		const inspect = vi.fn().mockResolvedValue({ gitPreparation: plan });
		const confirm = vi.fn().mockResolvedValue(true);
		const apply = vi.fn().mockRejectedValueOnce(new Error("push failed"));
		await expect(
			prepareHandoffWithGit({ inspect, confirm, apply }),
		).rejects.toThrow("push failed");
		expect(inspect).toHaveBeenCalledOnce();
		apply.mockResolvedValue(undefined);
		await expect(
			prepareHandoffWithGit({ inspect, confirm, apply }),
		).rejects.toThrow("still needs preparation");
		expect(apply).toHaveBeenCalledTimes(2);
	});
});
