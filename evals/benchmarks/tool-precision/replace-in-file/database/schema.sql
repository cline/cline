PRAGMA foreign_keys = ON;

CREATE TABLE system_prompts (
    hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE processing_functions (
    hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parsing_function TEXT NOT NULL,
    diff_edit_function TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
    hash TEXT PRIMARY KEY,
    filepath TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    system_prompt_hash TEXT NOT NULL,
    FOREIGN KEY (system_prompt_hash) REFERENCES system_prompts(hash)
);

CREATE TABLE cases (
    case_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT NOT NULL,
    system_prompt_hash TEXT NOT NULL,
    task_id TEXT NOT NULL,
    tokens_in_context INTEGER,
    file_hash TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (system_prompt_hash) REFERENCES system_prompts(hash),
    FOREIGN KEY (file_hash) REFERENCES files(hash)
);

CREATE TABLE results (
    result_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    processing_functions_hash TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL,
    error_enum INTEGER,
    num_edits INTEGER,
    num_lines_deleted INTEGER,
    num_lines_added INTEGER,
    time_to_first_token_ms INTEGER,
    time_to_first_edit_ms INTEGER,
    time_round_trip_ms INTEGER,
    cost_usd REAL,
    completion_tokens INTEGER,
    raw_model_output TEXT,
    file_edited_hash TEXT,
    parsed_tool_call_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES runs(run_id),
    FOREIGN KEY (case_id) REFERENCES cases(case_id),
    FOREIGN KEY (processing_functions_hash) REFERENCES processing_functions(hash)
);

CREATE INDEX idx_results_run_model ON results(run_id, model_id);
CREATE INDEX idx_results_case_model ON results(case_id, model_id);
CREATE INDEX idx_results_success ON results(succeeded);
CREATE INDEX idx_cases_run ON cases(run_id);
CREATE INDEX idx_results_created_at ON results(created_at);
CREATE INDEX idx_runs_created_at ON runs(created_at);
