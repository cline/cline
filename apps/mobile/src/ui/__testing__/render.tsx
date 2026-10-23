/**
 * Render helpers for the UI smoke tests. Mounts a component with
 * `react-test-renderer` (works in Node) and exposes small utilities to walk the
 * tree and assert on flattened style values — enough to prove a component
 * mounts without crashing and paints the expected token colors.
 */
import type { ReactElement } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
	type ReactTestRendererJSON,
} from "react-test-renderer";
import { afterEach } from "vitest";
import { flattenStyle } from "./rn-host";

// Opt in to React's act() environment so state updates don't warn.
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderResult {
	root: ReactTestInstance;
	renderer: ReactTestRenderer;
	json: ReactTestRendererJSON | null;
	unmount: () => void;
}

const mountedRenderers = new Set<ReactTestRenderer>();

export function cleanup(): void {
	act(() => {
		for (const renderer of mountedRenderers) {
			mountedRenderers.delete(renderer);
			renderer.unmount();
		}
	});
}

afterEach(cleanup);

/** Mount `element` and return its test instance + helpers. */
export function render(element: ReactElement): RenderResult {
	let renderer!: ReactTestRenderer;
	act(() => {
		renderer = create(element);
	});
	mountedRenderers.add(renderer);
	return {
		root: renderer.root,
		renderer,
		json: renderer.toJSON(),
		unmount: () => {
			mountedRenderers.delete(renderer);
			act(() => renderer.unmount());
		},
	};
}

/**
 * Flip what `useReducedMotion()` reports for the rest of the file. Always reset
 * it in an `afterEach` — the flag is shared across the module graph.
 */
export function setReducedMotion(reduced: boolean): void {
	const preference = (
		globalThis as { __clineMotionPreference?: { reduced: boolean } }
	).__clineMotionPreference;
	if (preference) {
		preference.reduced = reduced;
	}
}

/** Every flattened `style` object in the tree. */
export function allStyles(root: ReactTestInstance): Record<string, unknown>[] {
	return root
		.findAll(() => true, { deep: true })
		.map((node) => flattenStyle(node.props.style))
		.filter((s) => Object.keys(s).length > 0);
}

/** All values a given style property takes anywhere in the tree. */
export function styleValues(root: ReactTestInstance, prop: string): unknown[] {
	return allStyles(root)
		.map((s) => s[prop])
		.filter((v) => v !== undefined);
}

/** True if any node's flattened style sets `prop` to `value`. */
export function hasStyle(
	root: ReactTestInstance,
	prop: string,
	value: unknown,
): boolean {
	return styleValues(root, prop).includes(value);
}

/** All instances whose host/component type name matches `typeName`. */
export function findAllByType(
	root: ReactTestInstance,
	typeName: string,
): ReactTestInstance[] {
	return root.findAll(
		(node) => {
			const t = node.type;
			if (typeof t === "string") {
				return t === typeName;
			}
			return (
				typeof t === "function" &&
				(t as { displayName?: string; name?: string }).displayName === typeName
			);
		},
		{ deep: true },
	);
}
