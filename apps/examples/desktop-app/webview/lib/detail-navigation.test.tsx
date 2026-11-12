// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type DetailNavigationHost,
	DetailNavigationProvider,
	useDetailNavigation,
} from "./detail-navigation";

type Detail = { id: string };

let container: HTMLDivElement;
let root: Root;
let navigation: ReturnType<typeof useDetailNavigation<Detail>>;

function Harness() {
	navigation = useDetailNavigation<Detail>();
	return <output>{navigation.detail?.id ?? "list"}</output>;
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

it("ignores stale local close, replace, and leave callbacks", async () => {
	await act(async () => root.render(<Harness />));
	const first = { id: "first" };
	const second = { id: "second" };
	await act(async () => navigation.open(first));
	const closeFirst = navigation.close;
	const replaceFirst = navigation.replace;
	const leaveFirst = navigation.leaveFor;

	await act(async () => navigation.open(second));
	const navigate = vi.fn();
	await act(async () => {
		closeFirst();
		replaceFirst({ id: "replacement" });
		leaveFirst(navigate);
	});

	expect(container.textContent).toBe("second");
	expect(navigate).not.toHaveBeenCalled();
	await act(async () => navigation.close());
	expect(container.textContent).toBe("list");
});

it("passes the expected detail to hosted replace and close operations", async () => {
	const detail = { id: "current" };
	const replacement = { id: "replacement" };
	const host: DetailNavigationHost = {
		detail,
		open: vi.fn(),
		replace: vi.fn(),
		close: vi.fn(),
	};
	await act(async () =>
		root.render(
			<DetailNavigationProvider value={host}>
				<Harness />
			</DetailNavigationProvider>,
		),
	);

	navigation.replace(replacement);
	navigation.close({ forget: true });
	expect(host.replace).toHaveBeenCalledExactlyOnceWith(detail, replacement);
	expect(host.close).toHaveBeenCalledExactlyOnceWith(detail, { forget: true });
});
