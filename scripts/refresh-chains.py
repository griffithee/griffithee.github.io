#!/usr/bin/env python3
"""
scripts/refresh-chains.py
Refresh data/chains.json from agent-brain/watcher/chain-registry.json.

Usage (from site root):
    python3 scripts/refresh-chains.py
    python3 scripts/refresh-chains.py --registry /path/to/chain-registry.json
    python3 scripts/refresh-chains.py --all          # ignore "public" curation flags
    python3 scripts/refresh-chains.py --output /tmp/chains.json

Curation: the watcher registers every dispatch, so the registry is not curated
by membership. Roots carrying "public": true are the curated set; only they are
published. If no root has the flag, every root is published with a warning.

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

def _default_agent_brain() -> str:
    wsl = "/mnt/c/Users/eabfd/agent-brain"
    if os.path.isdir(wsl):
        return wsl
    win = r"C:\Users\eabfd\agent-brain"
    if os.path.isdir(win):
        return win
    return wsl


AGENT_BRAIN_DEFAULT = _default_agent_brain()
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


def safe_text(value, fallback=""):
    if not isinstance(value, str):
        return fallback
    text = value.strip()
    return text if text else fallback


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


def is_safe_file_within(base_dir, path):
    """Return True when path resolves to a regular file inside base_dir."""
    try:
        base_real = os.path.realpath(base_dir)
        path_real = os.path.realpath(path)
        if os.path.commonpath([base_real, path_real]) != base_real:
            return False
        return os.path.isfile(path_real)
    except OSError:
        return False


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
        safe_path = is_safe_file_within(handoffs_dir, search_path)
        if os.path.lexists(search_path) and not safe_path:
            warn(f"Skipping unsafe handoff file {search_path!r}")
            continue
        if not safe_path:
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


def select_roots(roots_map, include_all=False):
    """Return the roots to publish: flagged "public": true, or all when none are flagged."""
    if include_all:
        return roots_map
    curated = {
        k: v for k, v in roots_map.items()
        if isinstance(v, dict) and v.get("public") is True
    }
    if curated:
        return curated
    warn('No root carries "public": true; publishing every root. '
         'Flag curated roots in the registry (see watcher/README.md).')
    return roots_map


def build_output(registry, handoffs_dir, include_all=False, snapshot_date=None):
    """Turn a parsed registry into the chains.json structure. Raises ValueError on bad shape."""
    if not isinstance(registry, dict):
        raise ValueError("Chain registry must be a JSON object.")
    chains_map = registry.get("chains", {})
    roots_map = registry.get("roots", {})
    if not isinstance(chains_map, dict):
        raise ValueError("Chain registry 'chains' must be a JSON object.")
    if not isinstance(roots_map, dict):
        raise ValueError("Chain registry 'roots' must be a JSON object.")

    seen_delegations = set()  # registry-wide: a delegation belongs to the first root that lists it
    roots_out = []

    for root_fname, root_data in select_roots(roots_map, include_all).items():
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
                "status": safe_text(chain_data.get("status"), "delegated"),
                "registered": safe_text(chain_data.get("registered"), ""),
            })

        roots_out.append({
            "id": parsed["id"],
            "date": parsed["date"],
            "from": parsed["from"],
            "to": parsed["to"],
            "description": desc,
            "status": safe_text(root_data.get("status"), "dispatched"),
            "registered": safe_text(root_data.get("registered"), ""),
            "delegations": delegations,
        })

    roots_out.sort(key=lambda r: (r["date"], r["registered"], r["id"]))

    meta = dict(META)
    meta["snapshot"] = snapshot_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {"roots": roots_out, "meta": meta}


def parse_args(argv):
    import argparse
    ap = argparse.ArgumentParser(description="Refresh data/chains.json from the chain registry.")
    ap.add_argument("--registry", default=REGISTRY_DEFAULT)
    ap.add_argument("--handoffs", default=HANDOFFS_DEFAULT)
    ap.add_argument("--output", default=OUTPUT)
    ap.add_argument("--all", action="store_true", help='ignore "public" curation flags')
    ap.add_argument("--allow-empty", action="store_true", help="write the file even when no root survives")
    return ap.parse_args(argv)


def main():
    args = parse_args(sys.argv[1:])

    if not os.path.exists(args.registry):
        print(f"ERROR: Registry not found at {args.registry}", file=sys.stderr)
        print("Pass --registry /path/to/chain-registry.json to override.", file=sys.stderr)
        sys.exit(1)

    registry = load_json_file(args.registry, "chain registry")
    if registry is None:
        sys.exit(1)

    try:
        output = build_output(registry, args.handoffs, args.all)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if not output["roots"] and not args.allow_empty:
        print("ERROR: no publishable root survived; refusing to overwrite the snapshot "
              "(pass --allow-empty to force).", file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"✓ {args.output} updated — {len(output['roots'])} root(s) from {args.registry}")
    print(f"  Snapshot date: {output['meta']['snapshot']}")


if __name__ == "__main__":
    main()
