// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTauriAvailability } from "@/hooks/use-tauri-availability";

function AvailabilityProbe() {
	const isAvailable = useTauriAvailability();
	return <span>{isAvailable ? "native" : "web"}</span>;
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
});

afterEach(async () => {
	if (root) {
		await act(async () => root?.unmount());
		root = undefined;
	}
	container.remove();
	Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("useTauriAvailability", () => {
	it("keeps the first client render aligned with SSR before revealing Tauri", async () => {
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			configurable: true,
			value: {},
		});
		container.innerHTML = renderToString(<AvailabilityProbe />);
		expect(container.textContent).toBe("web");

		const onRecoverableError = vi.fn();
		await act(async () => {
			root = hydrateRoot(container, <AvailabilityProbe />, {
				onRecoverableError,
			});
		});

		expect(onRecoverableError).not.toHaveBeenCalled();
		expect(container.textContent).toBe("native");
	});
});
