#!/usr/bin/env python
"""Describe the executable shape of a schedules-only migration.

Stage 2B is supposed to contain three cron.schedule calls and two guards, and
nothing else. This counts what is actually there, ignoring comments, so the
pre-flight can tell whether the file has quietly acquired anything.

Prints one line:  schedule=N unschedule=N destructive=N guards=N other=N

    python scripts/lib/schedules-only-shape.py <file.sql>
"""
import io
import re
import sys

if len(sys.argv) < 2:
    print('schedule=0 unschedule=0 destructive=0 guards=0 other=1')
    raise SystemExit(0)

try:
    sql = io.open(sys.argv[1], encoding='utf-8').read()
except OSError:
    # Unreadable is not "clean" — report something that fails the gate.
    print('schedule=0 unschedule=0 destructive=0 guards=0 other=1')
    raise SystemExit(0)

body = re.sub(r'--[^\n]*', '', sql)

counts = {
    'schedule':    len(re.findall(r'(?im)^[ \t]*select[ \t]+cron\.schedule', body)),
    'unschedule':  len(re.findall(r'(?im)^[ \t]*select[ \t]+cron\.unschedule', body)),
    # Anything that changes data or schema has no business in a schedules file.
    'destructive': len(re.findall(r'(?im)^[ \t]*(delete[ \t]+from|truncate|drop|alter)\b', body)),
    'guards':      len(re.findall(r'(?im)^[ \t]*do[ \t]+\$\$', body)),
    'other':       len(re.findall(r'(?im)^[ \t]*(create|grant|revoke|insert|update)\b', body)),
}

print(' '.join('%s=%d' % (k, counts[k]) for k in
               ('schedule', 'unschedule', 'destructive', 'guards', 'other')))
