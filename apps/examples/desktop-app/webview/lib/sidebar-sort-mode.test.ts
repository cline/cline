import { describe, expect, it, vi } from "vitest";
import {
	readSidebarSortMode,
	SIDEBAR_SORT_MODE_STORAGE_KEY,
	writeSidebarSortMode,
} from "./sidebar-sort-mode";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
	};
}

describe("sidebar sort mode persistence", () => {
	it("defaults to chronological order when nothing is stored", () => {
		expect(readSidebarSortMode(memoryStorage())).toBe("time");
	});

	it("round-trips the project grouping preference", () => {
		const storage = memoryStorage();
		writeSidebarSortMode("project", storage);
		expect(storage.setItem).toHaveBeenCalledWith(
			SIDEBAR_SORT_MODE_STORAGE_KEY,
			"project",
		);
		expect(readSidebarSortMode(storage)).toBe("project");
	});

	it("ignores unknown stored values", () => {
		expect(
			readSidebarSortMode(
				memoryStorage({ [SIDEBAR_SORT_MODE_STORAGE_KEY]: "alphabetical" }),
			),
		).toBe("time");
	});

	it("survives storage that throws", () => {
		const throwing = {
			getItem: vi.fn(() => {
				throw new Error("denied");
			}),
			setItem: vi.fn(() => {
				throw new Error("denied");
			}),
		};
		expect(readSidebarSortMode(throwing)).toBe("time");
		expect(() => writeSidebarSortMode("project", throwing)).not.toThrow();
	});
});
