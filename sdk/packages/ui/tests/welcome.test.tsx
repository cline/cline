// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgentHeroHeading,
	AgentQuickActions,
	AgentSurface,
} from "../src/index.js";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("@cline/ui welcome experience", () => {
	it("exposes a stable accessible welcome heading", () => {
		const { container } = render(<AgentHeroHeading verbs={["build", "fix"]} />);
		expect(
			screen.getByRole("heading", { name: "What would you like to build?" }),
		).toBeTruthy();
		expect(
			container.querySelector(".cline-ui-hero-heading__word")?.textContent,
		).toBe("build");
	});

	it("responds when reduced-motion preference changes", () => {
		vi.useFakeTimers();
		let reduceMotion = false;
		let onPreferenceChange: ((event: MediaQueryListEvent) => void) | undefined;
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({
				addEventListener: (
					_event: string,
					listener: (event: MediaQueryListEvent) => void,
				) => {
					onPreferenceChange = listener;
				},
				dispatchEvent: vi.fn(),
				get matches() {
					return reduceMotion;
				},
				media: "(prefers-reduced-motion: reduce)",
				onchange: null,
				removeEventListener: vi.fn(),
			})),
		);
		const { container } = render(
			<AgentHeroHeading cycleMs={100} verbs={["build", "fix", "know"]} />,
		);
		const currentVerb = () =>
			container.querySelector(".cline-ui-hero-heading__word")?.textContent;

		act(() => vi.advanceTimersByTime(100));
		expect(currentVerb()).toBe("fix");
		reduceMotion = true;
		act(() => onPreferenceChange?.({ matches: true } as MediaQueryListEvent));
		act(() => vi.advanceTimersByTime(200));
		expect(currentVerb()).toBe("fix");
		reduceMotion = false;
		act(() => onPreferenceChange?.({ matches: false } as MediaQueryListEvent));
		act(() => vi.advanceTimersByTime(100));
		expect(currentVerb()).toBe("know");
	});

	it("routes quick actions without owning task state", () => {
		const onSelect = vi.fn();
		render(
			<AgentSurface>
				<AgentQuickActions
					actions={[
						{
							description: "Inspect the selected repository",
							id: "review",
							label: "Review this repository",
							value: "Review this repository",
						},
					]}
					onSelect={onSelect}
				/>
			</AgentSurface>,
		);

		fireEvent.click(screen.getByText("Review this repository"));
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "review" }),
		);
	});
});
