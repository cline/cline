/**
 * CommandOutputRow – scrollbar visibility (#11332)
 * --------------------------------------------------
 * The scrollable command-output container must carry the `code-block-scrollable`
 * class so a vertical scrollbar is always visible when output overflows, instead
 * of relying on the auto-hiding native scrollbar (which renders invisible on Windows).
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../common/CodeBlock", () => ({
	__esModule: true,
	default: ({ source }: { source: string }) => (
		<pre data-testid="code-block">{source}</pre>
	),
}));

vi.mock("./ExpandHandle", () => ({
	__esModule: true,
	default: () => <div data-testid="expand-handle" />,
}));

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFile: vi.fn() },
}));

import { CommandOutputContent } from "../CommandOutputRow";

const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
	"\n",
);
const shortOutput = "line 1\nline 2";

function renderContent(output: string, isOutputFullyExpanded = false) {
	return render(
		<CommandOutputContent
			isContainerExpanded={true}
			isOutputFullyExpanded={isOutputFullyExpanded}
			onToggle={() => {}}
			output={output}
		/>,
	);
}

describe("CommandOutputContent scrollbar (#11332)", () => {
	it("applies code-block-scrollable to the scroll container when output overflows", () => {
		const { container } = renderContent(longOutput);

		const scrollable = container.querySelector(".overflow-y-auto");
		expect(scrollable).not.toBeNull();
		expect(scrollable?.classList.contains("code-block-scrollable")).toBe(true);
	});

	it("keeps the class while keeping a height cap so the scrollbar can appear", () => {
		const { container } = renderContent(longOutput);

		const scrollable = container.querySelector(".code-block-scrollable");
		expect(scrollable).not.toBeNull();
		// Collapsed view caps height so overflow (and thus the scrollbar) is possible.
		expect(scrollable?.classList.contains("max-h-[75px]")).toBe(true);
	});

	it("does not cap height for short output that fits without scrolling", () => {
		const { container } = renderContent(shortOutput);

		const scrollable = container.querySelector(".code-block-scrollable");
		expect(scrollable).not.toBeNull();
		expect(scrollable?.classList.contains("overflow-y-visible")).toBe(true);
	});
});
