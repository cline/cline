package bot.cline.jetbrains.settings

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

enum class SessionMode(val wireValue: String, val label: String) {
	ACT("act", "Act"),
	PLAN("plan", "Plan");

	companion object {
		fun fromWire(value: String?): SessionMode = entries.firstOrNull { it.wireValue == value } ?: ACT
	}
}

@Service(Service.Level.APP)
@State(name = "bot.cline.jetbrains.ClineSettings", storages = [Storage("cline-hub.xml")])
class ClineSettings : PersistentStateComponent<ClineSettings.State> {
	class State {
		/** Command used to run `cline hub ensure --json`; a path or a quoted command line. */
		var cliCommand: String = "cline"
		var hubUrlOverride: String = ""
		var discoveryPathOverride: String = ""
		var provider: String = ""
		var model: String = ""
		var defaultMode: String = SessionMode.ACT.wireValue
		var autoApproveTools: Boolean = false
		var showReasoning: Boolean = true
	}

	private var state = State()

	override fun getState(): State = state

	override fun loadState(state: State) {
		this.state = state
	}

	var cliCommand: String
		get() = state.cliCommand.ifBlank { "cline" }
		set(value) { state.cliCommand = value.trim() }

	var hubUrlOverride: String
		get() = state.hubUrlOverride
		set(value) { state.hubUrlOverride = value.trim() }

	var discoveryPathOverride: String
		get() = state.discoveryPathOverride
		set(value) { state.discoveryPathOverride = value.trim() }

	var provider: String
		get() = state.provider
		set(value) { state.provider = value.trim() }

	var model: String
		get() = state.model
		set(value) { state.model = value.trim() }

	var defaultMode: SessionMode
		get() = SessionMode.fromWire(state.defaultMode)
		set(value) { state.defaultMode = value.wireValue }

	var autoApproveTools: Boolean
		get() = state.autoApproveTools
		set(value) { state.autoApproveTools = value }

	var showReasoning: Boolean
		get() = state.showReasoning
		set(value) { state.showReasoning = value }

	/** Hub auth token for the URL override; kept in the IDE's credential store, not in XML. */
	var authTokenOverride: String?
		get() = PasswordSafe.instance.getPassword(tokenAttributes())?.takeIf { it.isNotBlank() }
		set(value) {
			PasswordSafe.instance.set(tokenAttributes(), value?.takeIf { it.isNotBlank() }?.let { Credentials("cline-hub", it) })
		}

	private fun tokenAttributes() = CredentialAttributes(generateServiceName("Cline", "hub-auth-token"))

	companion object {
		fun getInstance(): ClineSettings = ApplicationManager.getApplication().getService(ClineSettings::class.java)
	}
}
