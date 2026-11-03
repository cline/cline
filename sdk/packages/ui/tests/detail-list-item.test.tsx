// @vitest-environment jsdom
import { act, createElement, createRef, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DetailList } from "../components/detail-list.js";
import { DetailListItem } from "../components/detail-list-item.js";

let container: HTMLDivElement;
let root: Root;
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
async function render(node: ReactNode) {
	await act(async () => root.render(<DetailList>{node}</DetailList>));
}

describe("DetailListItem", () => {
	it("does not reserve trailing columns for empty composed slots", async () => {
		const empty = createElement(Fragment, null, [
			null,
			false,
			"",
			createElement(Fragment, null, false),
		]);
		await render(
			<DetailListItem
				title="Authentication"
				description="This server does not require credentials."
				trailingText={empty}
				actions={[]}
			/>,
		);
		const item = container.querySelector("[data-slot='detail-list-item']");
		expect(item?.hasAttribute("data-has-trailing-text")).toBe(false);
		expect(item?.hasAttribute("data-has-actions")).toBe(false);
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing"),
		).toBeNull();
		expect(container.querySelector("dd")?.textContent).toBe(
			"This server does not require credentials.",
		);
	});

	it("omits empty descriptions while retaining the value and zero count", async () => {
		await render(
			<DetailListItem
				title="Usage"
				count={0}
				description=""
				trailingText={0}
			/>,
		);
		expect(
			container.querySelector(".cline-ui-detail-list-item__description"),
		).toBeNull();
		expect(
			container.querySelector("[data-slot='detail-list-item-count']")
				?.textContent,
		).toBe("0");
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing-text")
				?.textContent,
		).toBe("0");
	});

	it("preserves content supplied by an opaque component", async () => {
		function Value() {
			return <>Connected</>;
		}
		await render(<DetailListItem title="Status" trailingText={<Value />} />);
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing-text")
				?.textContent,
		).toBe("Connected");
	});

	it("forwards row refs and native attributes inside the description list", async () => {
		const ref = createRef<HTMLDivElement>();
		await render(
			<DetailListItem
				ref={ref}
				id="status"
				title="Status"
				trailingText="Connected"
				hidden
			/>,
		);
		expect(ref.current).toBe(container.querySelector("dl > div"));
		expect(ref.current?.id).toBe("status");
		expect(ref.current?.hidden).toBe(true);
	});
});
