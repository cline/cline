import * as vscode from "vscode"
import { InlineCompletionProvider } from "./InlineCompletionProvider"

export class CompletionManager implements vscode.Disposable {
	private provider: InlineCompletionProvider
	private providerDisposable: vscode.Disposable
	private enabled: boolean = true
	private outputChannel: vscode.OutputChannel

	constructor(context: vscode.ExtensionContext) {
		this.outputChannel = vscode.window.createOutputChannel("Cline智能补全管理器")
		this.outputChannel.appendLine("🎯 Cline 智能补全：开始初始化 CompletionManager")

		this.provider = new InlineCompletionProvider(context)

		// Register the provider for all languages
		this.providerDisposable = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, this.provider)
		this.outputChannel.appendLine("📝 Cline 智能补全：已注册 InlineCompletionProvider")

		// Register toggle command
		const toggleCommand = vscode.commands.registerCommand("cline.completion.toggle", () => this.toggle())

		context.subscriptions.push(this.providerDisposable, toggleCommand)
		this.outputChannel.appendLine("✅ Cline 智能补全：CompletionManager 初始化完成")
	}

	private toggle() {
		this.enabled = !this.enabled
		const status = this.enabled ? "enabled" : "disabled"
		const chineseStatus = this.enabled ? "已启用" : "已禁用"
		this.outputChannel.appendLine(`🔄 Cline 智能补全：切换状态 - ${chineseStatus}`)
		vscode.window.showInformationMessage(`Cline completion ${status}`)

		if (this.enabled) {
			this.providerDisposable = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, this.provider)
		} else {
			this.providerDisposable.dispose()
		}
	}

	dispose() {
		this.providerDisposable?.dispose()
		this.provider?.dispose()
		this.outputChannel.dispose()
	}
}
