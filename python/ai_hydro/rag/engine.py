"""
RAG Engine for AI-Hydro
========================

Main RAG engine implementation using the new knowledge base structure.
"""

from typing import List, Dict, Any, Optional
import warnings

from .config import RAGConfig
from .embeddings import create_embeddings, query_embeddings
from .decision_engine import get_decision_engine
from ..registry.tool_registry import get_tool_registry
from ..registry.workflow_registry import get_workflow_registry
from ..registry.loader import get_knowledge_loader


# Abridged session initialization guidelines injected at start of every session
ABRIDGED_SESSION_INIT = """
# AI-Hydro System Guidelines

## Tool selection rule

1. **If an MCP tool exists for the task → use it. Never use Python instead.**
   Check the `ai-hydro` MCP server first. If the tool is there, call it.

2. **If no MCP tool exists for the task → Python scripting is the right fallback.**
   Use execute_command with the ai_hydro Python library for capabilities not yet
   in the MCP server. Note the gap so a new MCP tool can be added later.

Never use Python to replicate something an MCP tool already does.

## Standard workflow — all covered by MCP tools
```
delineate_watershed("01031500", workspace_dir="/path/to/workspace")
fetch_streamflow_data("01031500", "2000-01-01", "2020-12-31")
extract_hydrological_signatures("01031500")
fetch_camels_us("01031500")
extract_geomorphic_parameters("01031500")
compute_twi("01031500")               # statistics + PNG map + interactive HTML
fetch_forcing_data("01031500", "2000-01-01", "2020-12-31")
```

## MCP tool rules
- Pass workspace_dir once to delineate_watershed — files saved automatically
- All downstream tools take only gauge_id — geometry loaded from session
- Never use write_file for data arrays — server saves files directly
- Never call pip install — all dependencies pre-installed

## Python fallback rules (when no MCP tool exists)
- Use ai_hydro.tools.* — not raw pysheds/rasterio directly
- Access result["data"] fields, not raw API field names
- result["data"]["gauge_id"] not site_no, result["data"]["area_km2"] not drainage_area_va
- Document what you did so the community can add an MCP tool for it
"""


