import type { AgendaTaskListInput } from "@cline/shared";
import { z } from "zod";

const PAGE_SIZE = 200;
const cursorSchema = z.object({
	createdAt: z.string().datetime(),
	taskId: z.string().min(1),
});

/** Read complete Factory history in bounded pages, without expanding split links per page. */
export async function readFactoryTaskPages<T>(
	readPage: (input: AgendaTaskListInput) => Promise<T[]>,
): Promise<T[]> {
	const tasks: T[] = [];
	let before: AgendaTaskListInput["factoryBefore"];
	for (;;) {
		const page = await readPage({
			factoryOnly: true,
			factoryLinks: false,
			limit: PAGE_SIZE,
			...(before ? { factoryBefore: before } : {}),
		});
		tasks.push(...page);
		if (page.length < PAGE_SIZE) return tasks;
		const next = cursorSchema.parse(page.at(-1));
		if (
			before &&
			(next.createdAt > before.createdAt ||
				(next.createdAt === before.createdAt && next.taskId >= before.taskId))
		)
			throw new Error(
				"The Hub did not advance Factory history. Restart or update the Hub and try again.",
			);
		before = next;
	}
}
