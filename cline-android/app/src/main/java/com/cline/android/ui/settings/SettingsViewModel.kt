package com.cline.android.ui.settings

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cline.android.repository.database.entities.SettingsEntity
import kotlinx.coroutines.launch

class SettingsViewModel : ViewModel() {
    
    private val _settings = MutableLiveData<SettingsEntity?>()
    val settings: LiveData<SettingsEntity?> = _settings
    
    init {
        loadSettings()
    }
    
    private fun loadSettings() {
        viewModelScope.launch {
            // TODO: Load settings from database
            // For now, show default settings
            _settings.value = SettingsEntity(
                id = 1,
                apiKey = "",
                apiProvider = "openai",
                model = "gpt-4",
                theme = "system",
                language = "en",
                editorFontSize = 14,
                terminalFontSize = 12
            )
        }
    }
    
    fun saveSettings(apiKey: String, apiProvider: String, model: String) {
        viewModelScope.launch {
            // TODO: Save settings to database
            val currentSettings = _settings.value
            if (currentSettings != null) {
                val updatedSettings = currentSettings.copy(
                    apiKey = apiKey,
                    apiProvider = apiProvider,
                    model = model
                )
                _settings.value = updatedSettings
            }
        }
    }
}