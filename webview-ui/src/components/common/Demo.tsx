import {
	VSCodeBadge,
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDataGrid,
	VSCodeDataGridCell,
	VSCodeDataGridRow,
	VSCodeDivider,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
	VSCodeProgressRing,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTag,
	VSCodeTextArea,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"

function Demo() {
	const rowData = [
		{
			cell1: "Cell Data",
			cell2: "Cell Data",
			cell3: "Cell Data",
			cell4: "Cell Data",
		},
		{
			cell1: "Cell Data",
			cell2: "Cell Data",
			cell3: "Cell Data",
			cell4: "Cell Data",
		},
		{
			cell1: "Cell Data",
			cell2: "Cell Data",
			cell3: "Cell Data",
			cell4: "Cell Data",
		},
	]

	return (
		<main>
			<h1>Hello World!</h1>
			<VSCodeButton>Howdy!</VSCodeButton>

			<div className="grid gap-3 p-2 place-items-start">
				<VSCodeDataGrid>
					<VSCodeDataGridRow row-type="header">
						<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
							A Custom Header Title
						</VSCodeDataGridCell>
						<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
							Another Custom Title
						</VSCodeDataGridCell>
						<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
							Title Is Custom
						</VSCodeDataGridCell>
						<VSCodeDataGridCell cell-type="columnheader" grid-column="4">
							Custom Title
						</VSCodeDataGridCell>
					</VSCodeDataGridRow>
					{rowData.map((row, index) => (
						<VSCodeDataGridRow key={index}>
							<VSCodeDataGridCell grid-column="1">{row.cell1}</VSCodeDataGridCell>
							<VSCodeDataGridCell grid-column="2">{row.cell2}</VSCodeDataGridCell>
							<VSCodeDataGridCell grid-column="3">{row.cell3}</VSCodeDataGridCell>
							<VSCodeDataGridCell grid-column="4">{row.cell4}</VSCodeDataGridCell>
						</VSCodeDataGridRow>
					))}
				</VSCodeDataGrid>

				<VSCodeTextField>
					<section slot="end" style={{ display: "flex", alignItems: "center" }}>
						<VSCodeButton appearance="icon" aria-label="Match Case">
							<span className="codicon codicon-case-sensitive"></span>
						</VSCodeButton>
						<VSCodeButton appearance="icon" aria-label="Match Whole Word">
							<span className="codicon codicon-whole-word"></span>
						</VSCodeButton>
						<VSCodeButton appearance="icon" aria-label="Use Regular Expression">
							<span className="codicon codicon-regex"></span>
						</VSCodeButton>
					</section>
				</VSCodeTextField>
				<span slot="end" className="codicon codicon-chevron-right"></span>

				<span className="flex gap-3">
					<VSCodeProgressRing />
					<VSCodeTextField />
					<VSCodeButton>Add</VSCodeButton>
					<VSCodeButton appearance="secondary">Remove</VSCodeButton>
				</span>

				<VSCodeBadge>Badge</VSCodeBadge>
				<VSCodeCheckbox>Checkbox</VSCodeCheckbox>
				<VSCodeDivider />
				<VSCodeDropdown>
					<VSCodeOption>Option 1</VSCodeOption>
					<VSCodeOption>Option 2</VSCodeOption>
				</VSCodeDropdown>
				<VSCodeLink href="#">Link</VSCodeLink>
				<VSCodePanels>
					<VSCodePanelTab id="tab-1">Tab 1</VSCodePanelTab>
					<VSCodePanelTab id="tab-2">Tab 2</VSCodePanelTab>
					<VSCodePanelView id="view-1">Panel View 1</VSCodePanelView>
					<VSCodePanelView id="view-2">Panel View 2</VSCodePanelView>
				</VSCodePanels>
				<VSCodeRadioGroup>
					<VSCodeRadio>Radio 1</VSCodeRadio>
					<VSCodeRadio>Radio 2</VSCodeRadio>
				</VSCodeRadioGroup>
				<VSCodeTag>Tag</VSCodeTag>
				<VSCodeTextArea placeholder="Text Area" />
			</div>
		</main>
	)
}

export default Demo
