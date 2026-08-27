use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_focuscanvas_core_tables",
            sql: r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS diagrams (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    scene_data TEXT NOT NULL DEFAULT '{}',
                    thumbnail BLOB,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'open',
                    priority INTEGER NOT NULL DEFAULT 0,
                    estimated_minutes INTEGER,
                    due_at INTEGER,
                    linked_diagram_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    completed_at INTEGER,
                    FOREIGN KEY (linked_diagram_id) REFERENCES diagrams(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS focus_sessions (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_id TEXT,
                    planned_seconds INTEGER NOT NULL,
                    actual_seconds INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'running',
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_diagrams_updated_at
                    ON diagrams(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_tasks_status_due_at
                    ON tasks(status, due_at);
                CREATE INDEX IF NOT EXISTS idx_focus_sessions_task_id
                    ON focus_sessions(task_id);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_focus_pause_state",
            sql: r#"
                ALTER TABLE focus_sessions ADD COLUMN paused_at INTEGER;
                ALTER TABLE focus_sessions
                    ADD COLUMN paused_total_seconds INTEGER NOT NULL DEFAULT 0;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "group_diagrams_by_main_task",
            sql: r#"
                ALTER TABLE diagrams
                    ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

                UPDATE diagrams
                SET task_id = (
                    SELECT tasks.id
                    FROM tasks
                    WHERE tasks.linked_diagram_id = diagrams.id
                    LIMIT 1
                )
                WHERE task_id IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM tasks
                    WHERE tasks.linked_diagram_id = diagrams.id
                  );

                CREATE INDEX IF NOT EXISTS idx_diagrams_task_id
                    ON diagrams(task_id);
            "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:focuscanvas.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running FocusCanvas");
}
