#!/usr/bin/env bash
# simple summary: git status, last commit hash, tests summary (placeholder)
echo "=== Git status ==="
git status --short
LAST_COMMIT=$(git log -1 --pretty=format:'%H %s')
echo "\nLast commit: $LAST_COMMIT"
echo "\nTest summary: (no tests run)"
