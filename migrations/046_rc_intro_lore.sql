-- Canonical Chapter 1 opening copy. Short, player-friendly beats explain the
-- ARMY Bomb loop without turning the introduction into a technical manual.
insert into rc_config (key, value) values
('intro', '{
  "title": "INCOMING TRANSMISSION",
  "chapter": "Operation ReConnect",
  "welcome": "Welcome, Agent.",
  "securityNotice": "Your Agent Number is classified. Never reveal it — not every signal on this grid is friendly.",
  "body": "After the old tracking network collapsed, HT lost contact with hundreds of agents worldwide.\n\nTo ReConnect them, HT built a new intelligence network called BOTZ, powered by ARMY Bombs. But its signal is unstable.\n\nEvery stream you log restores a piece of the network.\n\nWhen your ARMY Bomb loses power, parts of the city go dark again.\n\nStream to earn Charge Cells.\nUse them to keep your ARMY Bomb glowing.\n\nRestore the city.\nFind the missing agents.\nReConnect the network.\n\nWelcome to Operation ReConnect."
}')
on conflict (key) do update set value = excluded.value;
