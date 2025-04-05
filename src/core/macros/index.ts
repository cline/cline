import * as vscode from "vscode"
import { MacroButton } from "../../shared/ExtensionMessage"
import { v4 as uuidv4 } from "uuid"

// Default macro buttons that will be available out of the box
const DEFAULT_MACROS: MacroButton[] = [
	{
		id: "check-task",
		label: "Check next task",
		action: "Please analyze the TASK.md file in this project and suggest the next task that should be worked on.",
	},
	{
		id: "prepare-task",
		label: "Prepare to start task",
		action: "I'm ready to start the task. Please help me understand what I need to do and create a plan to accomplish it.",
	},
	{
		id: "test-work",
		label: "Test this work",
		action: "Please help me write tests for the work we've completed.",
	},
	{
		id: "generate-docs",
		label: "Document this",
		action: "Please help me document the changes we've made and explain how they work.",
	},
]

/**
 * MacroManager class for handling macro buttons in Cline
 */
export class MacroManager {
	// Key used to store macros in global storage
	private static readonly STORAGE_KEY = "cline.macroButtons"

	/**
	 * Get the current macro buttons from storage, falling back to defaults
	 */
	public static getMacros(context: vscode.ExtensionContext): MacroButton[] {
		const storedMacros = context.globalState.get<MacroButton[]>(this.STORAGE_KEY)
		return storedMacros || DEFAULT_MACROS
	}

	/**
	 * Save macro buttons to global storage
	 */
	public static async saveMacros(context: vscode.ExtensionContext, macros: MacroButton[]): Promise<void> {
		await context.globalState.update(this.STORAGE_KEY, macros)
	}

	/**
	 * Add a new macro button
	 */
	public static async addMacro(context: vscode.ExtensionContext, newMacro: Omit<MacroButton, "id">): Promise<MacroButton[]> {
		const macros = this.getMacros(context)
		const macroToAdd: MacroButton = {
			...newMacro,
			id: uuidv4(),
		}

		const updatedMacros = [...macros, macroToAdd]
		await this.saveMacros(context, updatedMacros)
		return updatedMacros
	}

	/**
	 * Update an existing macro button
	 */
	public static async updateMacro(
		context: vscode.ExtensionContext,
		id: string,
		updatedMacro: Partial<Omit<MacroButton, "id">>,
	): Promise<MacroButton[]> {
		const macros = this.getMacros(context)
		const updatedMacros = macros.map((macro) => (macro.id === id ? { ...macro, ...updatedMacro } : macro))

		await this.saveMacros(context, updatedMacros)
		return updatedMacros
	}

	/**
	 * Delete a macro button
	 */
	public static async deleteMacro(context: vscode.ExtensionContext, id: string): Promise<MacroButton[]> {
		const macros = this.getMacros(context)
		const updatedMacros = macros.filter((macro) => macro.id !== id)

		await this.saveMacros(context, updatedMacros)
		return updatedMacros
	}

	/**
	 * Reset macros to default values
	 */
	public static async resetToDefaults(context: vscode.ExtensionContext): Promise<MacroButton[]> {
		await this.saveMacros(context, DEFAULT_MACROS)
		return DEFAULT_MACROS
	}

	/**
	 * Open a UI to manage macros
	 */
	public static async openMacroManager(context: vscode.ExtensionContext): Promise<void> {
		// TODO: Implement a proper UI for managing macros
		// For now, we'll use a simple input box for adding macros

		const labelInput = await vscode.window.showInputBox({
			title: "Add New Macro Button",
			prompt: "Enter a short label for the macro button",
			placeHolder: "e.g., Check Files",
		})

		if (!labelInput) return

		const actionInput = await vscode.window.showInputBox({
			title: `Action for "${labelInput}"`,
			prompt: "Enter the text to be inserted when this macro is clicked",
			placeHolder: "e.g., Please analyze these files and suggest improvements.",
		})

		if (!actionInput) return

		await this.addMacro(context, {
			label: labelInput,
			action: actionInput,
		})

		vscode.window.showInformationMessage(`Macro "${labelInput}" was added successfully.`)
	}
}
