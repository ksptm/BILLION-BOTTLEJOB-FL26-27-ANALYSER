#!/usr/bin/env python3
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

BASE = "https://fantasy.premierleague.com/api"
UA = "FPL-Analyser-GitHub-Pages/1.0"

def fetch_json(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": UA,
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            last = exc
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise last

def season_score(position, season):
    targets = {"GKP": 175, "DEF": 185, "MID": 220, "FWD": 210}
    target = targets.get(position, 200)
    points = float(season.get("total_points") or 0)
    minutes = float(season.get("minutes") or 0)
    points_score = min(100.0, (points / target) * 100.0)
    minutes_score = min(100.0, (minutes / 3420.0) * 100.0)
    return points_score * 0.80 + minutes_score * 0.20

def main():
    print("Fetching bootstrap-static...")
    bootstrap = fetch_json(f"{BASE}/bootstrap-static/")
    print("Fetching fixtures...")
    fixtures = fetch_json(f"{BASE}/fixtures/")

    positions = {
        p["id"]: p["singular_name_short"]
        for p in bootstrap.get("element_types", [])
    }

    history = {}
    players = bootstrap.get("elements", [])
    total = len(players)

    for i, player in enumerate(players, start=1):
        pid = player["id"]
        position = positions.get(player.get("element_type"), "")
        try:
            summary = fetch_json(f"{BASE}/element-summary/{pid}/")
            past = summary.get("history_past", [])
            history[str(pid)] = [
                {
                    "season": s.get("season_name", ""),
                    "totalPoints": float(s.get("total_points") or 0),
                    "minutes": float(s.get("minutes") or 0),
                    "starts": float(s.get("starts") or 0),
                    "goals": float(s.get("goals_scored") or 0),
                    "assists": float(s.get("assists") or 0),
                    "cleanSheets": float(s.get("clean_sheets") or 0),
                    "bonus": float(s.get("bonus") or 0),
                    "xg": float(s.get("expected_goals") or 0),
                    "xa": float(s.get("expected_assists") or 0),
                    "xgi": float(s.get("expected_goal_involvements") or 0),
                    "score": season_score(position, s),
                }
                for s in past
            ]
        except Exception as exc:
            print(f"WARNING: history failed for player {pid}: {exc}")
            history[str(pid)] = []

        if i % 25 == 0 or i == total:
            print(f"History: {i}/{total}")

        # Be polite to the FPL endpoint.
        time.sleep(0.03)

    (DATA / "bootstrap.json").write_text(
        json.dumps(bootstrap, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (DATA / "fixtures.json").write_text(
        json.dumps(fixtures, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (DATA / "history.json").write_text(
        json.dumps(history, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (DATA / "updated.json").write_text(
        json.dumps(
            {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
            indent=2,
        ),
        encoding="utf-8",
    )
    print("FPL snapshots updated.")

if __name__ == "__main__":
    main()
