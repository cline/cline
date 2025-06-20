import streamlit as st
import sqlite3
import pandas as pd
import os

@st.cache_resource
def get_database_connection():
    # Assuming the script is run from the dashboard directory,
    # evals.db is two levels up from there.
    # __file__ is utils.py, its dirname is dashboard.
    # os.path.dirname(__file__) -> dashboard/
    # os.path.join(..., '..') -> diff-edits/
    # os.path.join(..., '..', 'evals.db') -> diff-edits/evals.db
    db_path = os.path.join(os.path.dirname(__file__), '..', 'evals.db')
    if not os.path.exists(db_path):
        st.error(f"Database not found. Expected at: {os.path.abspath(db_path)}")
        st.stop()
    return sqlite3.connect(db_path, check_same_thread=False)

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
    
    _, ext = os.path.splitext(str(filepath)) # Ensure filepath is string
    return extension_map.get(ext.lower(), None)
