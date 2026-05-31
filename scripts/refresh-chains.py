#!/usr/bin/env python3
"""
scripts/refresh-chains.py
Refresh data/chains.json from agent-brain/watcher/chain-registry.json.

Usage (from site root):
    python3 scripts/refresh-chains.py
    python3 scripts/refresh-chains.py --registry /path/to/chain-registry.json

The script reads the live chain registry, enriches entries by parsing handoff
filenames (and file content when available), then writes data/chains.json in
the format expected by js/visualizer.js.

Run this before deploying to keep the visualizer data fresh.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

AGENT_BRAIN_DEFAULT = "/mnt/c/Users/eabfd/agent-brain"
REGISTRY_DEFAULT = os.path.join(AGENT_BRAIN_DEFAULT, "watcher", "chain-registry.json")
HANDOFFS_DEFAULT = os.path.join(AGENT_BRAIN_DEFAULT, "handoffs")
SITE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT = os.path.join(SITE_ROOT, "data", "chains.json")

AGENT_NAMES = {
    "grok": "Grok",
    "claude": "Claude Code",
    "claude-code": "Claude Code",
    "codex": "Codex",
    "hermes": "Hermes",
}

META = {
    "description": "Agent delegation chains — Grok → Claude Code → Codex handoff flows",
    "agents": {
        "Grok":        {"role": "Strategy, architecture, direction",   "color": "#bc8cff"},
        "Claude Code": {"role": "Implementation, orchestration, git",  "color": "#58a6ff"},
        "Codex":       {"role": "Bounded code-gen sub-tasks",          "color": "#3fb950"},
        "Hermes":      {"role": "Telegram gateway, capture, reminders","color": "#d29922"},
    },
    "statuses": {
        "dispatched":  "Sent, Claude Code has it",
        "in_progress": "Active work underway",
        "delegating":  "Sub-task sent to Codex",
        "delegated":   "Codex has it",
        "returning":   "Codex done, back to Claude Code",
        "closed":      "Fully complete",
        "blocked":     "Stuck, needs input",
        "limit_hit":   "Session limit hit, will retry",
    },
}

HANDOFF_FILENAME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}-from-[a-z0-9-]+-to-[a-z0-9-]+-[A-Za-z0-9._-]+\.md$"
)


def warn(message):
    print(f"WARNING: {message}", file=sys.stderr)


def load_json_file(path, label):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {label} not found at {path}", file=sys.stderr)
        return None
    except json.JSONDecodeError as exc:
        print(f"ERROR: Failed to parse {label} at {path}: {exc}", file=sys.stderr)
        return None
    except OSError as exc:
        print(f"ERROR: Could not read {label} at {path}: {exc}", file=sys.stderr)
        return None


def safe_handoff_filename(fname):
    """Return a safe handoff basename or None if the input is unsafe."""
    if not isinstance(fname, str):
        return None

    if os.path.basename(fname) != fname:
        warn(f"Skipping unsafe handoff filename {fname!r}")
        return None

    if not HANDOFF_FILENAME_RE.match(fname):
        return None

    return fname


def parse_filename(fname):
    """Extract date, from_agent, to_agent from a handoff filename."""
    safe_name = safe_handoff_filename(fname)
    if not safe_name:
        return None

    name = safe_name.replace(".md", "")
    m = re.match(r"(\d{4}-\d{2}-\d{2})-from-(.+?)-to-(.+?)-(.+)", name)
    if not m:
        return None
    date, from_raw, to_raw, slug = m.groups()
    return {
        "id": name,
        "date": date,
        "from": AGENT_NAMES.get(from_raw, from_raw.replace("-", " ").title()),
        "to": AGENT_NAMES.get(to_raw, to_raw.replace("-", " ").title()),
    }


def get_description(handoffs_dir, fname):
    """Try to read a description from the handoff file's first heading."""
    safe_name = safe_handoff_filename(fname)
    if not safe_name:
        return None

    for search_path in [
        os.path.join(handoffs_dir, safe_name),
        os.path.join(handoffs_dir, "archive", safe_name),
    ]:
        if not os.path.exists(search_path):
            continue
        try:
            with open(search_path, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("# Handoff:"):
                        return line[len("# Handoff:"):].strip()
                    if line.startswith("# "):
                        return line[2:].strip()
        except OSError:
            pass
    return None


def slug_to_description(parsed):
    """Fall back to a prettified slug when no handoff file is readable."""
    raw_id = parsed.get("id", "")
    # Strip the YYYY-MM-DD-from-X-to-Y- prefix using the known from/to values
    from_slug = parsed.get("from", "").lower().replace(" ", "-")
    to_slug = parsed.get("to", "").lower().replace(" ", "-")
    prefix = f"{parsed.get('date', '')}-from-{from_slug}-to-{to_slug}-"
    if raw_id.startswith(prefix):
        rest = raw_id[len(prefix):]
    else:
        # Fallback: drop the first 7 dash-separated tokens (date + from + to)
        parts = raw_id.split("-")
        # Find where the slug starts by scanning for end of "to-<agent>" pattern
        rest = "-".join(parts[7:]) if len(parts) > 7 else raw_id
    return rest.replace("-", " ").title() if rest else raw_id


def build_description(parsed, handoffs_dir, fname):
    desc = get_description(handoffs_dir, fname)
    return desc if desc else slug_to_description(parsed)


def main():
    registry_path = REGISTRY_DEFAULT
    handoffs_dir = HANDOFFS_DEFAULT

    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--registry" and i + 1 < len(args):
            registry_path = args[i + 1]
        elif arg == "--handoffs" and i + 1 < len(args):
            handoffs_dir = args[i + 1]

    if not os.path.exists(registry_path):
        print(f"ERROR: Registry not found at {registry_path}", file=sys.stderr)
        print("Pass --registry /path/to/chain-registry.json to override.", file=sys.stderr)
        sys.exit(1)

    registry = load_json_file(registry_path, "chain registry")
    if registry is None:
        sys.exit(1)
    if not isinstance(registry, dict):
        print("ERROR: Chain registry must be a JSON object.", file=sys.stderr)
        sys.exit(1)

    chains_map = registry.get("chains", {})
    roots_map = registry.get("roots", {})
    if not isinstance(chains_map, dict):
        print("ERROR: Chain registry 'chains' must be a JSON object.", file=sys.stderr)
        sys.exit(1)
    if not isinstance(roots_map, dict):
        print("ERROR: Chain registry 'roots' must be a JSON object.", file=sys.stderr)
        sys.exit(1)

    seen_delegations = set()
    roots_out = []

    for root_fname, root_data in roots_map.items():
        if not isinstance(root_data, dict):
            warn(f"Skipping malformed root entry for {root_fname!r}")
            continue

        parsed = parse_filename(root_fname)
        if not parsed:
            warn(f"Skipping root with unsafe or invalid filename {root_fname!r}")
            continue
        desc = build_description(parsed, handoffs_dir, root_fname)

        delegations = []
        delegations_raw = root_data.get("delegations", [])
        if not isinstance(delegations_raw, list):
            warn(f"Root {root_fname!r} has non-list delegations; ignoring value")
            delegations_raw = []

        for del_fname in delegations_raw:
            if not isinstance(del_fname, str):
                warn(f"Skipping non-string delegation reference under {root_fname!r}")
                continue
            if del_fname in seen_delegations:
                continue
            seen_delegations.add(del_fname)
            chain_data = chains_map.get(del_fname, {})
            if not isinstance(chain_data, dict):
                warn(f"Delegation {del_fname!r} has malformed chain metadata; using defaults")
                chain_data = {}
            del_parsed = parse_filename(del_fname)
            if not del_parsed:
                warn(f"Skipping delegation with unsafe or invalid filename {del_fname!r}")
                continue
            del_desc = build_description(del_parsed, handoffs_dir, del_fname)
            delegations.append({
                "id": del_parsed["id"],
                "date": del_parsed["date"],
                "from": del_parsed["from"],
                "to": del_parsed["to"],
                "description": del_desc,
                "status": chain_data.get("status", "delegated"),
                "registered": chain_data.get("registered", ""),
            })

        roots_out.append({
            "id": parsed["id"],
            "date": parsed["date"],
            "from": parsed["from"],
            "to": parsed["to"],
            "description": desc,
            "status": root_data.get("status", "dispatched"),
            "registered": root_data.get("registered", ""),
            "delegations": delegations,
        })

    snapshot_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    meta = dict(META)
    meta["snapshot"] = snapshot_date

    output = {"roots": roots_out, "meta": meta}

    os.makedirs(os.path.dirname(OUTPUT) if os.path.dirname(OUTPUT) else ".", exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✓ {OUTPUT} updated — {len(roots_out)} root(s) from {registry_path}")
    print(f"  Snapshot date: {snapshot_date}")


if __name__ == "__main__":
    main()
