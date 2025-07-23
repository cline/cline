package com.cline.android.ui.main

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import com.cline.android.databinding.FragmentHomeBinding
import com.cline.android.ui.chat.ChatActivity
import com.cline.android.ui.project.ProjectAdapter
import com.cline.android.ui.project.ProjectViewModel

class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!
    
    private lateinit var projectViewModel: ProjectViewModel
    private lateinit var projectAdapter: ProjectAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        // Initialize ViewModel
        projectViewModel = ViewModelProvider(requireActivity())[ProjectViewModel::class.java]
        
        // Set up RecyclerView
        projectAdapter = ProjectAdapter { project ->
            // Handle project click
            projectViewModel.openProject(project)
        }
        
        binding.recyclerRecentProjects.apply {
            layoutManager = LinearLayoutManager(context)
            adapter = projectAdapter
        }
        
        // Observe recent projects
        projectViewModel.recentProjects.observe(viewLifecycleOwner) { projects ->
            projectAdapter.submitList(projects)
        }
        
        // Set up FAB for new chat
        binding.fabNewChat.setOnClickListener {
            startActivity(Intent(requireContext(), ChatActivity::class.java))
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}