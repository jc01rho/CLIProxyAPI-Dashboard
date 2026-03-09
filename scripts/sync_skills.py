#!/usr/bin/env python3
"""
Send Claude skill usage events to CLIProxy collector.

Designed as a PostToolUse hook for Claude Code — reads the Skill tool's
stdin payload and forwards it to the collector's /api/collector/skill-events endpoint.

Dependency-free (stdlib only). Always exits 0 to avoid blocking Claude.

Environment:
  CLIPROXY_COLLECTOR_URL  — full endpoint URL (default: http://localhost:5001/api/collector/skill-events)
"""

import hashlib
import json
import os
import socket
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import PurePosixPath


def _to_int(value, default=0):
    try:
        return int(value or 0)
    except Exception:
        return default


def _pick_first_str(candidates, keys):
    for c in candidates:
        if not isinstance(c, dict):
            continue
        for key in keys:
            v = c.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return None


def _extract_skill_metrics(payload):
    """Best-effort extraction of token/tool metrics from Claude hook payload."""
    candidates = []

    if isinstance(payload, dict):
        candidates.append(payload)

        usage = payload.get('usage')
        if isinstance(usage, dict):
            candidates.append(usage)

        message = payload.get('message')
        if isinstance(message, dict):
            candidates.append(message)
            if isinstance(message.get('usage'), dict):
                candidates.append(message.get('usage'))

        tool_response = payload.get('tool_response')
        if isinstance(tool_response, dict):
            candidates.append(tool_response)
            if isinstance(tool_response.get('usage'), dict):
                candidates.append(tool_response.get('usage'))
            if isinstance(tool_response.get('result'), dict):
                candidates.append(tool_response.get('result'))
            tr_message = tool_response.get('message')
            if isinstance(tr_message, dict):
                candidates.append(tr_message)
                if isinstance(tr_message.get('usage'), dict):
                    candidates.append(tr_message.get('usage'))

    input_tokens = 0
    output_tokens = 0
    tool_calls = 0
    duration_ms = 0

    for c in candidates:
        input_tokens = max(input_tokens, _to_int(c.get('input_tokens', c.get('tokens_used', c.get('inputTokens', 0)))))
        output_tokens = max(output_tokens, _to_int(c.get('output_tokens', c.get('outputTokens', 0))))
        tool_calls = max(tool_calls, _to_int(c.get('tool_calls', c.get('toolCalls', 0))))
        duration_ms = max(duration_ms, _to_int(c.get('duration_ms', c.get('durationMs', c.get('elapsed_ms', 0)))))

    model = _pick_first_str(candidates, ['model'])

    return {
        'tokens_used': input_tokens,
        'output_tokens': output_tokens,
        'tool_calls': tool_calls,
        'duration_ms': duration_ms,
        'model': model,
    }

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

    metrics = _extract_skill_metrics(payload)

    status_raw = str(
        payload.get('tool_response', {}).get('status')
        or payload.get('status')
        or payload.get('tool_response', {}).get('result', {}).get('status')
        or ''
    ).strip().lower()
    status = 'failure' if status_raw in ('failure', 'error') else 'success'

    error_type = (
        _pick_first_str([
            payload.get('tool_response', {}),
            payload.get('tool_response', {}).get('error', {}),
            payload.get('tool_response', {}).get('result', {}),
        ], ['error_type', 'type'])
    )
    error_message = (
        _pick_first_str([
            payload.get('tool_response', {}),
            payload.get('tool_response', {}).get('error', {}),
            payload.get('tool_response', {}).get('result', {}),
        ], ['error_message', 'message', 'stderr'])
    )

    attempt_no_raw = (
        payload.get('attempt_no')
        or payload.get('tool_response', {}).get('attempt_no')
        or payload.get('tool_response', {}).get('result', {}).get('attempt_no')
        or 1
    )
    attempt_no = max(_to_int(attempt_no_raw, 1), 1)

    tool_use_id = str(payload.get('tool_use_id') or '').strip() or None
    event_uid_basis = '|'.join([
        MACHINE_ID,
        session_id,
        skill_name,
        tool_use_id or '',
        str(attempt_no),
    ])
    event_uid = hashlib.sha1(event_uid_basis.encode('utf-8')).hexdigest()

    event = {
        'event_uid': event_uid,
        'tool_use_id': tool_use_id,
        'machine_id': MACHINE_ID,
        'source': 'manual',
        'skill_name': skill_name,
        'session_id': session_id,
        'trigger_type': 'explicit',
        'triggered_at': datetime.now(timezone.utc).isoformat(),
        'status': status,
        'error_type': error_type,
        'error_message': error_message,
        'attempt_no': attempt_no,
        'arguments': tool_input.get('args') or None,
        'tokens_used': metrics['tokens_used'],
        'output_tokens': metrics['output_tokens'],
        'tool_calls': metrics['tool_calls'],
        'duration_ms': metrics['duration_ms'],
        'model': metrics['model'],
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
