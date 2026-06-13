import type { Database } from "bun:sqlite";

export function seedDashboardData(db: Database): void {
  db.run(
    `INSERT INTO sessions
      (session_id, project_path, title, status, first_event_at_ms, last_event_at_ms, duration_ms)
     VALUES
      ('ses_1', '/repo-a', 'Alpha', 'active', 1000, 9000, 8000),
      ('ses_2', '/repo-b', 'Beta', 'deleted', 2000, 8000, 6000)`,
  );

  db.run(
    `INSERT INTO messages
      (message_id, event_id, session_id, project_path, model, role, agent,
       input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens,
       cost_usd, lines_added, lines_deleted, files_changed,
       created_at_ms, completed_at_ms, duration_ms, finish_reason, has_error, error_type)
     VALUES
      ('msg_user_1', 'evt_user_1', 'ses_1', '/repo-a', NULL, 'user', 'coder',
       0, 0, 0, 0, 0, 0,
       0, 10, 2, 1,
       3000, NULL, NULL, NULL, 0, NULL),
      ('msg_assistant_1', 'evt_assistant_1', 'ses_1', '/repo-a', 'openai/gpt-4', 'assistant', 'build',
       100, 50, 10, 5, 5, 170,
       0.25, 0, 0, 0,
       4000, 4500, 500, 'stop', 0, NULL),
      ('msg_assistant_2', 'evt_assistant_2', 'ses_2', '/repo-b', 'anthropic/claude', 'assistant', 'build',
       80, 60, 0, 0, 0, 140,
       0.15, 0, 0, 0,
       5000, 5600, 600, 'error', 1, 'ModelError')`,
  );

  db.run(
    `INSERT INTO tool_calls
      (call_id, session_id, tool_name, status, started_at_ms, completed_at_ms, duration_ms, title, error_message)
     VALUES
      ('call_1', 'ses_1', 'bash', 'completed', 6000, 6500, 500, 'listed files', NULL),
      ('call_2', 'ses_2', 'edit', 'error', 7000, 7600, 600, NULL, 'edit failed')`,
  );

  db.run(
    `INSERT INTO events
      (event_id, event_type, session_id, event_contents, created_at_ms)
     VALUES
      ('evt_error_1', 'session.error', 'ses_2', '{"error_type":"SessionError","error_message":"session failed"}', 7500)`,
  );
}
