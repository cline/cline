package com.cline.android.ui.project

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import com.cline.android.databinding.FragmentProjectListBinding

class ProjectListFragment : Fragment() {

    private var _binding: FragmentProjectListBinding? = null
    private val binding get() = _binding!!
    
    private lateinit var viewModel: ProjectListViewModel
    private lateinit var projectAdapter: ProjectAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProjectListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        viewModel = ViewModelProvider(this)[ProjectListViewModel::class.java]
        
        setupRecyclerView()
        setupClickListeners()
        observeViewModel()
    }
    
    private fun setupRecyclerView() {
        projectAdapter = ProjectAdapter { project ->
            // Handle project click - navigate to editor
        }
        
        binding.recyclerProjects.apply {
            layoutManager = LinearLayoutManager(context)
            adapter = projectAdapter
        }
    }
    
    private fun setupClickListeners() {
        binding.fabNewProject.setOnClickListener {
            // Show new project dialog
        }
    }
    
    private fun observeViewModel() {
        viewModel.projects.observe(viewLifecycleOwner) { projects ->
            projectAdapter.submitList(projects)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}