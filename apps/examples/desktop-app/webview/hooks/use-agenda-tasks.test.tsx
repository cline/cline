// @vitest-environment jsdom
import type { AgendaTaskRecord } from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAgendaTasks } from "./use-agenda-tasks";

const mocks = vi.hoisted(() => ({ listAgendaTasks: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		...mocks,
		subscribe: () => () => {},
		subscribeTransportState: () => () => {},
	},
}));

it("keeps older live Factory cards visible beyond the first page", async () => {
	const cards: AgendaTaskRecord[] = Array.from({ length: 201 }, (_, index) => ({
		taskId: `factory-${String(201 - index).padStart(3, "0")}`,
		title: index === 200 ? "Older live work" : `Card ${index}`,
		instructions: "Complete the requested change.",
		type: "todo",
		scope: "global",
		status: "pending_approval",
		resourcePaths: [],
		priority: 3,
		availableAt: "2026-01-01T00:00:00.000Z",
		expiresAt: "2099-01-01T00:00:00.000Z",
		automationEligible: false,
		revision: 1,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		factory: factoryTaskConfigSchema.parse({}),
	}));
	mocks.listAgendaTasks
		.mockResolvedValueOnce(cards.slice(0, 200))
		.mockResolvedValueOnce(cards.slice(200));
	function Board() {
		const { tasks } = useAgendaTasks({
			allWorkspaces: true,
			includeArchived: true,
			factoryOnly: true,
			allFactoryPages: true,
		});
		return (
			<div>
				{tasks.map((task) => (
					<p key={task.taskId}>{task.title}</p>
				))}
			</div>
		);
	}
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const container = document.createElement("div");
	const root = createRoot(container);
	try {
		await act(async () => root.render(<Board />));
		expect(container.querySelectorAll("p")).toHaveLength(201);
		expect(container.textContent).toContain("Older live work");
		expect(mocks.listAgendaTasks).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				factoryOnly: true,
				factoryBefore: {
					createdAt: cards[199].createdAt,
					taskId: cards[199].taskId,
				},
			}),
		);
		expect(mocks.listAgendaTasks.mock.calls[0][0]).not.toHaveProperty(
			"allFactoryPages",
		);
	} finally {
		await act(async () => root.unmount());
	}
});
