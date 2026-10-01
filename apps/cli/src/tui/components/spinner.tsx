import type { ExtendedComponentProps } from "@opentui/react";
import type { SpinnerRenderable } from "opentui-spinner";
import { registerSpinner } from "opentui-spinner/react";

export function Spinner(
	props: ExtendedComponentProps<typeof SpinnerRenderable>,
) {
	// Bun's compiled bundles can omit the package's side-effect registration.
	// Register when rendering so every loading view retains this dependency.
	registerSpinner();
	return <spinner {...props} />;
}
