"""Gate tests for scripts/refresh-chains.py (run: python3 -m pytest -q scripts/)."""
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "refresh-chains.py")

spec = importlib.util.spec_from_file_location("refresh_chains", SCRIPT)
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)

ROOT_A = "2026-05-31-from-grok-to-claude-code-site-phase-1.md"
ROOT_B = "2026-08-29-from-hermes-to-claude-code-skills-review-0900.md"
DELEG = "2026-05-30-from-claude-code-to-codex-site-visualizer.md"


def registry(public_a=True, public_b=False):
    ra = {"registered": "2026-05-31T01:00:00Z", "status": "closed", "delegations": [DELEG, DELEG]}
    rb = {"registered": "2026-08-29T14:00:00Z", "status": "closed", "delegations": []}
    if public_a:
        ra["public"] = True
    if public_b:
        rb["public"] = True
    return {
        "chains": {DELEG: {"status": "limit_hit", "registered": "2026-05-31T02:00:00Z"}},
        "roots": {ROOT_B: rb, ROOT_A: ra, "../evil.md": {"status": "closed"}},
    }


def write_handoffs(tmp_path):
    d = tmp_path / "handoffs"
    (d / "archive").mkdir(parents=True)
    (d / ROOT_A).write_text("# Handoff: Build Phase 1 of the site\n", encoding="utf-8")
    (d / "archive" / DELEG).write_text("# Enhance Chain Visualizer\n", encoding="utf-8")
    return str(d)


def test_public_flag_filters_roots(tmp_path):
    out = rc.build_output(registry(), write_handoffs(tmp_path), snapshot_date="2026-09-17")
    ids = [r["id"] for r in out["roots"]]
    assert ids == [ROOT_A[:-3]]
    assert out["meta"]["snapshot"] == "2026-09-17"


def test_all_flag_publishes_everything_sorted_by_date(tmp_path):
    out = rc.build_output(registry(), write_handoffs(tmp_path), include_all=True)
    ids = [r["id"] for r in out["roots"]]
    assert ids == [ROOT_A[:-3], ROOT_B[:-3]]  # unsafe "../evil.md" dropped, sorted by date


def test_no_flags_falls_back_to_all_with_warning(tmp_path, capsys):
    out = rc.build_output(registry(public_a=False), write_handoffs(tmp_path))
    assert len(out["roots"]) == 2
    assert 'No root carries "public": true' in capsys.readouterr().err


def test_descriptions_and_delegation_dedupe(tmp_path):
    out = rc.build_output(registry(), write_handoffs(tmp_path))
    root = out["roots"][0]
    assert root["description"] == "Build Phase 1 of the site"  # "# Handoff:" prefix stripped
    assert root["from"] == "Grok" and root["to"] == "Claude Code"
    assert len(root["delegations"]) == 1  # duplicate reference collapsed
    d = root["delegations"][0]
    assert d["description"] == "Enhance Chain Visualizer"  # read from archive/
    assert d["status"] == "limit_hit" and d["to"] == "Codex"


def test_slug_fallback_when_handoff_file_missing(tmp_path):
    out = rc.build_output(registry(public_a=False, public_b=True), write_handoffs(tmp_path))
    assert out["roots"][0]["description"] == "Skills Review 0900"


def test_bad_shape_raises():
    for bad in ([], {"chains": [], "roots": {}}, {"chains": {}, "roots": []}):
        try:
            rc.build_output(bad, "/nonexistent")
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for {bad!r}")


def test_cli_writes_output_file(tmp_path):
    reg = tmp_path / "chain-registry.json"
    reg.write_text(json.dumps(registry()), encoding="utf-8")
    out = tmp_path / "out" / "chains.json"
    handoffs = write_handoffs(tmp_path)
    res = subprocess.run(
        [sys.executable, SCRIPT, "--registry", str(reg), "--handoffs", handoffs, "--output", str(out)],
        capture_output=True, text=True, check=True,
    )
    assert "1 root(s)" in res.stdout
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["roots"][0]["id"] == ROOT_A[:-3]
    assert "snapshot" in data["meta"]


def test_cli_missing_registry_exits_1(tmp_path):
    res = subprocess.run([sys.executable, SCRIPT, "--registry", str(tmp_path / "nope.json")],
                         capture_output=True, text=True)
    assert res.returncode == 1 and "Registry not found" in res.stderr


def test_cli_flag_without_value_exits_nonzero(tmp_path):
    res = subprocess.run([sys.executable, SCRIPT, "--registry"], capture_output=True, text=True)
    assert res.returncode == 2 and "expected one argument" in res.stderr


def test_cli_unknown_flag_exits_nonzero():
    res = subprocess.run([sys.executable, SCRIPT, "--al"], capture_output=True, text=True)
    assert res.returncode == 2


def test_empty_roots_refuses_write(tmp_path):
    reg = tmp_path / "r.json"
    reg.write_text(json.dumps({"chains": {}, "roots": {"bad name.md": {"status": "closed"}}}), encoding="utf-8")
    out = tmp_path / "chains.json"
    out.write_text("keep me", encoding="utf-8")
    res = subprocess.run([sys.executable, SCRIPT, "--registry", str(reg), "--handoffs", str(tmp_path), "--output", str(out)],
                         capture_output=True, text=True)
    assert res.returncode == 1 and "refusing" in res.stderr
    assert out.read_text(encoding="utf-8") == "keep me"
    res = subprocess.run([sys.executable, SCRIPT, "--registry", str(reg), "--handoffs", str(tmp_path), "--output", str(out), "--allow-empty"],
                         capture_output=True, text=True, check=True)
    assert json.loads(out.read_text(encoding="utf-8"))["roots"] == []
