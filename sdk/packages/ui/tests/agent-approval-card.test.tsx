// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentApprovalCard } from "../components/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AgentApprovalCard", () => {
	it("submits either controlled decision", async () => {
		const onApprove = vi.fn();
		const onReject = vi.fn();
		await act(async () =>
			root.render(
				<AgentApprovalCard
					detail="{}"
					onApprove={onApprove}
					onReject={onReject}
					title="Run command"
				/>,
			),
		);

		const [approve, reject] = container.querySelectorAll("button");
		await act(async () => approve?.click());
		await act(async () => reject?.click());

		expect(onApprove).toHaveBeenCalledOnce();
		expect(onReject).toHaveBeenCalledOnce();
		expect(
			container.querySelector(".cline-ui-agent-approval-card__title")?.tagName,
		).toBe("DIV");
	});

	it("renders non-null detail values", async () => {
		await act(async () =>
			root.render(
				<AgentApprovalCard
					detail=""
					onApprove={vi.fn()}
					onReject={vi.fn()}
					title="Run command"
				/>,
			),
		);
		expect(container.querySelector("pre")).not.toBeNull();

		await act(async () =>
			root.render(
				<AgentApprovalCard
					detail={0}
					onApprove={vi.fn()}
					onReject={vi.fn()}
					title="Run command"
				/>,
			),
		);
		expect(container.querySelector("pre")?.textContent).toBe("0");
	});

	it("disables both decisions while responding", async () => {
		await act(async () =>
			root.render(
				<AgentApprovalCard
					onApprove={vi.fn()}
					onReject={vi.fn()}
					responding="reject"
					title="Run command"
				/>,
			),
		);

		const [approve, reject] = container.querySelectorAll("button");
		expect(approve?.disabled).toBe(true);
		expect(reject?.disabled).toBe(true);
		expect(reject?.textContent).toContain("Rejecting...");
		expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe(
			"true",
		);
	});
});
