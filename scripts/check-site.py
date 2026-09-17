#!/usr/bin/env python3
"""
scripts/check-site.py — deterministic gate for griffithee.github.io.

Run from anywhere: python3 scripts/check-site.py   (exit 0 = clean)

Checks:
  1. Every local href/src in the HTML pages resolves to a file in the repo, and every
     #fragment (same page or page.html#id) resolves to an id on the target page.
  2. No links to private repos (github.com/griffithee/agent-brain 404s for visitors).
  3. data/projects.json parses; every status is one js/projects-browser.js can colour;
     every local link resolves; `updated` is an ISO date.
  4. data/chains.json parses; every root/delegation status is one js/visualizer.js knows.
  5. index.html stat cards tagged data-stat="closed-chains" / "active-chains" match chains.json.
  6. `node --check` on every js file when node is available.
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PAGES = ["index.html", "projects.html", "experiments.html", "about.html", "game.html", "galaga.html"]
PRIVATE_LINKS = ["github.com/griffithee/agent-brain"]

errors = []


def err(msg):
    errors.append(msg)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def local_target(url):
    """Return the repo-relative path a local URL points at, or None for external/anchor-only."""
    if not url or url.startswith(("http://", "https://", "mailto:", "data:", "#", "//")):
        return None
    path = url.split("#", 1)[0].split("?", 1)[0]
    return path or None


ATTR_RE = re.compile(r"""\b(?:href|src)=["']([^"']*)["']""")
ID_RE = re.compile(r"""\bid=["']([^"']+)["']""")


def page_ids(rel):
    return set(ID_RE.findall(read(rel)))


def check_fragment(where, url, current_page):
    """Verify a #fragment in url points at an id on its target page."""
    if url.startswith(("http://", "https://", "mailto:", "//")) or "#" not in url:
        return
    path, frag = url.split("#", 1)
    if not frag:
        return
    target = path or current_page
    if not os.path.isfile(os.path.join(ROOT, target)):
        return  # reported as a broken link elsewhere
    if frag not in page_ids(target):
        err(f"{where}: anchor {url} has no id=\"{frag}\" on {target}")


def check_html_links():
    for page in PAGES:
        html = read(page)
        ids = ID_RE.findall(html)
        for dup in sorted({i for i in ids if ids.count(i) > 1}):
            err(f"{page}: duplicate id=\"{dup}\"")
        for url in ATTR_RE.findall(html):
            for private in PRIVATE_LINKS:
                if private in url:
                    err(f"{page}: links to private repo {url}")
            target = local_target(url)
            if target and not os.path.isfile(os.path.join(ROOT, target)):
                err(f"{page}: broken local link {url}")
            check_fragment(page, url, page)


def js_keys(rel, var_name):
    src = read(rel)
    m = re.search(re.escape(var_name) + r"\s*=\s*\{(.*?)\n\s*\};", src, re.S)
    if not m:
        err(f"{rel}: could not find {var_name}")
        return set()
    return set(re.findall(r"^\s*'?([A-Za-z0-9_]+)'?\s*:", m.group(1), re.M))


def check_projects_json():
    try:
        data = json.loads(read("data/projects.json"))
    except ValueError as exc:
        err(f"data/projects.json: invalid JSON ({exc})")
        return
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(data.get("updated", ""))):
        err("data/projects.json: 'updated' must be YYYY-MM-DD")
    allowed = js_keys("js/projects-browser.js", "STATUS_TAG_CLASS")
    for p in data.get("projects", []):
        pid = p.get("id", "?")
        if p.get("status") not in allowed:
            err(f"data/projects.json: {pid} status {p.get('status')!r} not in projects-browser.js {sorted(allowed)}")
        link = p.get("link", "")
        target = local_target(link)
        if target and not os.path.isfile(os.path.join(ROOT, target)):
            err(f"data/projects.json: {pid} link {link} does not resolve")
        elif target:
            check_fragment(f"data/projects.json: {pid}", link, target)
        if not p.get("desc"):
            err(f"data/projects.json: {pid} has no desc")
    return data


def check_chains_json():
    try:
        data = json.loads(read("data/chains.json"))
    except ValueError as exc:
        err(f"data/chains.json: invalid JSON ({exc})")
        return None
    allowed = js_keys("js/visualizer.js", "STATUS_META")
    for root in data.get("roots", []):
        nodes = [root] + root.get("delegations", [])
        for n in nodes:
            if n.get("status") not in allowed:
                err(f"data/chains.json: {n.get('id')} status {n.get('status')!r} unknown to visualizer.js")
    if not data.get("meta", {}).get("snapshot"):
        err("data/chains.json: meta.snapshot missing")
    return data


def check_home_stats(chains):
    if not chains:
        return
    roots = chains.get("roots", [])
    expected = {
        "closed-chains": sum(1 for r in roots if r.get("status") == "closed"),
        "active-chains": sum(1 for r in roots if r.get("status") != "closed"),
    }
    html = read("index.html")
    found = dict(re.findall(r'data-stat="([a-z-]+)"[^>]*>\s*([^<\s]+)\s*<', html))
    for key, want in expected.items():
        if key not in found:
            err(f'index.html: no element with data-stat="{key}"')
        elif found[key] != str(want):
            err(f"index.html: {key} shows {found[key]} but data/chains.json has {want}")


def check_js_syntax():
    node = shutil.which("node")
    if not node:
        print("note: node not found, skipping js syntax check")
        return
    for name in sorted(os.listdir(os.path.join(ROOT, "js"))):
        if name.endswith(".js"):
            res = subprocess.run([node, "--check", os.path.join(ROOT, "js", name)], capture_output=True, text=True)
            if res.returncode != 0:
                err(f"js/{name}: {res.stderr.strip()}")


def main():
    check_html_links()
    check_projects_json()
    chains = check_chains_json()
    check_home_stats(chains)
    check_js_syntax()
    if errors:
        for e in errors:
            print(f"FAIL {e}")
        print(f"{len(errors)} problem(s)")
        sys.exit(1)
    print("check-site: OK")


if __name__ == "__main__":
    main()
