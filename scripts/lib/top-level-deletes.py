#!/usr/bin/env python
"""Count DELETE / TRUNCATE statements that would run when a migration is
APPLIED, ignoring the ones inside function bodies.

A DELETE inside `create function ... $$ ... $$` only runs when that function is
called, which for rc_purge_agent_data is the entire point. A DELETE at the top
level runs the moment the migration lands. Only the second kind tells you
whether a migration is inert, so the dollar-quoted blocks are stripped first.

Prints the count on the first line, then up to three offending statements.

    python scripts/lib/top-level-deletes.py <file.sql>
"""
import io
import re
import sys

if len(sys.argv) < 2:
    print(0)
    raise SystemExit(0)

try:
    sql = io.open(sys.argv[1], encoding='utf-8').read()
except OSError:
    # Unreadable is not "clean" — report it as a hit so the caller stops.
    print(1)
    print('        could not read %s' % sys.argv[1])
    raise SystemExit(0)

# Drop $$ ... $$ and $tag$ ... $tag$ bodies, then line comments.
sql = re.sub(r'\$[A-Za-z_]*\$.*?\$[A-Za-z_]*\$', ' ', sql, flags=re.S)
sql = re.sub(r'--[^\n]*', '', sql)

hits = [m.group(0).strip() for m in
        re.finditer(r'(?im)^[ \t]*(?:delete[ \t]+from|truncate)\b.*', sql)]

print(len(hits))
for h in hits[:3]:
    print('        ' + h[:90])
