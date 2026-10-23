package bot.cline.jetbrains.settings

import bot.cline.jetbrains.ClineBundle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.bindItem
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.toNullableProperty

class ClineSettingsConfigurable : BoundConfigurable(ClineBundle.message("settings.title")) {
	private val settings get() = ClineSettings.getInstance()
	private val tokenField = JBPasswordField()
	private var loadedToken: String = ""

	override fun createPanel(): DialogPanel {
		loadTokenAsync()
		return panel {
			group(ClineBundle.message("settings.group.hub")) {
				row(ClineBundle.message("settings.cliCommand")) {
					textField()
						.bindText(settings::cliCommand)
						.align(AlignX.FILL)
						.comment(ClineBundle.message("settings.cliCommand.comment"))
				}
				row(ClineBundle.message("settings.hubUrl")) {
					textField()
						.bindText(settings::hubUrlOverride)
						.align(AlignX.FILL)
						.comment(ClineBundle.message("settings.hubUrl.comment"))
				}
				row(ClineBundle.message("settings.authToken")) {
					cell(tokenField)
						.align(AlignX.FILL)
						.comment(ClineBundle.message("settings.authToken.comment"))
				}
				row(ClineBundle.message("settings.discoveryPath")) {
					textField()
						.bindText(settings::discoveryPathOverride)
						.align(AlignX.FILL)
						.comment(ClineBundle.message("settings.discoveryPath.comment"))
				}
			}
			group(ClineBundle.message("settings.group.session")) {
				row(ClineBundle.message("settings.provider")) {
					textField()
						.bindText(settings::provider)
						.align(AlignX.FILL)
						.comment(ClineBundle.message("settings.provider.comment"))
				}
				row(ClineBundle.message("settings.model")) {
					textField()
						.bindText(settings::model)
						.align(AlignX.FILL)
						.comment(ClineBundle.message("settings.model.comment"))
				}
				row(ClineBundle.message("settings.mode")) {
					comboBox(SessionMode.entries.toList())
						.bindItem(settings::defaultMode.toNullableProperty())
				}
				row {
					checkBox(ClineBundle.message("settings.autoApprove"))
						.bindSelected(settings::autoApproveTools)
						.comment(ClineBundle.message("settings.autoApprove.comment"))
				}
				row {
					checkBox("Show model reasoning in the transcript")
						.bindSelected(settings::showReasoning)
				}
			}
		}
	}

	private fun enteredToken(): String = String(tokenField.password)

	override fun isModified(): Boolean = super.isModified() || enteredToken() != loadedToken

	override fun apply() {
		super.apply()
		val token = enteredToken()
		if (token != loadedToken) {
			loadedToken = token
			// The credential store may block (keyring/KWallet), so never touch it on the EDT.
			ApplicationManager.getApplication().executeOnPooledThread { settings.authTokenOverride = token }
		}
	}

	override fun reset() {
		super.reset()
		loadTokenAsync()
	}

	private fun loadTokenAsync() {
		val app = ApplicationManager.getApplication()
		app.executeOnPooledThread {
			val token = settings.authTokenOverride ?: ""
			app.invokeLater({
				loadedToken = token
				tokenField.text = token
			}, ModalityState.any())
		}
	}
}
