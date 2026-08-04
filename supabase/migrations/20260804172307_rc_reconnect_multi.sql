-- Reconnect Missions needs to support several concurrent missions per
-- district — the whole point of admin batch-assignment is opening a SERIES
-- of them at once (each a different group of agents). The original
-- one-open-per-district unique index assumed a single organic,
-- player-grown mission; that assumption doesn't hold anymore.

drop index if exists rc_reconnect_one_open_per_district;
