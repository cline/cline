package bot.cline.jetbrains.ui

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class ClineToolWindowFactory : ToolWindowFactory, DumbAware {
	override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
		val panel = ClineChatPanel(project, toolWindow.disposable)
		val content = ContentFactory.getInstance().createContent(panel, "", false)
		content.putUserData(ClineChatPanel.KEY, panel)
		content.isCloseable = false
		toolWindow.contentManager.addContent(content)
	}

	companion object {
		const val TOOL_WINDOW_ID = "Cline"

		fun findPanel(project: Project): ClineChatPanel? {
			val toolWindow = com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID) ?: return null
			return toolWindow.contentManager.contents.firstNotNullOfOrNull { it.getUserData(ClineChatPanel.KEY) }
		}
	}
}
