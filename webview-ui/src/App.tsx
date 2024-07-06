import React from "react"
import logo from "./logo.svg"
import "./App.css"

import { vscode } from "./utilities/vscode"
import {
	VSCodeButton,
	VSCodeDataGrid,
	VSCodeDataGridRow,
	VSCodeDataGridCell,
	VSCodeTextField,
	VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react"

function App() {
	function handleHowdyClick() {
		vscode.postMessage({
			command: "hello",
			text: "Hey there partner! 🤠",
		})
	}

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
			<VSCodeButton onClick={handleHowdyClick}>Howdy!</VSCodeButton>

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
					{rowData.map((row) => (
						<VSCodeDataGridRow>
							<VSCodeDataGridCell grid-column="1">{row.cell1}</VSCodeDataGridCell>
							<VSCodeDataGridCell grid-column="2">{row.cell2}</VSCodeDataGridCell>
							<VSCodeDataGridCell grid-column="3">{row.cell3}</VSCodeDataGridCell>
							<VSCodeDataGridCell grid-column="4">{row.cell4}</VSCodeDataGridCell>
						</VSCodeDataGridRow>
					))}
				</VSCodeDataGrid>

				<span className="flex gap-3">
					<VSCodeProgressRing />
					<VSCodeTextField />
					<VSCodeButton>Add</VSCodeButton>
					<VSCodeButton appearance="secondary">Remove</VSCodeButton>
				</span>
			</div>
		</main>
	)
}

export default App
