package bot.cline.jetbrains

import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

object ClineIcons {
	@JvmField
	val Cline: Icon = IconLoader.getIcon("/icons/cline.svg", ClineIcons::class.java)

	@JvmField
	val ToolWindow: Icon = IconLoader.getIcon("/icons/toolWindowCline.svg", ClineIcons::class.java)
}
