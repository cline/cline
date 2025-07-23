package com.cline.android.ui.project

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.cline.android.databinding.ItemProjectBinding
import com.cline.android.repository.database.entities.ProjectEntity
import java.text.SimpleDateFormat
import java.util.*

class ProjectAdapter(
    private val onProjectClick: (ProjectEntity) -> Unit
) : ListAdapter<ProjectEntity, ProjectAdapter.ProjectViewHolder>(ProjectDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ProjectViewHolder {
        val binding = ItemProjectBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ProjectViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ProjectViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ProjectViewHolder(
        private val binding: ItemProjectBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(project: ProjectEntity) {
            binding.apply {
                textProjectName.text = project.name
                textProjectPath.text = project.rootPath
                
                val dateFormat = SimpleDateFormat("MMM dd, yyyy", Locale.getDefault())
                textLastOpened.text = "Last opened: ${dateFormat.format(Date(project.lastOpened))}"
                
                root.setOnClickListener {
                    onProjectClick(project)
                }
            }
        }
    }

    private class ProjectDiffCallback : DiffUtil.ItemCallback<ProjectEntity>() {
        override fun areItemsTheSame(oldItem: ProjectEntity, newItem: ProjectEntity): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: ProjectEntity, newItem: ProjectEntity): Boolean {
            return oldItem == newItem
        }
    }
}