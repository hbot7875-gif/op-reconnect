-- A 'connect' reconnect mission can now carry a second phase after the
-- streaming target is hit: a sequence of team ciphers the whole group
-- solves together (any joined participant may submit), before the mission
-- actually completes. See reconnect-missions.ts's refreshMission() and the
-- new submitReconnectMissionCipherAnswer().
--
-- phase stays 'streaming' for every mission without a ciphers config (the
-- vast majority) — refreshMission only ever moves it to 'cipher' when the
-- goal's config.ciphers is non-empty, and jumps straight to 'complete' as
-- before otherwise. Existing rows are unaffected by the default.

alter table rc_reconnect_missions
  add column if not exists phase text not null default 'streaming',
  add column if not exists cipher_index int not null default 0,
  add column if not exists cipher_attempts_left int not null default 3;
