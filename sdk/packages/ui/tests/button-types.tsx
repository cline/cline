import { Button } from "../src/index.js";

export const namedIconButton = (
	<Button aria-label="Create session" iconOnly>
		<span aria-hidden="true">+</span>
	</Button>
);

// @ts-expect-error icon-only buttons require an accessible name
export const unnamedIconButton = <Button iconOnly>+</Button>;
