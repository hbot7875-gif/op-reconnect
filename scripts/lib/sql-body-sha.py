#!/usr/bin/env python
"""Hash a migration's EXECUTABLE body, ignoring comments and blank lines.

Comments on the backfill migration were updated after review (the row counts in
them had gone stale). The logic was not. This lets a preflight prove that
distinction instead of asserting it: strip every -- comment and every blank
line, then hash what is left.
"""
import hashlib, re, sys

src = open(sys.argv[1], encoding='utf-8').read()

out = []
for line in src.splitlines():
    # Strip trailing -- comments, but not a -- that sits inside a string literal.
    s, q, i = [], None, 0
    while i < len(line):
        c = line[i]
        if q:
            s.append(c)
            if c == q:
                q = None
        elif c in "'\"":
            q = c; s.append(c)
        elif c == '-' and line[i + 1:i + 2] == '-':
            break
        else:
            s.append(c)
        i += 1
    line = re.sub(r'\s+', ' ', ''.join(s)).strip()
    if line:
        out.append(line)

body = '\n'.join(out)
print(hashlib.sha256(body.encode()).hexdigest()[:16])
if '--lines' in sys.argv:
    print(len(out), 'executable lines', file=sys.stderr)
