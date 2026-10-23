package bot.cline.jetbrains.actions

import bot.cline.jetbrains.session.ClineSessionService
import bot.cline.jetbrains.ui.ClineToolWindowFactory
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import java.nio.file.Paths

private fun activateClineToolWindow(project: Project, then: (() -> Unit)? = null) {
	val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(ClineToolWindowFactory.TOOL_WINDOW_ID) ?: return
	toolWindow.activate(then, true, true)
}

class OpenClineToolWindowAction : AnAction(), DumbAware {
	override fun actionPerformed(e: AnActionEvent) {
		val project = e.project ?: return
		activateClineToolWindow(project)
	}

	override fun update(e: AnActionEvent) {
		e.presentation.isEnabledAndVisible = e.project != null
	}

	override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

class NewSessionAction : AnAction(), DumbAware {
	override fun actionPerformed(e: AnActionEvent) {
		val project = e.project ?: return
		activateClineToolWindow(project) { ClineSessionService.getInstance(project).newSession() }
	}

	override fun update(e: AnActionEvent) {
		e.presentation.isEnabledAndVisible = e.project != null
	}

	override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

class ReconnectHubAction : AnAction(), DumbAware {
	override fun actionPerformed(e: AnActionEvent) {
		val project = e.project ?: return
		activateClineToolWindow(project) { ClineSessionService.getInstance(project).connect(force = true) }
	}

	override fun update(e: AnActionEvent) {
		e.presentation.isEnabledAndVisible = e.project != null
	}

	override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

/** Appends the editor selection (with its project-relative path and line range) to the prompt. */
class AddSelectionToChatAction : AnAction(), DumbAware {
	override fun actionPerformed(e: AnActionEvent) {
		val project = e.project ?: return
		val editor = e.getData(CommonDataKeys.EDITOR) ?: return
		val selection = editor.selectionModel
		val text = selection.selectedText?.takeIf { it.isNotBlank() } ?: return
		val document = editor.document
		val startLine = document.getLineNumber(selection.selectionStart) + 1
		val endLine = document.getLineNumber(maxOf(selection.selectionStart, selection.selectionEnd - 1)) + 1
		val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
		val path = file?.path?.let { full ->
			project.basePath?.let { base -> runCatching { Paths.get(base).relativize(Paths.get(full)).toString() }.getOrNull() } ?: full
		}
		val language = file?.extension ?: ""
		val header = if (path != null) "$path:$startLine-$endLine" else "Selection (lines $startLine-$endLine)"
		val snippet = "$header\n```$language\n${text.trimEnd()}\n```"
		activateClineToolWindow(project) {
			ClineToolWindowFactory.findPanel(project)?.appendToPrompt(snippet)
		}
	}

	override fun update(e: AnActionEvent) {
		val editor = e.getData(CommonDataKeys.EDITOR)
		e.presentation.isEnabledAndVisible = e.project != null && editor?.selectionModel?.hasSelection() == true
	}

	override fun getActionUpdateThread() = ActionUpdateThread.BGT
}
