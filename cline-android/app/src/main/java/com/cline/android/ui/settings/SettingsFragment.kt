package com.cline.android.ui.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import com.cline.android.databinding.FragmentSettingsBinding

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!
    
    private lateinit var viewModel: SettingsViewModel

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        viewModel = ViewModelProvider(this)[SettingsViewModel::class.java]
        
        setupClickListeners()
        observeViewModel()
    }
    
    private fun setupClickListeners() {
        binding.buttonSave.setOnClickListener {
            saveSettings()
        }
    }
    
    private fun saveSettings() {
        val apiKey = binding.editApiKey.text.toString()
        val apiProvider = binding.spinnerApiProvider.selectedItem.toString()
        val model = binding.editModel.text.toString()
        
        viewModel.saveSettings(apiKey, apiProvider, model)
    }
    
    private fun observeViewModel() {
        viewModel.settings.observe(viewLifecycleOwner) { settings ->
            settings?.let {
                binding.editApiKey.setText(it.apiKey)
                binding.editModel.setText(it.model)
                // Set spinner selection based on apiProvider
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}