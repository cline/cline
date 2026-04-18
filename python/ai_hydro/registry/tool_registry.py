"""
Tool Registry for AI-Hydro
===========================

Manages registration and discovery of hydrological tools across tiers.
"""

from typing import Dict, List, Any, Optional
from pathlib import Path
import json

from ..rag.config import RAGConfig


class ToolRegistry:
    """
    Registry for managing hydrological tools across three tiers:
    - Tier 1: External libraries (pysheds, rasterio, etc.)
    - Tier 2: Wrapper functions (ai_hydro.analysis, ai_hydro.data, etc.)
    - Tier 3: Complete workflows (ai_hydro.workflows)
    """
    
    def __init__(self):
        """Initialize the tool registry."""
        self._tools: Dict[str, Dict[str, Any]] = {}
        self._loaded = False
    
    @property
    def tools(self) -> List[Dict[str, Any]]:
        """
        Get list of all tools.
        
        Returns:
            List of tool definitions
        """
        if not self._loaded:
            self.load_tools()
        return [t for t in self._tools.values() if isinstance(t, dict)]
    
    def load_tools(self) -> None:
        """
        Load tool definitions from the knowledge base.
        
        Loads from:
        - knowledge/tools/tier1_libraries.json (external libraries)
        - knowledge/tools/tier2_wrappers.json (AI-Hydro wrapper functions)
        - knowledge/tools/tier3_tools.json (hardcoded workflow implementations)
        
        Note: Flexible workflow blueprints are loaded separately via WorkflowRegistry
        from knowledge/workflows/*.yaml files.
        """
        if self._loaded:
            return
        
        tools_path = RAGConfig.get_tools_path()
        
        # Load tier definitions (UPDATED to use tier3_tools.json)
        for tier_file in ['tier1_libraries.json', 'tier2_wrappers.json', 'tier3_tools.json']:
            tier_path = tools_path / tier_file
            
            if tier_path.exists():
                with open(tier_path, 'r', encoding='utf-8') as f:
                    tier_tools = json.load(f)
                    self._tools.update(tier_tools)
        
        self._loaded = True
    
    def get_tool(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """
        Get tool definition by name.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            Tool definition dict or None if not found
        """
        if not self._loaded:
            self.load_tools()
        
        return self._tools.get(tool_name)
    
    def list_tools(self, tier: Optional[str] = None, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        List tools, optionally filtered by tier and category.
        
        Args:
            tier: Filter by tier ('tier1', 'tier2', 'tier3')
            category: Filter by category ('watershed', 'climate', etc.)
            
        Returns:
            List of tool definitions
        """
        if not self._loaded:
            self.load_tools()
        
        # Filter out non-dict entries (like _comment)
        tools = [t for t in self._tools.values() if isinstance(t, dict)]
        
        if tier:
            tools = [t for t in tools if t.get('tier') == tier]
        
        if category:
            tools = [t for t in tools if t.get('category') == category]
        
        return tools
    
    def search_tools(self, query: str) -> List[Dict[str, Any]]:
        """
        Search tools using multi-criteria weighted scoring.
        
        Implements the "Adjusted Weights" approach that achieved 66.67% precision@3
        in empirical testing (vs 53.33% for the previous binary token matching).
        
        Scoring components:
        - name_match (35%): Exact/partial match in tool name
        - semantic (30%): TF-IDF cosine similarity
        - category (20%): Category alignment with exclusion handling
        - tier_match (10%): Tier appropriateness for query type
        - keyword_density (5%): Keyword concentration
        
        Args:
            query: Search query string
            
        Returns:
            List of matching tool definitions, sorted by relevance score
        """
        if not self._loaded:
            self.load_tools()
        
        # Try TF-IDF scoring if scikit-learn available
        try:
            return self._search_with_tfidf(query)
        except ImportError:
            # Fallback to legacy token matching if scikit-learn not available
            return self._search_legacy(query)
    
    def _search_with_tfidf(self, query: str) -> List[Dict[str, Any]]:
        """
        Search using TF-IDF + multi-criteria scoring (Adjusted Weights approach).
        
        Requires: scikit-learn
        """
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
        
        # Weights optimized through empirical testing
        WEIGHTS = {
            'name_match': 0.35,
            'semantic': 0.30,
            'category': 0.20,
            'tier_match': 0.10,
            'keyword_density': 0.05
        }
        
        # Get all tools with names
        tools = []
        for tool_name, tool_def in self._tools.items():
            if isinstance(tool_def, dict):
                # Add name field to tool dict
                tool_with_name = dict(tool_def)
                tool_with_name['name'] = tool_name
                tools.append(tool_with_name)
        
        if not tools:
            return []
        
        # Build searchable texts
        tool_texts = []
        for tool in tools:
            text = ' '.join([
                tool.get('name', ''),
                tool.get('description', ''),
                tool.get('category', ''),
                ' '.join(tool.get('keywords', [])),
                ' '.join(tool.get('use_when', []))
            ])
            tool_texts.append(text)
        
        # Expand query with synonyms
        expanded_query = self._expand_synonyms(query)
        
        # Train TF-IDF vectorizer
        vectorizer = TfidfVectorizer(
            max_features=500,
            ngram_range=(1, 2),
            stop_words='english',
            lowercase=True
        )
        
        tool_vectors = vectorizer.fit_transform(tool_texts)
        query_vector = vectorizer.transform([expanded_query])
        
        # Compute TF-IDF similarities
        tfidf_scores = cosine_similarity(query_vector, tool_vectors)[0]
        
        # Score each tool using multi-criteria
        scored_tools = []
        for i, tool in enumerate(tools):
            scores = {
                'semantic': float(tfidf_scores[i]),
                'name_match': self._name_match_score(query, tool),
                'category': self._category_score(query, tool),
                'tier_match': self._tier_appropriateness(query, tool),
                'keyword_density': self._keyword_density(query, tool)
            }
            
            # Weighted sum
            final_score = sum(scores[k] * WEIGHTS[k] for k in scores)
            scored_tools.append((final_score, tool))
        
        # Sort by score descending
        scored_tools.sort(key=lambda x: x[0], reverse=True)
        
        return [tool for _, tool in scored_tools]
    
    def _expand_synonyms(self, query: str) -> str:
        """Expand query with hydrological synonyms."""
        synonyms = {
            'watershed': 'basin catchment drainage area',
            'streamflow': 'discharge flow runoff',
            'gauge': 'station gage site usgs',
            'precipitation': 'precip rainfall',
            'temperature': 'temp',
            'elevation': 'dem altitude',
            'twi': 'topographic wetness index',
            'lai': 'leaf area index',
            'cn': 'curve number'
        }
        
        expanded = [query]
        query_lower = query.lower()
        
        for term, expansions in synonyms.items():
            if term in query_lower:
                expanded.append(expansions)
        
        return ' '.join(expanded)
    
    def _name_match_score(self, query: str, tool: Dict[str, Any]) -> float:
        """Score based on query terms in tool name."""
        query_lower = query.lower()
        tool_name = tool.get('name', '').lower()
        
        # Exact match
        if query_lower in tool_name or tool_name in query_lower:
            return 1.0
        
        # Exact phrase match (e.g., "climate_indices")
        query_clean = query_lower.replace(' ', '_')
        if query_clean in tool_name or tool_name in query_clean:
            return 0.95
        
        # Token overlap
        query_tokens = set(query_lower.split())
        name_tokens = set(tool_name.replace('_', ' ').split())
        
        matches = query_tokens.intersection(name_tokens)
        if matches:
            return len(matches) / len(query_tokens) * 0.8
        
        return 0.0
    
    def _category_score(self, query: str, tool: Dict[str, Any]) -> float:
        """Score based on category alignment with exclusion handling."""
        query_lower = query.lower()
        category = tool.get('category', '').lower()
        
        # Check for exclusion keywords
        exclusion_keywords = ['exclude', 'not', 'without', 'except']
        has_exclusion = any(kw in query_lower for kw in exclusion_keywords)
        
        if has_exclusion:
            # Extract what's being excluded
            for cat_type in ['topography', 'climate', 'soil', 'geology', 'watershed']:
                if cat_type in query_lower and cat_type in category:
                    # Check if this category is being excluded
                    words = query_lower.split()
                    for i, word in enumerate(words):
                        if cat_type in word:
                            # Look for exclusion keyword nearby
                            window = words[max(0, i-3):min(len(words), i+3)]
                            if any(exc in window for exc in exclusion_keywords):
                                return 0.0  # Exclude this category
        
        # Category matching
        category_indicators = {
            'watershed': ['watershed', 'basin', 'catchment', 'delineation', 'drainage'],
            'climate': ['climate', 'precipitation', 'temperature', 'forcing', 'weather'],
            'hydrology': ['streamflow', 'discharge', 'flow', 'signatures', 'runoff'],
            'topography': ['elevation', 'dem', 'slope', 'twi', 'topographic'],
            'data': ['fetch', 'download', 'retrieve', 'get', 'data']
        }
        
        for cat, keywords in category_indicators.items():
            if cat in category:
                if any(kw in query_lower for kw in keywords):
                    return 1.0
        
        return 0.3
    
    def _tier_appropriateness(self, query: str, tool: Dict[str, Any]) -> float:
        """Score based on tier-query type alignment."""
        query_lower = query.lower()
        tier = tool.get('tier', 'tier2')
        
        standard_keywords = ['complete', 'full', 'all', 'standard', 'automated', 'workflow']
        custom_keywords = ['custom', 'specific', 'only', 'exclude', 'just']
        
        has_standard = any(kw in query_lower for kw in standard_keywords)
        has_custom = any(kw in query_lower for kw in custom_keywords)
        
        if has_standard:
            return 1.0 if tier == 'tier3' else 0.6
        elif has_custom:
            return 1.0 if tier == 'tier2' else 0.6
        else:
            return 0.8 if tier == 'tier2' else 0.7
    
    def _keyword_density(self, query: str, tool: Dict[str, Any]) -> float:
        """Score based on keyword concentration."""
        query_tokens = set(query.lower().split())
        stop_words = {'get', 'me', 'the', 'a', 'an', 'for', 'to', 'from', 'with'}
        query_tokens = query_tokens - stop_words
        
        description = tool.get('description', '').lower()
        keywords = tool.get('keywords', [])
        searchable = description + ' ' + ' '.join(str(k).lower() for k in keywords)
        
        matches = sum(1 for token in query_tokens if token in searchable)
        
        if query_tokens:
            return matches / len(query_tokens)
        return 0.0
    
    def _search_legacy(self, query: str) -> List[Dict[str, Any]]:
        """
        Legacy search using token matching (fallback when scikit-learn unavailable).
        
        This is the original implementation.
        """
        query_lower = query.lower()
        
        # Synonym mapping
        query_synonyms = {
            'basin': 'watershed',
            'catchment': 'watershed',
            'drainage': 'watershed',
            'gauge': 'usgs',
            'station': 'usgs',
            'gage': 'usgs',
            'precip': 'precipitation',
            'temp': 'temperature',
            'pet': 'evapotranspiration',
            'et': 'evapotranspiration',
            'dem': 'elevation',
            'twi': 'topographic wetness index',
            'lai': 'leaf area index',
            'gvf': 'green vegetation fraction',
            'flow': 'streamflow',
            'discharge': 'streamflow',
            'runoff': 'streamflow'
        }
        
        # Apply synonyms
        expanded_tokens = []
        for token in query_lower.split():
            expanded_tokens.append(token)
            if token in query_synonyms:
                synonym = query_synonyms[token]
                expanded_tokens.extend(synonym.split())
        
        # Tokenize
        stop_words = {'get', 'me', 'the', 'a', 'an', 'for', 'to', 'from', 'with', 'by', 'in', 'on', 'at', 'these', 'this', 'that'}
        query_tokens = [
            token for token in expanded_tokens
            if token not in stop_words and len(token) > 2
        ]
        
        if not query_tokens:
            query_tokens = [query_lower]
        
        # Score tools
        tool_scores = {}
        
        # Detect acronyms
        import re
        acronyms_in_query = re.findall(r'\b[A-Z]{2,5}\b', query)
        
        for tool_name, tool_def in self._tools.items():
            if not isinstance(tool_def, dict):
                continue
            
            score = 0
            matched = False
            
            # Combine searchable text
            searchable_text = ' '.join([
                tool_name,
                tool_def.get('description', ''),
                tool_def.get('category', ''),
                ' '.join(tool_def.get('keywords', []))
            ]).lower()
            
            searchable_text_original = ' '.join([
                tool_name,
                tool_def.get('description', ''),
                tool_def.get('category', ''),
                ' '.join(tool_def.get('keywords', []))
            ])
            
            # Count keyword matches
            for token in query_tokens:
                if token in searchable_text:
                    score += 1
                    matched = True
            
            # Acronym matching
            for acronym in acronyms_in_query:
                if acronym in searchable_text_original or acronym.lower() in searchable_text:
                    score += 15
                    matched = True
            
            # Exact phrase match bonuses
            if query_lower in tool_name.lower():
                score += 10
                matched = True
            elif query_lower in tool_def.get('description', '').lower():
                score += 5
                matched = True
            
            if matched:
                tool_scores[tool_name] = (score, tool_def)
        
        # Sort and return
        sorted_tools = sorted(tool_scores.items(), key=lambda x: x[1][0], reverse=True)
        return [tool_def for _, (_, tool_def) in sorted_tools]
    
    def get_tool_path(self, tool_name: str) -> Optional[str]:
        """
        Get the full Python import path for a tool.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            Full import path or None if not found
        """
        tool_def = self.get_tool(tool_name)
        
        if not tool_def:
            return None
        
        return tool_def.get('full_path') or tool_def.get('import_path')


# Global registry instance
_registry_instance: Optional[ToolRegistry] = None


def get_tool_registry() -> ToolRegistry:
    """
    Get the global tool registry instance.
    
    Returns:
        Singleton ToolRegistry instance
    """
    global _registry_instance
    
    if _registry_instance is None:
        _registry_instance = ToolRegistry()
    
    return _registry_instance
