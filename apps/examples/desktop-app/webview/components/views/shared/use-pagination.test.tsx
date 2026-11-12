// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { usePagination } from "./use-pagination";

let container: HTMLDivElement;
let root: Root;
let pagination: ReturnType<typeof usePagination>;

function Harness({
	total,
	resetKey = "",
	holdPage = false,
}: {
	total: number;
	resetKey?: string;
	holdPage?: boolean;
}) {
	pagination = usePagination({ total, pageSize: 10, resetKey, holdPage });
	return (
		<output>
			{pagination.page}:{pagination.pageCount}:{pagination.offset}
		</output>
	);
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("clamps a disappearing page and restarts for a new result set", async () => {
	await act(async () => root.render(<Harness total={30} resetKey="first" />));
	await act(async () => pagination.onPageChange(3));
	expect(container.textContent).toBe("3:3:20");

	await act(async () => root.render(<Harness total={15} resetKey="first" />));
	expect(container.textContent).toBe("2:2:10");

	await act(async () => root.render(<Harness total={15} resetKey="second" />));
	expect(container.textContent).toBe("1:2:0");
});

it("retains a requested page while its total is loading", async () => {
	await act(async () => root.render(<Harness total={30} holdPage />));
	await act(async () => pagination.onPageChange(3));
	expect(container.textContent).toBe("3:3:20");

	await act(async () => root.render(<Harness total={0} holdPage />));
	expect(container.textContent).toBe("1:1:0");

	await act(async () => root.render(<Harness total={30} holdPage />));
	expect(container.textContent).toBe("3:3:20");
});
