import streamlit as st
import pandas as pd
import json
import os # Need to import os for load_case_raw_data
from utils import get_database_connection, guess_language_from_filepath # Absolute import

st.set_page_config(
    page_title="Case Health Inspector",
    page_icon="🧑‍⚕️",
    layout="wide"
)

st.title("Case Health Inspector")
st.markdown("Identify test cases that are frequently problematic across different models and runs.")

@st.cache_data
def load_problematic_cases_summary():
    conn = get_database_connection()
    query = """
    WITH case_attempts AS (
        SELECT
            c.task_id,
            c.description AS case_description,
            f_orig.filepath AS original_filepath, -- Get from files table
            r.run_id,
            r.model_id,
            r.result_id,
            (CASE WHEN (r.error_enum NOT IN (1, 6, 7) OR r.error_enum IS NULL) THEN 1 ELSE 0 END) AS is_valid_attempt,
            (CASE WHEN (r.error_enum NOT IN (1, 6, 7) OR r.error_enum IS NULL) THEN r.succeeded ELSE NULL END) AS succeeded_on_valid
        FROM cases c
        JOIN results r ON c.case_id = r.case_id
        LEFT JOIN files f_orig ON c.file_hash = f_orig.hash -- Join to get original filepath
    ),
    case_summary AS (
        SELECT
            task_id,
            case_description,
            original_filepath, -- This is now f_orig.filepath
            COUNT(DISTINCT run_id) AS num_benchmark_runs,
            COUNT(result_id) AS total_attempts,
            SUM(is_valid_attempt) AS total_valid_attempts,
            SUM(succeeded_on_valid) AS total_successful_valid_attempts
        FROM case_attempts
        GROUP BY task_id, case_description, original_filepath -- original_filepath is f_orig.filepath
    )
    SELECT
        task_id,
        case_description,
        original_filepath, -- This is f_orig.filepath from case_summary
        num_benchmark_runs,
        total_attempts,
        total_valid_attempts,
        CAST(total_valid_attempts AS REAL) * 100.0 / total_attempts AS percent_valid_attempts,
        CASE 
            WHEN total_valid_attempts > 0 THEN CAST(total_successful_valid_attempts AS REAL) * 100.0 / total_valid_attempts
            ELSE 0 
        END AS success_rate_on_valid
    FROM case_summary
    ORDER BY percent_valid_attempts ASC, success_rate_on_valid ASC;
    """
    df = pd.read_sql_query(query, conn)
    return df

@st.cache_data
def load_case_raw_data(task_id):
    """Loads the original JSON data for a given task_id."""
    # This assumes test cases are stored in ../cases relative to this script's parent (dashboard)
    # So, ../../cases from this script's location (pages/02_Bad_Cases.py)
    # Correct path from this script (pages/02_Bad_Cases.py) to cases/
    # os.path.dirname(__file__) -> pages
    # os.path.join(..., '..') -> dashboard
    # os.path.join(..., '..', '..') -> diff-edits
    # os.path.join(..., '..', '..', 'cases') -> diff-edits/cases
    cases_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'cases')
    
    # The task_id is usually the filename without .json
    # However, some task_ids might have suffixes or be different.
    # We need a robust way to find the file. For now, assume task_id is filename base.
    # This might need adjustment if task_id format varies significantly from filename.
    
    # Try direct match first
    potential_filename = f"{task_id}.json"
    filepath = os.path.join(cases_dir, potential_filename)

    if not os.path.exists(filepath):
        # If direct match fails, list files and try to find one that starts with task_id
        # This is a simple fallback, might need more robust matching if task_ids are complex
        try:
            for f_name in os.listdir(cases_dir):
                if f_name.startswith(task_id) and f_name.endswith(".json"):
                    filepath = os.path.join(cases_dir, f_name)
                    break
            else: # No break means no file found
                 return None # File not found
        except FileNotFoundError:
            return None # Cases directory itself not found

    if not os.path.exists(filepath): # Check again after potential find
        return None

    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except Exception as e:
        st.error(f"Error loading case file {filepath}: {e}")
        return None

