#!/usr/bin/env python3
"""
Send Claude skill usage events to CLIProxy collector.

Designed as a PostToolUse hook for Claude Code — reads the Skill tool's
stdin payload and forwards it to the collector's /api/collector/skill-events endpoint.

Dependency-free (stdlib only). Always exits 0 to avoid blocking Claude.

Environment:
  CLIPROXY_COLLECTOR_URL  — full endpoint URL (default: http://localhost:5001/api/collector/skill-events)
"""

import json
import os
import socket
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import PurePosixPath

COLLECTOR_URL = os.environ.get(
    'CLIPROXY_COLLECTOR_URL',
    'http://localhost:5001/api/collector/skill-events',
)
MACHINE_ID = socket.gethostname()


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or '{}')
    except Exception:
        return

    if not isinstance(payload, dict):
        return

    # Claude Code PostToolUse payload:
    #   tool_name, tool_input, tool_response, session_id, tool_use_id, cwd, ...
    tool_input = payload.get('tool_input') or {}
    skill_name = str(tool_input.get('skill') or '').strip()
    session_id = str(payload.get('session_id') or '').strip()

    if not skill_name or not session_id:
        return

    cwd = str(payload.get('cwd') or '').strip()
    project_dir = PurePosixPath(cwd).name if cwd else ''

    event = {
        'machine_id': MACHINE_ID,
        'skill_name': skill_name,
        'session_id': session_id,
        'trigger_type': 'explicit',
        'triggered_at': datetime.now(timezone.utc).isoformat(),
        'arguments': tool_input.get('args') or None,
        'tokens_used': 0,
        'output_tokens': 0,
        'tool_calls': 0,
        'duration_ms': 0,
        'model': None,
        'is_skeleton': False,
        'project_dir': project_dir,
    }

    try:
        data = json.dumps({'events': [event]}).encode('utf-8')
        req = urllib.request.Request(
            COLLECTOR_URL, data=data,
            headers={'Content-Type': 'application/json'},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # swallow — never block Claude


if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass  # absolute safety net
