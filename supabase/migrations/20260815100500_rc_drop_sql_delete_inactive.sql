-- 053 added rc_delete_inactive_agents() as a raw-SQL cascade delete, but
-- admin-agent.ts's adminDeleteAgent() already does this correctly (and more
-- completely — it also clears rc_reconnect_missions.created_by and nulls
-- invited_by, which the SQL version missed). Keeping both would mean two
-- delete implementations that can silently drift out of sync with each
-- other as the schema changes. Dropping the SQL one; the automatic cleanup
-- (see the new adminDeleteInactiveAgents in admin-agent.ts) now calls
-- adminDeleteAgent per candidate instead. rc_inactive_agent_candidates()
-- (the read-only "who qualifies" query) is unaffected and still the single
-- source of truth for who's 14+ days inactive on Bomb charging.

drop function if exists rc_delete_inactive_agents(int);
