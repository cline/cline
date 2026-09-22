import type { PreparedCloudHandoff } from "@cline/core/cloud";
import { describe, expect, it, vi } from "vitest";
import {
	CLOUD_HANDOFF_LABEL,
	cloudHandoffConfirmation,
	confirmCloudHandoff,
} from "./cloud-handoff";

const prepared: PreparedCloudHandoff = {
	sourceSessionId: "local-session",
	scopeKey: "personal-scope",
	config: { autoApproveTools: false },
	fingerprint: {
		repoUrl: "https://github.com/example/project",
		branch: "feature/local-work",
		headSha: "1234567890abcdef",
		modelId: "cloud-model",
	},
};

function fixture() {
	const runtime = {
		hasHandoffSource: vi.fn(() => true),
		prepareHandoff: vi.fn(async () => prepared),
		handoff: vi.fn(async (_prepared: PreparedCloudHandoff) => {}),
	};
	return {
		runtime,
		isCurrent: vi.fn(() => true),
		confirm: vi.fn(async (): Promise<boolean | undefined> => true),
	};
}

describe("cloud conversation handoff", () => {
	it("confirms the prepared repository, branch, commit and model without another picker", async () => {
		const input = fixture();
		await confirmCloudHandoff(input);
		expect(input.confirm).toHaveBeenCalledWith(
			`${CLOUD_HANDOFF_LABEL}?`,
			"https://github.com/example/project\nBranch: feature/local-work · 12345678\nModel: cloud-model",
		);
		expect(input.runtime.prepareHandoff).toHaveBeenCalledOnce();
		expect(input.runtime.handoff).toHaveBeenCalledExactlyOnceWith(prepared);
		expect(input.runtime.handoff.mock.invocationCallOrder[0]).toBeGreaterThan(
			input.confirm.mock.invocationCallOrder[0],
		);
	});
	it("shows model fallback explicitly before the decision", () => {
		expect(
			cloudHandoffConfirmation({
				...prepared,
				modelFallback: { from: "local-model", to: "cloud-model" },
			}),
		).toContain("Model: local-model → cloud-model (cloud fallback)");
	});
	it.each([
		false,
		undefined,
	])("does not hand off when the user cancels (%s)", async (decision) => {
		const input = fixture();
		input.confirm.mockResolvedValue(decision);
		await confirmCloudHandoff(input);
		expect(input.runtime.handoff).not.toHaveBeenCalled();
	});
	it("cannot start without an available conversation", async () => {
		const input = fixture();
		input.runtime.hasHandoffSource.mockReturnValue(false);
		await expect(confirmCloudHandoff(input)).rejects.toThrow(
			"conversation or cloud account changed",
		);
		expect(input.runtime.prepareHandoff).not.toHaveBeenCalled();
	});
	it("surfaces preparation errors without asking the user to confirm or changing tasks", async () => {
		const input = fixture();
		input.runtime.prepareHandoff.mockRejectedValue(
			new Error("The repository has no remote"),
		);
		await expect(confirmCloudHandoff(input)).rejects.toThrow(
			"repository has no remote",
		);
		expect(input.confirm).not.toHaveBeenCalled();
		expect(input.runtime.handoff).not.toHaveBeenCalled();
	});
	it("rejects stale preparation after an account switch", async () => {
		const input = fixture();
		input.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);
		await expect(confirmCloudHandoff(input)).rejects.toThrow(
			"conversation or cloud account changed",
		);
		expect(input.confirm).not.toHaveBeenCalled();
	});
	it("rechecks source and admission after confirmation", async () => {
		const input = fixture();
		input.confirm.mockImplementation(async () => {
			input.isCurrent.mockReturnValue(false);
			return true;
		});
		await expect(confirmCloudHandoff(input)).rejects.toThrow(
			"conversation or cloud account changed",
		);
		expect(input.runtime.handoff).not.toHaveBeenCalled();
	});
	it("surfaces execution failures for the inline error view", async () => {
		const input = fixture();
		input.runtime.handoff.mockRejectedValue(new Error("Cloud transfer failed"));
		await expect(confirmCloudHandoff(input)).rejects.toThrow(
			"Cloud transfer failed",
		);
	});
});
