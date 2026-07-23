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
		const { container, rerender } = render(
			<AgentHeroHeading verbs={["build", "fix"]} />,
		);
		expect(
			screen.getByRole("heading", { name: "What would you like to build?" }),
		).toBeTruthy();
		expect(
			container.querySelector(".cline-ui-hero-heading__word")?.textContent,
		).toBe("build");

		rerender(<AgentHeroHeading verbs={["review"]} />);
		expect(
			screen.getByRole("heading", {
				name: "What would you like to review?",
			}),
		).toBeTruthy();
	});

	it("segments graphemes and supports localized visible copy", () => {
		const { container } = render(
			<AgentHeroHeading
				leadingText="Que veux-tu "
				trailingText=" ?"
				verbs={["créer 👩🏽‍💻"]}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Que veux-tu créer 👩🏽‍💻 ?" }),
		).toBeTruthy();
		expect(
			Array.from(
				container.querySelectorAll(".cline-ui-hero-heading__character"),
			).map((element) => element.textContent),
		).toEqual(["c", "r", "é", "e", "r", " ", "👩🏽‍💻"]);
	});

	it("deduplicates verbs and clamps unsafe cycle intervals", () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({
				addEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
				matches: false,
				media: "(prefers-reduced-motion: reduce)",
				onchange: null,
				removeEventListener: vi.fn(),
			})),
		);
		const { container } = render(
			<AgentHeroHeading cycleMs={0} verbs={["build", " build ", "fix"]} />,
		);
		const currentVerb = () =>
			container.querySelector(".cline-ui-hero-heading__word")?.textContent;

		act(() => vi.advanceTimersByTime(499));
		expect(currentVerb()).toBe("build");
		act(() => vi.advanceTimersByTime(1));
		expect(currentVerb()).toBe("fix");
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
			<AgentHeroHeading cycleMs={500} verbs={["build", "fix", "know"]} />,
		);
		const currentVerb = () =>
			container.querySelector(".cline-ui-hero-heading__word")?.textContent;

		act(() => vi.advanceTimersByTime(500));
		expect(currentVerb()).toBe("fix");
		reduceMotion = true;
		act(() => onPreferenceChange?.({ matches: true } as MediaQueryListEvent));
		act(() => vi.advanceTimersByTime(1000));
		expect(currentVerb()).toBe("fix");
		reduceMotion = false;
		act(() => onPreferenceChange?.({ matches: false } as MediaQueryListEvent));
		act(() => vi.advanceTimersByTime(500));
		expect(currentVerb()).toBe("know");
	});

	it("routes quick actions without owning task state", () => {
		const onSelect = vi.fn();
		const { container } = render(
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

		expect(container.firstElementChild?.classList).toContain("cline-ui-theme");
		fireEvent.click(screen.getByText("Review this repository"));
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "review" }),
		);
	});

	it("does not render an empty quick-action shell", () => {
		const { container } = render(
			<AgentQuickActions actions={[]} onSelect={vi.fn()} />,
		);
		expect(container.firstElementChild).toBeNull();
	});
});