def render_problematic_cases_page():
    summary_df = load_problematic_cases_summary()

    if summary_df.empty:
        st.warning("No case summary data found. Run some evaluations first.")
        return

    st.markdown("### Cases Overview")
    st.dataframe(summary_df.style.format({
        "percent_valid_attempts": "{:.1f}%",
        "success_rate_on_valid": "{:.1f}%"
    }), use_container_width=True)

    st.markdown("---")
    st.markdown("### Case Drill Down")
    
    selected_task_id = st.selectbox(
        "Select a Case ID (task_id) to inspect:",
        options=[""] + summary_df['task_id'].tolist() # Add a blank option
    )

    if selected_task_id:
        case_data = summary_df[summary_df['task_id'] == selected_task_id].iloc[0]
        st.subheader(f"Details for Case: {case_data['task_id']}")
        st.markdown(f"**Description:** {case_data['case_description']}")
        st.markdown(f"**Original Filepath:** `{case_data['original_filepath']}`")
        
        raw_json_data = load_case_raw_data(selected_task_id)
        if raw_json_data:
            with st.expander("View Raw Case JSON Data", expanded=False):
                st.json(raw_json_data)
            
            if 'file_contents' in raw_json_data and raw_json_data['file_contents']:
                with st.expander("View Original File Content (from Case JSON)", expanded=True):
                    # Prepare content for the copy button
                    raw_content_for_copy = raw_json_data['file_contents']
                    js_escaped_content = raw_content_for_copy.replace('\\', '\\\\') \
                                                           .replace('`', '\\`') \
                                                           .replace('\r\n', '\\n') \
                                                           .replace('\n', '\\n') \
                                                           .replace('\r', '\\n')
                    button_id = f"copyBtnCase_{selected_task_id.replace('-', '_').replace('.', '_')}"
                    copy_button_html = f"""
                        <button id="{button_id}" onclick="copyCaseContentToClipboard(`{js_escaped_content}`, '{button_id}')" style="margin-bottom: 10px; padding: 5px 10px; border-radius: 5px; border: 1px solid #ccc; cursor: pointer;">Copy File Content</button>
                        <script>
                            if (!window.copyCaseContentToClipboard) {{
                                window.copyCaseContentToClipboard = async function(text, buttonId) {{
                                    try {{
                                        await navigator.clipboard.writeText(text);
                                        const button = document.getElementById(buttonId);
                                        button.innerText = 'Copied!';
                                        setTimeout(() => {{ button.innerText = 'Copy File Content'; }}, 2000);
                                    }} catch (err) {{ console.error('Failed to copy: ', err); const button = document.getElementById(buttonId); button.innerText = 'Copy Failed!'; setTimeout(() => {{ button.innerText = 'Copy File Content'; }}, 2000); }}
                                }}
                            }}
                        </script>
                        """
                    st.components.v1.html(copy_button_html, height=50)

                    # Prepare content for st.code
                    content_for_display = raw_json_data['file_contents']
                    content_for_display = content_for_display.replace('\\\\r\\\\n', '\r\n').replace('\\\\n', '\n')
                    content_for_display = content_for_display.replace('\\r\\n', '\r\n').replace('\\n', '\n')
                    
                    language = guess_language_from_filepath(case_data['original_filepath'])
                    st.code(content_for_display, language=language, line_numbers=False)
            else:
                st.warning("Original file content not found in case JSON.")
        else:
            st.error(f"Could not load raw JSON data for case: {selected_task_id}")
        
        # Placeholder for more detailed stats (per-model performance on this case, error breakdown)
        st.markdown("*(Further per-model statistics and error breakdowns for this case can be added here.)*")

if __name__ == "__main__":
    render_problematic_cases_page()
