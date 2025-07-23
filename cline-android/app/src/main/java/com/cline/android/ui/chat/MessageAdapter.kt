package com.cline.android.ui.chat

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.cline.android.R
import com.cline.android.databinding.ItemMessageBinding
import com.cline.android.models.Message
import com.cline.android.repository.database.entities.MessageEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MessageAdapter : ListAdapter<MessageEntity, MessageAdapter.MessageViewHolder>(MessageDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        val binding = ItemMessageBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return MessageViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class MessageViewHolder(private val binding: ItemMessageBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(message: MessageEntity) {
            // Set message text
            binding.textMessage.text = message.content
            
            // Format timestamp
            val formatter = SimpleDateFormat("h:mm a", Locale.getDefault())
            binding.textTimestamp.text = formatter.format(message.timestamp)
            
            // Adjust layout based on message sender
            if (message.isUser) {
                // User message (right-aligned)
                binding.cardMessage.setCardBackgroundColor(
                    binding.root.context.getColor(R.color.primary)
                )
                binding.textMessage.setTextColor(
                    binding.root.context.getColor(R.color.icons)
                )
                
                // Adjust constraints for user message
                (binding.cardMessage.layoutParams as ViewGroup.MarginLayoutParams).apply {
                    marginStart = binding.root.context.resources.getDimensionPixelSize(R.dimen.message_margin_large)
                    marginEnd = binding.root.context.resources.getDimensionPixelSize(R.dimen.message_margin_small)
                }
            } else {
                // Assistant message (left-aligned)
                binding.cardMessage.setCardBackgroundColor(
                    binding.root.context.getColor(R.color.card_background)
                )
                binding.textMessage.setTextColor(
                    binding.root.context.getColor(R.color.primary_text)
                )
                
                // Adjust constraints for assistant message
                (binding.cardMessage.layoutParams as ViewGroup.MarginLayoutParams).apply {
                    marginStart = binding.root.context.resources.getDimensionPixelSize(R.dimen.message_margin_small)
                    marginEnd = binding.root.context.resources.getDimensionPixelSize(R.dimen.message_margin_large)
                }
            }
        }
    }

    private class MessageDiffCallback : DiffUtil.ItemCallback<MessageEntity>() {
        override fun areItemsTheSame(oldItem: MessageEntity, newItem: MessageEntity): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: MessageEntity, newItem: MessageEntity): Boolean {
            return oldItem == newItem
        }
    }
}