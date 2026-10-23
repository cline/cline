/**
 * Minimal ambient types for `react-test-renderer` (used only by the UI render
 * smoke tests). The package ships no types and `@types/react-test-renderer` is
 * not installed; this declares just the surface the tests touch.
 */
declare module "react-test-renderer" {
	import type { ReactElement } from "react";

	export interface ReactTestInstance {
		type: unknown;
		parent: ReactTestInstance | null;
		// biome-ignore lint/suspicious/noExplicitAny: test-tree props are untyped
		props: Record<string, any>;
		findAll(
			predicate: (node: ReactTestInstance) => boolean,
			options?: { deep?: boolean },
		): ReactTestInstance[];
		/** Throws unless exactly one node matches — use for unique elements. */
		find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
	}

	export interface ReactTestRendererJSON {
		type: string;
		// biome-ignore lint/suspicious/noExplicitAny: serialized props are untyped
		props: Record<string, any>;
		children: null | Array<ReactTestRendererJSON | string>;
	}

	export interface ReactTestRenderer {
		root: ReactTestInstance;
		toJSON(): ReactTestRendererJSON | null;
		/** Re-render with a new element — used to simulate list virtualisation. */
		update(element: ReactElement): void;
		unmount(): void;
	}

	export function create(
		element: ReactElement,
		options?: unknown,
	): ReactTestRenderer;
	export function act(callback: () => void | Promise<void>): void;

	const TestRenderer: { create: typeof create; act: typeof act };
	export default TestRenderer;
}
