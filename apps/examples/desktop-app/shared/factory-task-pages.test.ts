import { expect, it, vi } from "vitest";
import { readFactoryTaskPages } from "./factory-task-pages";

it("fails visibly when an older Hub ignores the pagination cursor", async () => {
	const page = Array.from({ length: 200 }, (_, index) => ({
		taskId: `task-${String(200 - index).padStart(3, "0")}`,
		createdAt: "2026-01-01T00:00:00.000Z",
	}));
	const readPage = vi.fn(async () => page);
	await expect(readFactoryTaskPages(readPage)).rejects.toThrow(
		"Hub did not advance",
	);
	expect(readPage).toHaveBeenCalledTimes(2);
});
