#!/usr/bin/env python3
"""Build a static calendar from Daily_CF_Problems and public Codeforces evidence.

No credentials required. A failed API refresh never erases the last good history.
"""
import argparse
import datetime as dt
import io
import json
import re
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "Yawn-Sean/Daily_CF_Problems"
FORK = "theLucius7/Daily_CF_Problems"
HANDLE = "Lucius7"
LINK = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
PROBLEM = re.compile(r"codeforces\.com/(?:problemset/problem/(\d+)/([A-Za-z0-9]+)|(?:gym|contest)/(\d+)/problem/([A-Za-z0-9]+))", re.I)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(path)


def problem_key(url):
    match = PROBLEM.search(url)
    if not match:
        return None
    contest, index = (match[1], match[2]) if match[1] else (match[3], match[4])
    return f"cf:{int(contest)}:{index.upper()}"


def table_rows(text):
    """The first two separators delimit metadata; hints may contain literal |."""
    for line in text.splitlines():
        parts = re.split(r"(?<!\\)\|", line.strip().strip("|"), maxsplit=2)
        if len(parts) != 3:
            continue
        difficulty, problem, remainder = [x.strip() for x in parts]
        match = LINK.search(problem)
        rating = re.search(r"\d{3,4}", difficulty)
        if not match or not rating or not problem_key(match[2]):
            continue
        # Some files include a fourth Editorial column; don't include it in hints.
        hint = re.split(r"\|\s*\[(?:Editorial|Solution)\]", remainder, maxsplit=1, flags=re.I)[0].strip()
        yield {
            "id": problem_key(match[2]), "code": match[1], "url": match[2],
            "difficulty": int(rating[0]), "estimated": "*" in difficulty,
            "hint": hint.replace(r"\|", "|"),
        }


def read_source(source=None):
    if source:
        base = Path(source).resolve()
        if not (base / "daily_problems").is_dir():
            raise ValueError("Source must contain daily_problems/")
        paths = [p for p in base.glob("daily_problems/*/*/*/*") if p.is_file()]
        paths += list(base.glob("daily_problems/*/*/*/solution/*"))
        paths += list(base.glob("daily_problems/*/*/*/personal_submission/*"))
        paths += list(base.glob("categories/*.md"))
        files = {}
        for path in paths:
            if path.is_file():
                key = path.relative_to(base).as_posix()
                files[key] = path.read_text(errors="replace") if key.endswith("problems.md") or key.startswith("categories/") else ""
        revision = subprocess.check_output(["git", "-C", str(base), "rev-parse", "HEAD"], text=True).strip()
        dirty = bool(subprocess.check_output(["git", "-C", str(base), "status", "--porcelain", "--", "daily_problems", "categories"], text=True).strip())
        return files, revision, dirty
    # Resolve a revision first, so all links and the downloaded archive agree.
    response = json_request(f"https://api.github.com/repos/{REPOSITORY}/commits/main")
    revision = response["sha"]
    request = urllib.request.Request(f"https://codeload.github.com/{REPOSITORY}/tar.gz/{revision}", headers={"User-Agent": "Lucius7-calendar"})
    with urllib.request.urlopen(request, timeout=90) as response:
        archive = response.read()
    files = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            if not member.isfile() or "/" not in member.name:
                continue
            key = member.name.split("/", 1)[1]
            if not key.startswith(("daily_problems/", "categories/")):
                continue
            files[key] = tar.extractfile(member).read().decode("utf-8", errors="replace") if key.endswith("problems.md") or key.startswith("categories/") else ""
    return files, revision, False


def make_catalog(files, revision, dirty=False):
    categories = {}
    for path, content in files.items():
        if path.startswith("categories/"):
            for row in table_rows(content):
                categories.setdefault(row["id"], set()).add(Path(path).stem)
    personal = {}
    for path in files:
        if "/personal_submission/" not in path:
            continue
        match = re.fullmatch(r"cf(\d+)([a-z]\d*)_" + re.escape(HANDLE) + r"\.[^.]+", Path(path).name, re.I)
        if match:
            personal.setdefault(f"cf:{int(match[1])}:{match[2].upper()}", []).append(
                f"https://github.com/{FORK}/blob/main/{path}")
    tasks = []
    warnings = []
    for path, content in sorted(files.items()):
        match = re.fullmatch(r"daily_problems/(\d{4})/(\d{2})/(\d{4})/problems\.md", path)
        if not match:
            continue
        date = f"{match[1]}-{match[2]}-{match[3][2:]}"
        dt.date.fromisoformat(date)
        rows = list(table_rows(content))
        if not rows:
            raise ValueError(f"No problems parsed from {path}")
        for row in rows:
            _, contest, index = row["id"].split(":")
            solution = str(Path(path).parent / "solution" / f"cf{contest}{index.lower()}.md")
            row.update({
                "date": date, "key": f"{date}:{row['id']}",
                "editorial": f"https://github.com/{REPOSITORY}/blob/{revision}/{solution}" if solution in files else None,
                "sourceUrl": f"https://github.com/{REPOSITORY}/blob/{revision}/{path}",
                "categories": sorted(categories.get(row["id"], [])),
                "codeUrls": sorted(personal.get(row["id"], [])),
            })
            tasks.append(row)
    if not tasks:
        raise ValueError("Catalog is empty; preserving existing snapshot")
    if len({task["key"] for task in tasks}) != len(tasks):
        raise ValueError("Duplicate recommendation keys in catalog")
    return {"schemaVersion": 1, "handle": HANDLE, "updatedAt": now(),
            "source": {"repository": REPOSITORY, "revision": revision, "localChanges": dirty},
            "warnings": warnings, "tasks": tasks}