class RAGEngine:
    """
    RAG engine for hydrological knowledge retrieval and tool recommendation.
    
    This engine provides semantic search over:
    - CAMELS attribute definitions and metadata
    - Hydrological concepts and terminology
    - Model descriptions and usage patterns
    - Best practices for watershed analysis
    - Available Python tools and workflows
    
    Enhanced with:
    - Session initialization context (shown once on first query)
    - Tool-specific instructions (shown with each tool recommendation)
    - Token-efficient context management
    """
    
    def __init__(self, knowledge_base_path: Optional[str] = None):
        """
        Initialize the RAG engine.
        
        Args:
            knowledge_base_path: Optional path override (for backward compatibility)
        """
        self.config = RAGConfig()
        self.tool_registry = get_tool_registry()
        self.workflow_registry = get_workflow_registry()
        self.knowledge_loader = get_knowledge_loader()
        
        # For backward compatibility
        if knowledge_base_path:
            warnings.warn(
                "knowledge_base_path parameter is deprecated. "
                "Use AI_HYDRO_KNOWLEDGE_PATH environment variable instead.",
                DeprecationWarning
            )
    
    def load_knowledge_base(self):
        """
        Load all knowledge base files into memory.
        
        This method is kept for backward compatibility but delegates
        to the new registry system.
        """
        # Load concepts
        self.knowledge_loader.load_concepts()
        
        # Load instructions
        self.knowledge_loader.load_instructions()
        
        # Load tools and workflows
        self.tool_registry.load_tools()
        self.workflow_registry.load_workflows()
    
    def _validate_tool_exists(self, tool_path: str) -> bool:
        """
        Verify that a recommended tool/function actually exists.
        
        This prevents RAG from recommending non-existent functions (hallucinations).
        
        Args:
            tool_path: Full import path (e.g., 'ai_hydro.tools.hydrology.fetch_streamflow_data')
            
        Returns:
            True if function exists and is importable, False otherwise
        """
        try:
            # Split into module and function
            parts = tool_path.rsplit('.', 1)
            if len(parts) != 2:
                return False
            
            module_path, func_name = parts
            
            # Try to import
            module = __import__(module_path, fromlist=[func_name])
            
            # Check if function exists
            if not hasattr(module, func_name):
                return False
            
            # Verify it's callable
            func = getattr(module, func_name)
            return callable(func)
            
        except (ImportError, AttributeError, Exception):
            return False
    
    def _score_tool_with_penalties(self, tool_data: Dict[str, Any], query_text: str) -> float:
        """
        Score a tool's relevance with penalties for field name mismatches.
        
        This prevents hallucinations by penalizing tools when the query mentions
        field names that don't exist in the tool's return values.
        
        Args:
            tool_data: Tool metadata from knowledge base
            query_text: User query
            
        Returns:
            Relevance score (0.0-1.0, lower means less relevant)
        """
        # Determine base score by tier
        tier = tool_data.get('tier', 'tier1')
        if tier == 'tier2':
            base_score = 0.95  # Higher base score for our enhanced Tier 2 tools
        elif tier == 'tier3':
            base_score = 0.90  # Tier 3 workflows
        else:
            base_score = 0.70  # Lower score for Tier 1 libraries (raw external tools)
        
        query_lower = query_text.lower()
        
        # Extract forbidden field names from common_mistakes
        common_mistakes = tool_data.get('common_mistakes', [])
        forbidden_fields = []
        for mistake in common_mistakes:
            if '❌' in mistake and "use result['" in mistake.lower():
                # Extract the forbidden field name (e.g., 'site_no' from "result['site_no']")
                import re
                matches = re.findall(r"result\['([^']+)'\]", mistake)
                if matches:
                    forbidden_fields.extend(matches)
        
        # Check if query mentions any forbidden fields in a field-access context
        # Only penalize if the field appears to be requested as a return value
        # e.g., "get site_no", "return station_nm", "access watershed field"
        penalty = 0.0
        field_access_patterns = [
            'get ', 'return ', 'access ', 'retrieve ', 'fetch ', 'extract ',
            'result[', "result['", 'field ', 'attribute ', 'property '
        ]
        
        for field in forbidden_fields:
            field_lower = field.lower()
            # Check if field appears in a field-access context
            for pattern in field_access_patterns:
                if pattern + field_lower in query_lower or \
                   field_lower + ' field' in query_lower or \
                   field_lower + ' attribute' in query_lower:
                    penalty += 0.3  # Heavy penalty for explicit field access
                    break
        
        # Extract correct field names from returns.fields
        returns = tool_data.get('returns', {})
        if isinstance(returns, dict):
            return_fields = returns.get('fields', {})
            if isinstance(return_fields, dict):
                correct_fields = list(return_fields.keys())
                
                # Bonus for mentioning correct field names
                bonus = 0.0
                for field in correct_fields:
                    if field.lower() in query_lower:
                        bonus += 0.15  # Increased bonus for correct fields
                
                base_score += bonus
        
        # Apply penalty
        final_score = max(0.0, base_score - penalty)
        
        return final_score
    
    def query(self, query_text: str, top_k: int = 5, is_first_query: bool = True) -> List[Dict[str, Any]]:
        """
        Query the knowledge base using semantic search with relevance scoring.
        
        This enhanced version includes:
        - Hydrological concepts and definitions
        - Available tools and workflows
        - Tool recommendations based on query
        - Hybrid decision engine (pre-filtering + AI guidance)
        - Relevance scoring with penalties for field name mismatches
        - Tool-specific usage examples and instructions
        
        Phase 1 Optimization:
        - First query: Shows abridged session init (~800 tokens)
        - Subsequent queries: Only tool-specific instructions (~400 tokens)
        - Token savings: ~35% over multi-turn conversations
        
        Phase 2 Enhancement:
        - Integrated hybrid decision engine
        - Deduplication of Tier 3 tools vs YAML workflows
        - Query intent analysis (standard, custom, learning, ambiguous)
        - Relevance boosting based on query characteristics
        
        Args:
            query_text: Natural language query
            top_k: Number of results to return
            is_first_query: Whether this is the first query in the conversation
                           (default True for backward compatibility)
            
        Returns:
            List of relevant knowledge entries with actionable guidance
        """
        # Ensure knowledge is loaded
        self.load_knowledge_base()
        
        results = []
        query_lower = query_text.lower()
        
        # PHASE 1 OPTIMIZATION: Session initialization on first query only
        if is_first_query:
            results.append({
                "source": "session_init",
                "type": "session_guidelines",
                "content": ABRIDGED_SESSION_INIT,
                "relevance": 1.0
            })
        
        # 1. Search hydrological concepts
        search_results = self.knowledge_loader.search_all(query_text)
        
        for concept in search_results.get('concepts', [])[:2]:
            results.append({
                "source": "concepts",
                "type": "concept",
                "key": concept.get('name', 'unknown'),
                "content": concept.get('data', {}),
                "relevance": 0.9
            })
        
        # 2. PHASE 2: Use hybrid decision engine for tool/workflow recommendations
        # This replaces the old direct tool_registry.search_tools() calls
        decision_engine = get_decision_engine()
        
        # Get tool and workflow search results first
        tool_search_results = self.tool_registry.search_tools(query_text)
        workflow_search_results = self.workflow_registry.search_workflows(query_text)
        
        # Use decision engine to filter and score
        recommendations = decision_engine.filter_and_score(
            query_text=query_text,
            tool_results=tool_search_results,
            workflow_results=workflow_search_results
        )
        
        # Add tool recommendations with full instructions
        for tool_rec in recommendations.get('tools', [])[:3]:
            tool = tool_rec['tool_data']
            
            # Apply relevance scoring with penalties
            relevance_score = self._score_tool_with_penalties(tool, query_text)
            
            # Enhanced with decision engine metadata
            results.append({
                "source": "tools_registry",
                "type": "tool_with_instructions",
                "tool": tool.get('full_path', tool.get('import_path', 'unknown')),
                "category": tool.get('category', 'unknown'),
                "description": tool.get('description', ''),
                "tier": tool.get('tier', 'unknown'),
                # Decision engine insights
                "query_intent": recommendations.get('query_intent', 'standard'),
                "recommendation_reason": tool_rec.get('reason', ''),
                # Tool-specific instructions embedded in result
                "usage_example": tool.get('usage_example', ''),
                "common_mistakes": tool.get('common_mistakes', []),
                "ai_guidance": tool.get('ai_guidance', ''),
                "use_when": tool.get('use_when', []),
                "returns": tool.get('returns', {}),
                "return_field_notes": tool.get('return_field_notes', {}),
                "parameters": tool.get('parameters', {}),
                "relevance": relevance_score * tool_rec.get('score', 1.0)
            })
        
        # Add workflow recommendations
        for wf_rec in recommendations.get('workflows', [])[:2]:
            wf = wf_rec['workflow_data']
            results.append({
                "source": "workflows",
                "type": "workflow",
                "name": wf.get('name', 'unknown'),
                "description": wf.get('description', ''),
                "category": wf.get('category', ''),
                "steps": wf.get('steps', []),
                # Decision engine insights
                "query_intent": recommendations.get('query_intent', 'standard'),
                "recommendation_reason": wf_rec.get('reason', ''),
                "ai_guidance": wf.get('ai_guidance', ''),
                "use_when": wf.get('use_when', []),
                "relevance": 0.75 * wf_rec.get('score', 1.0)
            })
        
        # 5. Search CAMELS metadata if relevant
        if any(kw in query_lower for kw in ["camels", "attribute", "catchment"]):
            camels_concepts = self.knowledge_loader.get_concept("camels_metadata")
            if camels_concepts and isinstance(camels_concepts, dict):
                for key, value in list(camels_concepts.items())[:2]:
                    results.append({
                        "source": "camels_metadata",
                        "type": "camels_attribute",
                        "attribute": key,
                        "content": value,
                        "relevance": 0.8
                    })
        
        # Sort by relevance and return top_k
        results.sort(key=lambda x: x.get("relevance", 0), reverse=True)
        return results[:top_k]
    
    def get_camels_attribute_info(self, attribute_name: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a CAMELS attribute.
        
        Args:
            attribute_name: Name of the CAMELS attribute
            
        Returns:
            Dictionary with attribute metadata or None
        """
        camels_meta = self.knowledge_loader.get_concept("camels_metadata")
        
        if camels_meta and isinstance(camels_meta, dict):
            return camels_meta.get(attribute_name)
        
        return None
    
    def search_hydrological_concepts(self, concept: str) -> List[Dict[str, Any]]:
        """
        Search for hydrological concepts and definitions.
        
        Args:
            concept: Hydrological concept or term
            
        Returns:
            List of matching concepts with definitions
        """
        search_results = self.knowledge_loader.search_all(concept)
        
        results = []
        for concept_match in search_results.get('concepts', []):
            results.append({
                "concept": concept_match.get('name', 'unknown'),
                "definition": concept_match.get('data', {})
            })
        
        return results
    
    def get_workflow_recommendation(self, task_description: str) -> Dict[str, Any]:
        """
        Recommend a workflow based on task description.
        
        Enhanced version that includes:
        - Tool recommendations (validated to exist)
        - Workflow details
        - Usage guidance
        
        Args:
            task_description: Description of the analysis task
            
        Returns:
            Comprehensive workflow recommendation with validated tools
        """
        task_lower = task_description.lower()
        
        # Search for matching workflows
        workflow_matches = self.workflow_registry.search_workflows(task_description)
        
        if workflow_matches:
            best_workflow = workflow_matches[0]
            
            # Get recommended tools
            tool_matches = self.tool_registry.search_tools(task_description)
            
            # Validate tools exist before recommending
            validated_tools = []
            tool_rationales = {}
            for t in tool_matches[:3]:
                tool_path = t.get('full_path', t.get('import_path', ''))
                if tool_path and self._validate_tool_exists(tool_path):
                    validated_tools.append(tool_path)
                    tool_rationales[tool_path] = t.get('description', '')
            
            return {
                "workflow": best_workflow.get("name", "unknown"),
                "title": best_workflow.get("name", "Unknown Workflow"),
                "description": best_workflow.get("description", ""),
                "category": best_workflow.get("category", "analysis"),
                "recommended_tools": validated_tools,
                "tool_rationales": tool_rationales,
                "steps": best_workflow.get("steps", [])
            }
        
        # Fallback: rule-based recommendations (with validation)
        fallback_result = None
        
        if "camels" in task_lower or "attribute" in task_lower:
            fallback_result = {
                "workflow": "compute_signatures",
                "title": "Compute Signatures",
                "description": "Extract CAMELS-like catchment attributes",
                "recommended_tools": ["ai_hydro.camels.part1_attributes.extract_catchment_attributes"],
                "category": "analysis"
            }
        elif "watershed" in task_lower or "delineation" in task_lower:
            fallback_result = {
                "workflow": "delineate_watershed",
                "title": "Watershed Delineation",
                "description": "Watershed delineation and analysis",
                "recommended_tools": ["ai_hydro.tools.watershed.delineate_watershed"],
                "category": "analysis"
            }
        elif "usgs" in task_lower or "streamflow" in task_lower:
            fallback_result = {
                "workflow": "fetch_hydrological_data",
                "title": "Fetch Hydrological Data",
                "description": "Fetch USGS streamflow and watershed data",
                "recommended_tools": [
                    "ai_hydro.tools.hydrology.fetch_streamflow_data",  # Tier 2 (preferred)
                    "ai_hydro.workflows.fetch_data.fetch_hydrological_data"  # Tier 3 workflow
                ],
                "category": "data"
            }
        else:
            fallback_result = {
                "workflow": "fetch_hydrological_data",
                "title": "Hydrological Data",
                "description": "General hydrological analysis and data retrieval",
                "recommended_tools": ["ai_hydro.tools.watershed.delineate_watershed"],
                "category": "research"
            }
        
        # Validate fallback tools
        if fallback_result:
            validated_tools = [
                tool for tool in fallback_result["recommended_tools"]
                if self._validate_tool_exists(tool)
            ]
            fallback_result["recommended_tools"] = validated_tools
            
            # Warn if some tools were invalid
            if len(validated_tools) < len(fallback_result.get("recommended_tools", [])):
                warnings.warn(
                    f"Some recommended tools for {fallback_result['workflow']} do not exist and were removed",
                    UserWarning
                )
        
        return fallback_result
    
    def format_context_for_agent(self, query_results: List[Dict[str, Any]]) -> str:
        """
        Format RAG query results into actionable context for the agent.
        
        This provides structured guidance that helps the agent:
        - Understand what tools are available
        - Know when to use existing tools vs creating new ones
        - Follow best practices for hydrological analysis
        
        Args:
            query_results: Results from query()
            
        Returns:
            Formatted context string for agent
        """
        if not query_results:
            return ""
        
        context_parts = [
            "\n# AI-Hydro Knowledge Base Context",
            "\nThe following information from the AI-Hydro knowledge base may help with this task:\n"
        ]
        
        # Group results by type
        session_guidelines = [r for r in query_results if r.get("type") == "session_guidelines"]
        concepts = [r for r in query_results if r.get("type") == "concept"]
        tools_with_instructions = [r for r in query_results if r.get("type") == "tool_with_instructions"]
        workflows = [r for r in query_results if r.get("type") == "workflow"]
        
        # PHASE 1: Display session guidelines if present (first query only)
        if session_guidelines:
            context_parts.append("\n\n" + "="*80)
            context_parts.append("\n📘 AI-HYDRO SESSION GUIDELINES")
            context_parts.append("\n" + "="*80)
            for guideline in session_guidelines:
                context_parts.append(guideline.get('content', ''))
            context_parts.append("\n" + "="*80 + "\n")
        
        # PHASE 2: Display concepts
        if concepts:
            context_parts.append("\n## Relevant Hydrological Concepts:")
            for concept in concepts[:2]:
                concept_content = concept.get('content', {})
                definition = concept_content.get('definition', str(concept_content)) if isinstance(concept_content, dict) else str(concept_content)
                context_parts.append(f"\n**{concept['key']}**: {definition}")
        
        # PHASE 3: Display tools with tool-specific instructions (CORE OPTIMIZATION)
        if tools_with_instructions:
            context_parts.append("\n\n" + "="*80)
            context_parts.append("\n🔧 RECOMMENDED TOOLS WITH INSTRUCTIONS")
            
            # Display query intent from decision engine
            query_intent = tools_with_instructions[0].get('query_intent', 'standard') if tools_with_instructions else 'standard'
            intent_explanations = {
                'standard': 'Standard use case - Use hardcoded Tier 3 tool for efficiency',
                'custom': 'Custom requirements - Consider YAML workflow for flexibility',
                'learning': 'Learning/exploration - YAML workflow recommended for understanding',
                'ambiguous': 'Intent unclear - Multiple options provided'
            }
            context_parts.append(f"\n**Query Intent:** {query_intent.upper()} - {intent_explanations.get(query_intent, '')}")
            context_parts.append("\n" + "="*80)
            
            for tool in tools_with_instructions:
                tool_path = tool.get('tool', 'unknown')
                category = tool.get('category', 'unknown')
                description = tool.get('description', '')
                recommendation_reason = tool.get('recommendation_reason', '')
                
                context_parts.append(f"\n\n### {tool_path} ({category})")
                context_parts.append(f"**Description:** {description}")
                
                # Display recommendation reason from decision engine
                if recommendation_reason:
                    context_parts.append(f"\n**Why This Tool:** {recommendation_reason}")
                
                # Display AI guidance from tool metadata
                ai_guidance = tool.get('ai_guidance', '')
                if ai_guidance:
                    context_parts.append(f"\n**AI Guidance:** {ai_guidance}")
                
                # Display use_when criteria
                use_when = tool.get('use_when', [])
                if use_when:
                    context_parts.append("\n**Use This Tool When:**")
                    for criterion in use_when[:3]:
                        context_parts.append(f"  - {criterion}")
                
                # Tool-specific common mistakes (HIGHEST PRIORITY)
                common_mistakes = tool.get('common_mistakes', [])
                if common_mistakes:
                    context_parts.append("\n\n**⚠️ CRITICAL - DO NOT DO THESE THINGS:**")
                    for mistake in common_mistakes[:8]:
                        context_parts.append(f"  {mistake}")
                
                # Tool-specific return fields
                returns = tool.get('returns', {})
                if isinstance(returns, dict):
                    return_fields = returns.get('fields', {})
                    if return_fields:
                        context_parts.append("\n\n**✓ CORRECT Return Fields (use these):**")
                        for field_name, field_desc in list(return_fields.items())[:8]:
                            desc_parts = str(field_desc).split(' — ')
                            if len(desc_parts) > 1:
                                field_type = desc_parts[0]
                                context_parts.append(f"  - `result['{field_name}']` → {field_type}")
                            else:
                                context_parts.append(f"  - `result['{field_name}']`")
                
                # Tool-specific usage example
                usage_example = tool.get('usage_example', '')
                if usage_example:
                    context_parts.append("\n\n**Usage Example:**")
                    context_parts.append("```python")
                    for line in usage_example.strip().split('\n')[:15]:
                        context_parts.append(line)
                    context_parts.append("```")
            
            context_parts.append("\n\n" + "="*80 + "\n")
        
        # PHASE 4: Display workflows with decision engine insights
        if workflows:
            context_parts.append("\n\n" + "="*80)
            context_parts.append("\n📋 RELATED WORKFLOWS")
            context_parts.append("\n" + "="*80)
            for wf in workflows:
                wf_name = wf.get('name', 'Unknown')
                wf_desc = wf.get('description', '')
                recommendation_reason = wf.get('recommendation_reason', '')
                
                context_parts.append(f"\n\n**{wf_name}**")
                context_parts.append(f"Description: {wf_desc}")
                
                if recommendation_reason:
                    context_parts.append(f"Why This Workflow: {recommendation_reason}")
                
                # Display AI guidance from workflow metadata
                ai_guidance = wf.get('ai_guidance', '')
                if ai_guidance:
                    context_parts.append(f"AI Guidance: {ai_guidance}")
                
                # Display use_when criteria
                use_when = wf.get('use_when', [])
                if use_when:
                    context_parts.append("Use This Workflow When:")
                    for criterion in use_when[:3]:
                        context_parts.append(f"  - {criterion}")
            
            context_parts.append("\n" + "="*80)
        
        return "\n".join(context_parts)
