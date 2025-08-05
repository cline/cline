import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import numpy as np
from datetime import datetime
import os
import json
import difflib
# import mimetypes # No longer needed here if guess_language_from_filepath handles it
from utils import get_database_connection, guess_language_from_filepath # Import from utils

# Page config
st.set_page_config(
    page_title="Diff Edits Evaluation Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for beautiful styling
st.markdown("""
<style>
    /* Import Google Fonts */
    @import url('https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;700&display=swap');
    
    /* Global Styles */
    .main {
        font-family: 'Azeret Mono', monospace;
    }
    
    /* Hero Section */
    .hero-container {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 2rem;
        border-radius: 15px;
        margin-bottom: 2rem;
        color: white;
        text-align: center;
    }
    
    .hero-title {
        font-size: 3rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    
    .hero-subtitle {
        font-size: 1.2rem;
        font-weight: 300;
        opacity: 0.9;
    }
    
    /* Model Performance Cards */
    .model-card {
        background: white;
        border-radius: 15px;
        padding: 1.5rem;
        margin: 1rem 0;
        box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .model-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 12px 40px rgba(0,0,0,0.15);
    }
    
    .model-card.best-performer {
        border: 2px solid #00D4AA;
        background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
    }
    
    .model-name {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 1rem;
        color: #1f2937;
    }
    
    .success-rate {
        font-size: 3rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
    }
    
    .success-rate.excellent { color: #10b981; }
    .success-rate.good { color: #f59e0b; }
    .success-rate.poor { color: #ef4444; }
    
    .metric-row {
        display: flex;
        justify-content: space-between;
        margin: 0.5rem 0;
        padding: 0.5rem;
        background: rgba(0,0,0,0.02);
        border-radius: 8px;
    }
    
    .metric-label {
        font-weight: 500;
        color: #6b7280;
    }
    
    .metric-value {
        font-weight: 600;
        color: #1f2937;
    }
    
    /* Performance Badge */
    .performance-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.875rem;
        margin-left: 1rem;
    }
    
    .badge-a { background: #10b981; color: white; }
    .badge-b { background: #f59e0b; color: white; }
    .badge-c { background: #ef4444; color: white; }
    
    /* Comparison Charts */
    .chart-container {
        background: white;
        border-radius: 15px;
        padding: 1.5rem;
        margin: 1rem 0;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    
    /* Result Detail Modal */
    .result-detail {
        background: white;
        border-radius: 15px;
        padding: 2rem;
        margin: 1rem 0;
        box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
    
    .file-viewer {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 1rem;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.875rem;
        line-height: 1.5;
        overflow-x: auto;
    }
    
    .diff-added {
        background-color: #dcfce7;
        color: #166534;
    }
    
    .diff-removed {
        background-color: #fef2f2;
        color: #dc2626;
    }
    
    .error-display {
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        padding: 1rem;
        color: #dc2626;
        font-family: monospace;
    }
    
    /* Sidebar Styling */
    .sidebar .sidebar-content {
        background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    }
    
    /* Custom Metrics */
    .custom-metric {
        text-align: center;
        padding: 1rem;
        background: white;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        margin: 0.5rem 0;
    }
    
    .custom-metric-value {
        font-size: 2rem;
        font-weight: 700;
        color: #1f2937;
    }
    
    .custom-metric-label {
        font-size: 0.875rem;
        color: #6b7280;
        font-weight: 500;
        margin-top: 0.25rem;
    }
</style>
""", unsafe_allow_html=True)

# Enhanced data loading functions
@st.cache_data
def load_all_runs():
    """Load all evaluation runs"""
    conn = get_database_connection()
    
    query = """
    SELECT run_id, description, created_at, system_prompt_hash
    FROM runs 
    ORDER BY created_at DESC
    """
    
    return pd.read_sql_query(query, conn)

@st.cache_data
def load_run_comparison(run_id):
    """Load a specific run with model comparison data"""
    conn = get_database_connection()
    
    # Get the run details
    run_query = f"""
    SELECT run_id, description, created_at, system_prompt_hash
    FROM runs 
    WHERE run_id = '{run_id}'
    """
    run_data = pd.read_sql_query(run_query, conn)
    
    if run_data.empty:
        return None, None
    
    # Get model performance for this run
    model_perf_query = f"""
    SELECT 
        res.model_id,
        COUNT(*) as total_results,
        AVG(CASE WHEN res.succeeded THEN 1.0 ELSE 0.0 END) as success_rate,
        AVG(res.cost_usd) as avg_cost,
        SUM(res.cost_usd) as total_cost,
        AVG(res.time_to_first_token_ms) as avg_first_token_ms,
        AVG(res.time_to_first_edit_ms) as avg_first_edit_ms,
        AVG(res.time_round_trip_ms) as avg_round_trip_ms,
        AVG(res.completion_tokens) as avg_completion_tokens,
        AVG(res.num_edits) as avg_num_edits,
        MIN(res.time_round_trip_ms) as min_round_trip_ms,
        MAX(res.time_round_trip_ms) as max_round_trip_ms
    FROM results res
    JOIN cases c ON res.case_id = c.case_id
    WHERE c.run_id = '{run_id}'
      AND (res.error_enum NOT IN (1, 6, 7) OR res.error_enum IS NULL)  -- Exclude: no_tool_calls, wrong_tool_call, wrong_file_edited
    GROUP BY res.model_id
    ORDER BY success_rate DESC, avg_round_trip_ms ASC
    """
    
    model_performance = pd.read_sql_query(model_perf_query, conn)
    
    return run_data.iloc[0], model_performance

@st.cache_data
def load_latest_run_comparison():
    """Load the latest run with model comparison data"""
    conn = get_database_connection()
    
    # Get the latest run
    latest_run_query = """
    SELECT run_id, description, created_at, system_prompt_hash
    FROM runs 
    ORDER BY created_at DESC 
    LIMIT 1
    """
    latest_run = pd.read_sql_query(latest_run_query, conn)
    
    if latest_run.empty:
        return None, None
    
    return load_run_comparison(latest_run.iloc[0]['run_id'])

@st.cache_data
def load_detailed_results(run_id, model_id=None, valid_only=False):
    """Load detailed results for drill-down analysis"""
    conn = get_database_connection()
    
    where_clause = f"WHERE c.run_id = '{run_id}'"
    if model_id:
        where_clause += f" AND res.model_id = '{model_id}'"
    
    # Option to filter out invalid attempts
    if valid_only:
        where_clause += " AND (res.error_enum NOT IN (1, 6, 7) OR res.error_enum IS NULL)"
    
    query = f"""
    SELECT 
        res.*,
        c.task_id,
        c.description as case_description,
        c.tokens_in_context,
        sp.name as system_prompt_name,
        pf.name as processing_functions_name,
        orig_f.filepath as original_filepath,
        orig_f.content as original_file_content,
        edit_f.filepath as edited_filepath,
        edit_f.content as edited_file_content
    FROM results res
    JOIN cases c ON res.case_id = c.case_id
    LEFT JOIN system_prompts sp ON c.system_prompt_hash = sp.hash
    LEFT JOIN processing_functions pf ON res.processing_functions_hash = pf.hash
    LEFT JOIN files orig_f ON c.file_hash = orig_f.hash
    LEFT JOIN files edit_f ON res.file_edited_hash = edit_f.hash
    {where_clause}
    ORDER BY res.created_at DESC
    """
    
    return pd.read_sql_query(query, conn)

def get_performance_grade(success_rate):
    """Get performance grade based on success rate"""
    if success_rate >= 0.9:
        return "A+", "excellent"
    elif success_rate >= 0.8:
        return "A", "excellent"
    elif success_rate >= 0.7:
        return "B+", "good"
    elif success_rate >= 0.6:
        return "B", "good"
    elif success_rate >= 0.5:
        return "C+", "good"
    else:
        return "C", "poor"

def get_error_description(error_enum, error_string=None):
    """Map error enum values to user-friendly descriptions"""
    error_map = {
        1: "No tool calls - Model didn't use the replace_in_file tool",
        2: "Multiple tool calls - Model called multiple tools instead of one", 
        3: "Wrong tool call - Model used wrong tool (not replace_in_file)",
        4: "Missing parameters - Tool call missing required path or diff",
        5: "Wrong file edited - Model edited different file than expected",
        6: "Wrong tool call - Model used wrong tool type",
        7: "Wrong file edited - Model targeted incorrect file path",
        8: "API/Stream error - Problem with model API connection",
        9: "Configuration error - Invalid evaluation parameters",
        10: "Function error - Invalid parsing/diff functions",
        11: "Other error - Unexpected failure"
    }
    
    base_description = error_map.get(error_enum, f"Unknown error (code: {error_enum})")
    
    if error_string:
        return f"{base_description}: {error_string}"
    return base_description

def get_error_guidance(error_enum):
    """Provide specific guidance based on error type"""
    guidance_map = {
        1: "💡 The model provided a response but didn't use the replace_in_file tool. Check the raw output to see what the model actually said.",
        2: "💡 The model called multiple tools when it should only call replace_in_file once. Check the parsed tool call section.",
        3: "💡 The model used a different tool instead of replace_in_file. This might indicate confusion about the task.",
        4: "💡 The model called replace_in_file but didn't provide the required 'path' or 'diff' parameters.",
        5: "💡 The model tried to edit a different file than expected. Check the parsed tool call to see which file it targeted.",
        6: "💡 The model used the wrong tool type. Check the raw output to see what tool it attempted to use.",
        7: "💡 The model tried to edit a different file path than expected. This could indicate path confusion or hallucination.",
    }
    
    return guidance_map.get(error_enum, "")

def render_hero_section(current_run, model_performance):
    """Render the hero section with key metrics"""
    run_title = current_run['description'] if current_run['description'] else f"Run {current_run['run_id'][:8]}..."
    st.markdown(f"""
    <div class="hero-container">
        <div class="hero-title">Diff Edit Evaluation Results</div>
        <div class="hero-subtitle">A comprehensive analysis of model performance on code editing tasks.</div>
        <div class="hero-subtitle" style="font-size: 0.9rem; margin-top: 10px;">
            <strong>Current Run:</strong> {run_title} • {current_run['created_at']}
        </div>
    </div>
    """, unsafe_allow_html=True)
    
    # Key metrics row
    col1, col2, col3, col4 = st.columns(4)
    
    total_results = model_performance['total_results'].sum()
    overall_success = model_performance['success_rate'].mean()
    total_cost = model_performance['total_cost'].sum()
    avg_latency = model_performance['avg_round_trip_ms'].mean()
    
    with col1:
        st.markdown(f"""
        <div class="custom-metric">
            <div class="custom-metric-value">{len(model_performance)}</div>
            <div class="custom-metric-label">Models Tested</div>
        </div>
        """, unsafe_allow_html=True)
    
    with col2:
        st.markdown(f"""
        <div class="custom-metric">
            <div class="custom-metric-value">{total_results}</div>
            <div class="custom-metric-label">Valid Results</div>
        </div>
        """, unsafe_allow_html=True)
    
    with col3:
        success_color = "#10b981" if overall_success > 0.8 else "#f59e0b" if overall_success > 0.6 else "#ef4444"
        st.markdown(f"""
        <div class="custom-metric">
            <div class="custom-metric-value" style="color: {success_color}">{overall_success:.1%}</div>
            <div class="custom-metric-label">Avg Success Rate</div>
        </div>
        """, unsafe_allow_html=True)
    
    with col4:
        st.markdown(f"""
        <div class="custom-metric">
            <div class="custom-metric-value">${total_cost:.3f}</div>
            <div class="custom-metric-label">Total Cost</div>
        </div>
        """, unsafe_allow_html=True)

def render_model_comparison_cards(model_performance):
    """Render beautiful model comparison cards"""
    st.markdown("## Model Leaderboard")
    
    # Find best performer
    best_model = model_performance.iloc[0]['model_id']
    
    for idx, model in model_performance.iterrows():
        is_best = model['model_id'] == best_model
        grade, grade_class = get_performance_grade(model['success_rate'])
        
        # Create a container for each model
        with st.container():
            col1, col2 = st.columns([3, 1])
            
            with col1:
                # Use Streamlit's native components instead of raw HTML
                if is_best:
                    st.success(f"**{model['model_id']}** - Best Performer")
                else:
                    st.info(f"**{model['model_id']}**")
                
                # Success rate with color coding
                success_rate = model['success_rate']
                if success_rate >= 0.8:
                    st.success(f"**Success Rate:** {success_rate:.1%} ({grade})")
                elif success_rate >= 0.6:
                    st.warning(f"**Success Rate:** {success_rate:.1%} ({grade})")
                else:
                    st.error(f"**Success Rate:** {success_rate:.1%} ({grade})")
                
                # Metrics in columns
                metric_col1, metric_col2, metric_col3, metric_col4 = st.columns(4)
                
                with metric_col1:
                    if pd.notna(model['avg_round_trip_ms']):
                        st.metric("Avg Latency", f"{model['avg_round_trip_ms']:.0f}ms")
                    else:
                        st.metric("Avg Latency", "N/A")
                
                with metric_col2:
                    if pd.notna(model['avg_cost']):
                        st.metric("Avg Cost", f"${model['avg_cost']:.4f}")
                    else:
                        st.metric("Avg Cost", "N/A")
                
                with metric_col3:
                    st.metric("Valid Results", f"{model['total_results']}")
                
                with metric_col4:
                    if pd.notna(model['avg_first_token_ms']):
                        st.metric("First Token", f"{model['avg_first_token_ms']:.0f}ms")
                    else:
                        st.metric("First Token", "N/A")
            
            with col2:
                st.write("")  # Add some spacing
                if st.button(f"Drill Down", key=f"drill_{model['model_id']}", use_container_width=True):
                    st.session_state.drill_down_model = model['model_id']
                    # Update URL with model_id for drill down
                    st.query_params["model_id"] = model['model_id']
                    st.rerun()
            
            st.divider()  # Add a divider between models

def render_comparison_charts(model_performance):
    """Render interactive comparison charts"""
    st.markdown("## Performance Analysis")
    
    col1, col2 = st.columns(2)

    with col1:
        # Time to First Edit
        fig_first_edit = px.bar(
            model_performance,
            x='model_id',
            y='avg_first_edit_ms',
            title="Time to First Edit",
            labels={'avg_first_edit_ms': 'Time to First Edit (ms)', 'model_id': 'Model'},
            color='avg_first_edit_ms',
            color_continuous_scale='bluered',
            text='avg_first_edit_ms',
            template='plotly_dark'
        )
        fig_first_edit.update_traces(texttemplate='%{text:.0f}ms', textposition='outside')
        fig_first_edit.update_layout(
            showlegend=False,
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(family="Azeret Mono, monospace"),
            margin=dict(t=50)
        )
        st.plotly_chart(fig_first_edit, use_container_width=True)

    with col2:
        # Latency vs Cost Scatter
        fig_scatter = px.scatter(
            model_performance,
            x='avg_round_trip_ms',
            y='avg_cost',
            size='total_results',
            color='success_rate',
            hover_name='model_id',
            title="Latency vs Cost Analysis",
            labels={
                'avg_round_trip_ms': 'Avg Round Trip (ms)',
                'avg_cost': 'Avg Cost ($)',
                'success_rate': 'Success Rate',
                'total_results': 'Valid Results'
            },
            color_continuous_scale='RdYlGn',
            template='plotly_dark'
        )
        fig_scatter.update_layout(
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(family="Azeret Mono, monospace")
        )
        st.plotly_chart(fig_scatter, use_container_width=True)

def render_detailed_analysis(run_id, model_id):
    """Render detailed drill-down analysis"""
    st.markdown(f"## Detailed Analysis: {model_id}")
    
    # Load all results (including invalid attempts)
    detailed_results = load_detailed_results(run_id, model_id)
    
    # Also load only valid results for metrics
    valid_results = load_detailed_results(run_id, model_id, valid_only=True)
    
    if detailed_results.empty:
        st.warning("No detailed results found.")
        return
    
    # Show total vs valid results
    st.info(f"Showing all {len(detailed_results)} results ({len(valid_results)} valid, {len(detailed_results) - len(valid_results)} invalid)")
    
    # Results overview
    col1, col2, col3 = st.columns(3)
    
    with col1:
        success_count = valid_results['succeeded'].sum()
        total_count = len(valid_results)
        st.metric("Success Rate", f"{success_count}/{total_count} ({success_count/total_count:.1%} of valid results)")
    
    with col2:
        avg_latency = detailed_results['time_round_trip_ms'].mean()
        st.metric("Avg Latency", f"{avg_latency:.0f}ms")
    
    with col3:
        total_cost = detailed_results['cost_usd'].sum()
        st.metric("Total Cost", f"${total_cost:.4f}")
    
    # Interactive results table
    st.markdown("### 📋 Individual Results")
    
    # Add result selector with indicators for valid/invalid attempts
    result_options = []
    for idx, row in detailed_results.iterrows():
        # Check if this is a valid result
        is_valid = (row['error_enum'] not in [1, 6, 7]) if not pd.isna(row['error_enum']) else True
        
        # Create status indicator
        if is_valid:
            status = "✅" if row['succeeded'] else "❌"
        else:
            status = "⚠️"  # Warning symbol for invalid results
            
        # Add validity indicator to the option text
        validity_text = "" if is_valid else " [INVALID RESULT]"
        result_options.append(f"{status} {row['task_id']} - {row['time_round_trip_ms']:.0f}ms{validity_text}")
    
    selected_result_idx = st.selectbox(
        "Select a result to analyze:",
        range(len(result_options)),
        format_func=lambda x: result_options[x]
    )
    
    if selected_result_idx is not None:
        render_result_detail(detailed_results.iloc[selected_result_idx])

def render_result_detail(result):
    """Render detailed view of a single result"""
    st.markdown("### 🔬 Result Deep Dive")
    
    # Check if this is a valid result (only invalid if no tool calls or wrong file)
    is_valid = True
    if not pd.isna(result['error_enum']):
        # Only these specific errors make a result "invalid" for the benchmark:
        # 1 = no_tool_calls, 5 = wrong_file_edited, 7 = wrong_file_edited
        is_valid = result['error_enum'] not in [1, 5, 7]
    
    # Show validity warning if needed
    if not is_valid:
        st.warning("⚠️ **This is an invalid result** - The model didn't call the replace_in_file tool or edited the wrong file. This result is excluded from success rate calculations.")
    
    # Result metadata
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        status_icon = "✅" if result['succeeded'] else "❌"
        st.markdown(f"**Status:** {status_icon} {'Success' if result['succeeded'] else 'Failed'}")
    
    with col2:
        st.markdown(f"**Task ID:** {result['task_id']}")
    
    with col3:
        st.markdown(f"**Round Trip:** {result['time_round_trip_ms']:.0f}ms")
    
    with col4:
        if pd.notna(result['cost_usd']) and result['cost_usd'] is not None:
            st.markdown(f"**Cost:** ${result['cost_usd']:.4f}")
        else:
            st.markdown(f"**Cost:** Free")
    
    # Tabbed interface for different views
    tab1, tab2, tab3, tab4 = st.tabs(["📄 File & Edits", "🤖 Raw Output", "🔧 Parsed Tool Call", "📊 Metrics"])
    
    with tab1:
        render_file_and_edits_view(result)
    
    with tab2:
        render_raw_output_view(result)
    
    with tab3:
        render_parsed_tool_call_view(result)
    
    with tab4:
        render_metrics_view(result)

def render_file_and_edits_view(result):
    """Render side-by-side file and edits view"""
    st.markdown("#### 📄 File Content & Edit Analysis")
    
    # Check if we have original file content
    has_original = not pd.isna(result['original_file_content']) and result['original_file_content']
    has_edited = not pd.isna(result['edited_file_content']) and result['edited_file_content']
    
    if not has_original and not has_edited:
        st.warning("No file content available for this result.")
        return
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**Original File:**")
        if has_original:
            filepath = result['original_filepath'] if not pd.isna(result['original_filepath']) else 'Unknown file'
            st.markdown(f"📁 `{filepath}`")
            
            # Display full original file content in a scrollable code block
            with st.expander("View Original File Content", expanded=True):
                # Prepare content for the copy button (needs JS-specific escaping)
                raw_content_for_copy = result['original_file_content']
                # Escape for JavaScript template literal: backticks, backslashes, newlines
                js_escaped_content = raw_content_for_copy.replace('\\', '\\\\') \
                                                       .replace('`', '\\`') \
                                                       .replace('\r\n', '\\n') \
                                                       .replace('\n', '\\n') \
                                                       .replace('\r', '\\n')

                unique_suffix = str(result.name if hasattr(result, 'name') else result['task_id']).replace('-', '_').replace('.', '_')
                button_id = f"copyBtnOriginal_{unique_suffix}"
                
                copy_button_html = f"""
                    <button id="{button_id}" onclick="copyOriginalToClipboard(`{js_escaped_content}`, '{button_id}')" style="margin-bottom: 10px; padding: 5px 10px; border-radius: 5px; border: 1px solid #ccc; cursor: pointer;">Copy Original File</button>
                    <script>
                        if (!window.copyOriginalToClipboard) {{
                            window.copyOriginalToClipboard = async function(text, buttonId) {{
                                try {{
                                    await navigator.clipboard.writeText(text);
                                    const button = document.getElementById(buttonId);
                                    button.innerText = 'Copied!';
                                    button.style.backgroundColor = '#d4edda'; // Optional: success feedback
                                    setTimeout(() => {{ 
                                        button.innerText = 'Copy Original File'; 
                                        button.style.backgroundColor = '';
                                    }}, 2000);
                                }} catch (err) {{
                                    console.error('Failed to copy original: ', err);
                                    const button = document.getElementById(buttonId);
                                    button.innerText = 'Copy Failed!';
                                    button.style.backgroundColor = '#f8d7da'; // Optional: error feedback
                                    setTimeout(() => {{ 
                                        button.innerText = 'Copy Original File'; 
                                        button.style.backgroundColor = '';
                                    }}, 2000);
                                }}
                            }}
                        }}
                    </script>
                    """
                st.components.v1.html(copy_button_html, height=50)

                # Prepare content for st.code (needs actual newlines)
                content_for_display = result['original_file_content']
                # Iteratively replace common escaped newline sequences with actual newlines
                # This handles cases like "\\n" -> "\n" and then "\n" (if it was literally "\n")
                # Order might matter if there are multiple levels of escaping, but this covers common ones.
                content_for_display = content_for_display.replace('\\\\r\\\\n', '\r\n').replace('\\\\n', '\n') # Double escaped
                content_for_display = content_for_display.replace('\\r\\n', '\r\n').replace('\\n', '\n')     # Single escaped

                language = guess_language_from_filepath(filepath)
                st.code(content_for_display, language=language, line_numbers=False)

        else:
            st.warning("Original file content not available")
    
    with col2:
        st.markdown("**Edit Analysis:**")
        
        if not result['succeeded']:
            # Show error information
            st.error("❌ **Edit Failed**")
            
            # Show detailed error reason
            if not pd.isna(result['error_enum']):
                error_description = get_error_description(
                    result['error_enum'], 
                    result.get('error_string')
                )
                st.markdown(f"**Reason:** {error_description}")
                
                # Show specific guidance based on error type
                guidance = get_error_guidance(result['error_enum'])
                if guidance:
                    st.info(guidance)
            
            # For valid results that failed, check for diff application failures
            elif not result['succeeded']:
                # This is a valid result that failed - likely due to diff application issues
                raw_output = result.get('raw_model_output', '')
                
                # Check if we have specific error information in the raw output
                if 'does not match anything in the file' in str(raw_output).lower():
                    st.warning("⚠️ **Diff Application Failed**")
                    st.info("💡 The SEARCH block in the diff didn't match any content in the original file. This usually means the model hallucinated code that doesn't exist.")
                elif 'malformatted' in str(raw_output).lower() or 'malformed' in str(raw_output).lower():
                    st.warning("⚠️ **Diff Format Error**")
                    st.info("💡 The diff format was incorrect. Check the raw tool call to see the formatting issues.")
                elif 'error:' in str(raw_output).lower():
                    # Try to extract the specific error message
                    lines = str(raw_output).split('\n')
                    error_lines = [line for line in lines if 'error:' in line.lower()]
                    if error_lines:
                        error_msg = error_lines[0].strip()
                        st.warning("⚠️ **Diff Application Failed**")
                        st.info(f"💡 {error_msg}")
                    else:
                        st.warning("⚠️ **Diff Application Failed**")
                        st.info("💡 The diff couldn't be applied to the original file. Check the raw output and parsed tool call for more details.")
                else:
                    # Generic diff application failure
                    st.warning("⚠️ **Diff Application Failed**")
                    st.info("💡 The model made a valid tool call but the diff couldn't be applied to the original file. This usually indicates a mismatch between the expected and actual file content.")
        else:
            # Show successful edit information
            st.success("✅ **Edit Successful**")
            
            # Show edit metrics
            metric_col1, metric_col2, metric_col3 = st.columns(3)
            
            with metric_col1:
                if not pd.isna(result['num_edits']):
                    st.metric("Edits", int(result['num_edits']))
            
            with metric_col2:
                if not pd.isna(result['num_lines_added']):
                    st.metric("Added", int(result['num_lines_added']))
            
            with metric_col3:
                if not pd.isna(result['num_lines_deleted']):
                    st.metric("Deleted", int(result['num_lines_deleted']))
            
            # Show edited file if available
            if has_edited:
                st.markdown("**Edited File:**")
                with st.expander("View Edited File Content"):
                    edited_lines = result['edited_file_content'].split('\n')
                    for i, line in enumerate(edited_lines[:50], 1):
                        st.text(f"{i:3d} | {line}")
                    
                    if len(edited_lines) > 50:
                        st.text(f"... ({len(edited_lines) - 50} more lines)")
        
        # Show raw and parsed tool calls if available
        if not pd.isna(result['parsed_tool_call_json']):
            with st.expander("View Raw Tool Call"):
                # Extract the raw tool call text from the model output
                raw_output = result['raw_model_output'] if not pd.isna(result['raw_model_output']) else ""
                
                # Try to extract just the tool call portion
                if raw_output and '<replace_in_file>' in raw_output:
                    # Find the tool call block
                    start_idx = raw_output.find('<replace_in_file>')
                    end_idx = raw_output.find('</replace_in_file>') + len('</replace_in_file>')
                    if start_idx != -1 and end_idx != -1:
                        raw_tool_call = raw_output[start_idx:end_idx]
                        st.code(raw_tool_call, language='xml')
                    else:
                        st.text("Tool call not found in raw output")
                else:
                    st.text("No raw tool call available")
            
            with st.expander("View Parsed Tool Call"):
                try:
                    parsed_call = json.loads(result['parsed_tool_call_json'])
                    st.json(parsed_call)
                except:
                    st.text(result['parsed_tool_call_json'])

def render_raw_output_view(result):
    """Render raw model output"""
    st.markdown("#### 🤖 Raw Model Output")
    
    if pd.isna(result['raw_model_output']) or not result['raw_model_output']:
        st.warning("No raw output available for this result.")
        return
    
    st.markdown("""
    <div class="file-viewer">
    """, unsafe_allow_html=True)
    
    st.text(result['raw_model_output'])
    
    st.markdown("</div>", unsafe_allow_html=True)

def render_parsed_tool_call_view(result):
    """Render parsed tool call analysis"""
    st.markdown("#### 🔧 Parsed Tool Call Analysis")
    
    if pd.isna(result['parsed_tool_call_json']) or not result['parsed_tool_call_json']:
        st.warning("No parsed tool call available for this result.")
        return
    
    try:
        parsed_call = json.loads(result['parsed_tool_call_json'])
        
        # Pretty print the JSON
        st.json(parsed_call)
        
        # If it's a replace_in_file call, show the diff blocks
        if isinstance(parsed_call, dict) and 'diff' in parsed_call:
            st.markdown("**Diff Blocks:**")
            st.code(parsed_call['diff'], language='diff')
            
    except json.JSONDecodeError:
        st.markdown("**Raw Parsed Call (Invalid JSON):**")
        st.text(result['parsed_tool_call_json'])

def render_metrics_view(result):
    """Render detailed metrics for the result"""
    st.markdown("#### 📊 Detailed Metrics")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**Timing Metrics:**")
        if not pd.isna(result['time_to_first_token_ms']):
            st.metric("Time to First Token", f"{result['time_to_first_token_ms']:.0f}ms")
        
        if not pd.isna(result['time_to_first_edit_ms']):
            st.metric("Time to First Edit", f"{result['time_to_first_edit_ms']:.0f}ms")
        
        if not pd.isna(result['time_round_trip_ms']):
            st.metric("Round Trip Time", f"{result['time_round_trip_ms']:.0f}ms")
    
    with col2:
        st.markdown("**Token & Cost Metrics:**")
        if not pd.isna(result['completion_tokens']):
            st.metric("Completion Tokens", int(result['completion_tokens']))
        
        if pd.notna(result['cost_usd']) and result['cost_usd'] is not None:
            st.metric("Cost", f"${result['cost_usd']:.4f}")
        else:
            st.metric("Cost", "Free")
        
        if not pd.isna(result['tokens_in_context']):
            st.metric("Context Tokens", int(result['tokens_in_context']))

def guess_language_from_filepath(filepath):
    """Guess the language for syntax highlighting from filepath."""
    if not filepath or pd.isna(filepath):
        return None
    
    extension_map = {
        '.py': 'python',
        '.js': 'javascript',
        '.ts': 'typescript',
        '.java': 'java',
        '.cs': 'csharp',
        '.cpp': 'cpp',
        '.c': 'c',
        '.html': 'html',
        '.css': 'css',
        '.json': 'json',
        '.sql': 'sql',
        '.md': 'markdown',
        '.rb': 'ruby',
        '.php': 'php',
        '.go': 'go',
        '.rs': 'rust',
        '.swift': 'swift',
        '.kt': 'kotlin',
        '.sh': 'bash',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.xml': 'xml',
    }
    
    _, ext = os.path.splitext(filepath)
def main():
    # Add a note about valid attempts
    st.sidebar.markdown("""
    ### Note on Metrics
    Success rates are calculated based on **valid results only**. 
    
    Invalid results (where the model didn't call the diff edit tool or edited the wrong file) are excluded from calculations.
    """)
    
    # Initialize session state
    if 'drill_down_model' not in st.session_state:
        st.session_state.drill_down_model = None
    if 'selected_run_id' not in st.session_state:
        st.session_state.selected_run_id = None
    
    # Handle URL parameters for direct linking
    query_params = st.query_params
    url_run_id = query_params.get("run_id")
    url_model_id = query_params.get("model_id")
    
    # Load all runs for sidebar
    all_runs = load_all_runs()
    
    if all_runs.empty:
        st.error("No evaluation runs found in the database.")
        st.stop()
    
    # Set initial run selection from URL or default to latest
    if url_run_id and url_run_id in all_runs['run_id'].values:
        if st.session_state.selected_run_id != url_run_id:
            st.session_state.selected_run_id = url_run_id
            st.session_state.drill_down_model = None  # Reset drill down when changing runs via URL
    elif st.session_state.selected_run_id is None:
        st.session_state.selected_run_id = all_runs.iloc[0]['run_id']  # Default to latest
    
    # Set drill down model from URL
    if url_model_id and st.session_state.selected_run_id == url_run_id:
        st.session_state.drill_down_model = url_model_id
    
    # Sidebar for run selection
    with st.sidebar:
        st.markdown("## 📊 Evaluation Runs")
        st.markdown("Select a run to analyze:")
        
        # Create run options with nice formatting
        run_options = []
        run_ids = []
        
        for idx, run in all_runs.iterrows():
            # Format the run description nicely
            date_str = run['created_at'][:10]  # Get just the date part
            time_str = run['created_at'][11:16]  # Get just the time part
            
            if run['description']:
                display_name = f"🚀 {run['description']}"
            else:
                display_name = f"📅 Run {run['run_id'][:8]}..."
            
            run_options.append(f"{display_name}\n📅 {date_str} {time_str}")
            run_ids.append(run['run_id'])
        
        # Default to latest run if no selection
        if st.session_state.selected_run_id is None:
            default_index = 0  # Latest run is first
            st.session_state.selected_run_id = run_ids[0]
        else:
            try:
                default_index = run_ids.index(st.session_state.selected_run_id)
            except ValueError:
                default_index = 0
                st.session_state.selected_run_id = run_ids[0]
        
        selected_run_idx = st.selectbox(
            "Choose run:",
            range(len(run_options)),
            format_func=lambda x: run_options[x],
            index=default_index,
            key="run_selector"
        )
        
        # Update selected run if changed
        if run_ids[selected_run_idx] != st.session_state.selected_run_id:
            st.session_state.selected_run_id = run_ids[selected_run_idx]
            st.session_state.drill_down_model = None  # Reset drill down when changing runs
            # Update URL with new run_id
            st.query_params["run_id"] = st.session_state.selected_run_id
            if "model_id" in st.query_params:
                del st.query_params["model_id"]  # Clear model_id when changing runs
            st.rerun()
        
        # Show run details in sidebar
        selected_run = all_runs.iloc[selected_run_idx]
        st.markdown("---")
        st.markdown("### 📋 Run Details")
        st.markdown(f"**Run ID:** `{selected_run['run_id'][:12]}...`")
        st.markdown(f"**Created:** {selected_run['created_at']}")
        if selected_run['description']:
            st.markdown(f"**Description:** {selected_run['description']}")
        
        # Show shareable URL
        st.markdown("---")
        st.markdown("### 🔗 Share This View")
        
        # Build current URL
        # Dynamically derive the base URL
        try:
            # For older Streamlit versions
            server_address = st.server.server_address
            server_port = st.server.server_port
        except AttributeError:
            # Fallback for newer Streamlit versions where st.server is removed
            # We can't reliably get the server address/port from within the script anymore.
            # We'll default to localhost and the default port.
            # The user can see the correct network URL in the terminal.
            server_address = "localhost"
            server_port = 8501
        
        base_url = f"http://{server_address}:{server_port}"
        current_url = f"{base_url}/?run_id={st.session_state.selected_run_id}"
        if st.session_state.drill_down_model:
            current_url += f"&model_id={st.session_state.drill_down_model}"
        
        st.markdown("**Current URL:**")
        st.code(current_url, language=None)
        
        # Copy button using HTML/JS
        copy_button_html = f"""
        <button onclick="copyToClipboard('{current_url}')" style="
            padding: 8px 16px; 
            border-radius: 5px; 
            border: 1px solid #ccc; 
            background: #f0f2f6;
            cursor: pointer;
            font-size: 14px;
            margin-top: 5px;
        ">📋 Copy Link</button>
        <script>
            function copyToClipboard(text) {{
                navigator.clipboard.writeText(text).then(function() {{
                    // Success feedback
                    event.target.innerText = '✅ Copied!';
                    event.target.style.backgroundColor = '#d4edda';
                    setTimeout(() => {{ 
                        event.target.innerText = '📋 Copy Link'; 
                        event.target.style.backgroundColor = '#f0f2f6';
                    }}, 2000);
                }}, function(err) {{
                    // Error feedback
                    event.target.innerText = '❌ Failed';
                    event.target.style.backgroundColor = '#f8d7da';
                    setTimeout(() => {{ 
                        event.target.innerText = '📋 Copy Link'; 
                        event.target.style.backgroundColor = '#f0f2f6';
                    }}, 2000);
                }});
            }}
        </script>
        """
        st.components.v1.html(copy_button_html, height=50)
    
    # Load data for selected run
    current_run, model_performance = load_run_comparison(st.session_state.selected_run_id)
    
    if current_run is None or model_performance.empty:
        st.error("No data found for the selected run.")
        st.stop()
    
    # Render main dashboard
    render_hero_section(current_run, model_performance)
    
    # Check if we're in drill-down mode
    if st.session_state.drill_down_model:
        col1, col2 = st.columns([1, 4])
        with col1:
            if st.button("Back to Overview", use_container_width=True):
                st.session_state.drill_down_model = None
                # Clear model_id from URL when going back to overview
                if "model_id" in st.query_params:
                    del st.query_params["model_id"]
                st.rerun()
        
        render_detailed_analysis(current_run['run_id'], st.session_state.drill_down_model)
    else:
        # Success Rate Comparison
        fig_success = px.bar(
            model_performance,
            x='model_id',
            y='success_rate',
            title="Success Rate by Model",
            labels={'success_rate': 'Success Rate', 'model_id': 'Model'},
            color='success_rate',
            color_continuous_scale='RdYlGn',
            text='success_rate',
            template='plotly_dark'
        )
        fig_success.update_traces(texttemplate='%{text:.1%}', textposition='outside')
        fig_success.update_layout(
            showlegend=False,
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(family="Azeret Mono, monospace"),
            yaxis_range=[0,1],  # Set y-axis from 0% to 100%
            margin=dict(t=50)  # Add top margin to prevent clipping
        )
        st.plotly_chart(fig_success, use_container_width=True)
        
        render_model_comparison_cards(model_performance)
        render_comparison_charts(model_performance)

if __name__ == "__main__":
    main()
