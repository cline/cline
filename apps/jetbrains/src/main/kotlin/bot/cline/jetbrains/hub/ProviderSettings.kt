package bot.cline.jetbrains.hub

import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path

/** The provider/model the Cline CLI last used, read from `<data>/settings/providers.json`. */
data class ProviderDefaults(val provider: String?, val model: String?) {
	companion object {
		val EMPTY = ProviderDefaults(null, null)

		fun read(path: Path): ProviderDefaults {
			if (!Files.isRegularFile(path)) return EMPTY
			return try {
				val root = JsonParser.parseString(Files.readString(path)).takeIf { it.isJsonObject }?.asJsonObject ?: return EMPTY
				val provider = root.stringOrNull("lastUsedProvider")
				val model = provider?.let { id ->
					root.objectOrNull("providers")?.objectOrNull(id)?.objectOrNull("settings")?.stringOrNull("model")
				}
				ProviderDefaults(provider, model)
			} catch (_: Exception) {
				EMPTY
			}
		}
	}
}
