package com.cline.android.ui.chat

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import com.cline.android.databinding.FragmentChatBinding
import com.cline.android.models.Message

class ChatFragment : Fragment() {

    private var _binding: FragmentChatBinding? = null
    private val binding get() = _binding!!
    
    private lateinit var chatViewModel: ChatViewModel
    private lateinit var messageAdapter: MessageAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        // Initialize ViewModel
        chatViewModel = ViewModelProvider(requireActivity())[ChatViewModel::class.java]
        
        // Set up RecyclerView
        messageAdapter = MessageAdapter()
        binding.recyclerMessages.apply {
            layoutManager = LinearLayoutManager(context).apply {
                stackFromEnd = true
            }
            adapter = messageAdapter
        }
        
        // Observe messages
        chatViewModel.messages.observe(viewLifecycleOwner) { messages ->
            messageAdapter.submitList(messages)
            if (messages.isNotEmpty()) {
                binding.recyclerMessages.scrollToPosition(messages.size - 1)
            }
        }
        
        // Observe loading state
        chatViewModel.isLoading.observe(viewLifecycleOwner) { isLoading ->
            binding.progressLoading.visibility = if (isLoading) View.VISIBLE else View.GONE
            binding.buttonSend.isEnabled = !isLoading
        }
        
        // Set up send button
        binding.buttonSend.setOnClickListener {
            sendMessage()
        }
        
        // Set up input field
        binding.inputMessage.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendMessage()
                return@setOnEditorActionListener true
            }
            false
        }
    }
    
    private fun sendMessage() {
        val messageText = binding.inputMessage.text.toString().trim()
        if (messageText.isNotEmpty()) {
            chatViewModel.sendMessage(messageText)
            binding.inputMessage.text?.clear()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}