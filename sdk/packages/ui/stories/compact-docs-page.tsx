import {
	Controls,
	Description,
	Primary,
	Stories,
	Title,
} from "@storybook/addon-docs/blocks";

/** Show the primary example once, followed by controls and distinct examples. */
export function CompactDocsPage() {
	return (
		<>
			<Title />
			<Description />
			<Primary />
			<Controls />
			<Stories includePrimary={false} />
		</>
	);
}