def json_request(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Lucius7-calendar", "Accept": "application/json"})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                value = json.load(response)
            if isinstance(value, dict) and value.get("status") == "FAILED":
                raise ValueError(value.get("comment", "API request failed"))
            return value
        except (OSError, ValueError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(str(last_error))


def fetch_submissions(request=json_request, pause=time.sleep):
    submissions = {}
    offset, size = 1, 10000
    while True:
        response = request(f"https://codeforces.com/api/user.status?handle={HANDLE}&from={offset}&count={size}")
        if response.get("status") != "OK" or not isinstance(response.get("result"), list):
            raise ValueError("Invalid Codeforces submission response")
        batch = response["result"]
        for submission in batch:
            submissions[submission["id"]] = submission
        if len(batch) < size:
            return list(submissions.values())
        offset += size
        pause(2.2)


def make_progress(submissions, timestamp=None):
    problems = {}
    for submission in sorted(submissions, key=lambda row: (row["creationTimeSeconds"], row["id"])):
        problem, author = submission["problem"], submission["author"]
        if "contestId" not in problem:
            continue
        members = author.get("members", [])
        if not any(member.get("handle", "").lower() == HANDLE.lower() for member in members):
            continue
        contest, index = problem["contestId"], problem["index"].upper()
        key = f"cf:{contest}:{index}"
        entry = problems.setdefault(key, {"name": problem["name"], "attempts": 0, "soloAttempts": 0,
                                           "firstAccepted": None, "teamAccepted": None})
        entry["attempts"] += 1
        team = bool(author.get("teamId")) or len(members) != 1
        if not team:
            entry["soloAttempts"] += 1
        evidence = {"id": submission["id"], "at": submission["creationTimeSeconds"],
                    "verdict": submission.get("verdict", "TESTING"),
                    "url": f"https://codeforces.com/{'gym' if contest >= 100000 else 'contest'}/{contest}/submission/{submission['id']}"}
        entry["latest"] = evidence
        if submission.get("verdict") == "OK":
            field = "teamAccepted" if team else "firstAccepted"
            if entry[field] is None:
                entry[field] = evidence
    timestamp = timestamp or now()
    return {"schemaVersion": 1, "handle": HANDLE, "updatedAt": timestamp, "lastAttemptAt": timestamp,
            "error": None, "publicHistoryComplete": True, "submissionCount": len(submissions),
            "coverage": "Codeforces API 公开可见提交；不包含无法访问的私有 Gym 或其他账号。团队 AC 单独展示。",
            "problems": problems}


def refresh_progress(path, fetch=fetch_submissions):
    try:
        snapshot = make_progress(fetch())
        atomic_json(path, snapshot)
        return snapshot, True
    except Exception as error:
        snapshot = json.loads(path.read_text()) if path.exists() else {
            "schemaVersion": 1, "handle": HANDLE, "updatedAt": None,
            "publicHistoryComplete": False, "submissionCount": 0, "problems": {},
            "coverage": "尚未取得 Codeforces 公开提交记录。"}
        snapshot.update({"lastAttemptAt": now(), "error": str(error)[:300]})
        atomic_json(path, snapshot)
        return snapshot, False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Read a local Daily_CF_Problems checkout, without modifying it")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data")
    parser.add_argument("--allow-stale", action="store_true", help="Allow a preserved snapshot when a remote source fails")
    args = parser.parse_args()
    failures = []
    try:
        catalog = make_catalog(*read_source(args.source))
        atomic_json(args.output / "calendar.json", catalog)
        print(f"Catalog: {len(catalog['tasks'])} daily entries / {len({t['id'] for t in catalog['tasks']})} unique problems")
    except Exception as error:
        failures.append("Catalog: " + str(error))
        path = args.output / "calendar.json"
        if not path.exists():
            raise
        catalog = json.loads(path.read_text())
        catalog.update({"lastAttemptAt": now(), "error": str(error)[:300]})
        atomic_json(path, catalog)
    progress, ok = refresh_progress(args.output / "progress.json")
    if not ok:
        failures.append("Codeforces: " + progress["error"])
    print(f"Progress: {progress['submissionCount']} public submissions; successful snapshot at {progress['updatedAt']}")
    for failure in failures:
        print(failure, file=sys.stderr)
    return 1 if failures and not args.allow_stale else 0


if __name__ == "__main__":
    sys.exit(main())
