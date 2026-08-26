#!/usr/bin/env python3
import json
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

BASE = "https://fantasy.premierleague.com/api"
UA = "FPL-Analyser-GitHub-Pages/1.1"

def fetch_bytes(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": UA, "Accept": "*/*"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as exc:
            last = exc
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise last

def fetch_json(url, retries=3):
    return json.loads(fetch_bytes(url, retries).decode("utf-8"))

def season_score(position, season):
    targets = {"GKP": 175, "DEF": 185, "MID": 220, "FWD": 210}
    target = targets.get(position, 200)
    points = float(season.get("total_points") or 0)
    minutes = float(season.get("minutes") or 0)
    points_score = min(100.0, (points / target) * 100.0)
    minutes_score = min(100.0, (minutes / 3420.0) * 100.0)
    return points_score * 0.80 + minutes_score * 0.20

def latest_finished_fixture_by_team(fixtures):
    latest = {}
    for f in fixtures:
        if not f.get("finished") or not f.get("kickoff_time"):
            continue
        try:
            dt = datetime.fromisoformat(f["kickoff_time"].replace("Z", "+00:00"))
        except Exception:
            continue
        for team_id in (f.get("team_h"), f.get("team_a")):
            if team_id is None:
                continue
            if team_id not in latest or dt > latest[team_id]:
                latest[team_id] = dt
    return latest

def parse_google_news_rss(query):
    params = {
        "q": query,
        "hl": "en-GB",
        "gl": "GB",
        "ceid": "GB:en",
    }
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)
    xml = fetch_bytes(url)
    root = ET.fromstring(xml)
    items = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        source_el = item.find("source")
        source = (source_el.text or "").strip() if source_el is not None else ""
        try:
            dt = parsedate_to_datetime(pub)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt = dt.astimezone(timezone.utc)
        except Exception:
            continue
        items.append({"title": title, "source": source, "published": dt})
    return items

def media_snapshot(players, fixtures, teams):
    now = datetime.now(timezone.utc)
    latest_fixture = latest_finished_fixture_by_team(fixtures)
    team_names = {t["id"]: t["name"] for t in teams}

    # Keep API load reasonable: established/relevant FPL pool.
    relevant = [
        p for p in players
        if float(p.get("selected_by_percent") or 0) >= 0.5
        or int(p.get("minutes") or 0) > 0
        or int(p.get("total_points") or 0) > 0
    ]
    # Hard safety cap, ranked by ownership then minutes.
    relevant.sort(
        key=lambda p: (
            float(p.get("selected_by_percent") or 0),
            int(p.get("minutes") or 0),
            int(p.get("total_points") or 0),
        ),
        reverse=True,
    )
    relevant = relevant[:250]

    media = {}
    total = len(relevant)

    for i, p in enumerate(relevant, start=1):
        pid = p["id"]
        team_id = p.get("team")
        team = team_names.get(team_id, "")
        name = f'{p.get("first_name","")} {p.get("second_name","")}'.strip()
        web_name = p.get("web_name", "").strip()
        last_match = latest_fixture.get(team_id)

        if last_match is None:
            window_start = now - timedelta(days=7)
        else:
            window_start = last_match

        # Clamp to a useful 24h–7d anomaly window.
        window_hours = max(24.0, min(168.0, (now - window_start).total_seconds() / 3600.0))
        window_start = now - timedelta(hours=window_hours)
        baseline_start = window_start - timedelta(hours=window_hours)

        # Query includes club to reduce same-name false positives.
        search_name = name if len(name) > 4 else web_name
        query = f'"{search_name}" "{team}" football'
        try:
            items = parse_google_news_rss(query)
        except Exception as exc:
            print(f"WARNING: media failed for {pid} {web_name}: {exc}")
            media[str(pid)] = {
                "articlesSinceLastMatch": 0,
                "uniqueSources": 0,
                "baselineArticles": 0,
                "activityIndex": 0,
                "last24h": 0,
                "last72h": 0,
                "windowHours": round(window_hours, 1),
                "lastMatch": last_match.isoformat() if last_match else "",
                "status": "NO DATA",
            }
            continue

        current = [x for x in items if window_start <= x["published"] <= now]
        baseline = [x for x in items if baseline_start <= x["published"] < window_start]
        last24 = [x for x in items if x["published"] >= now - timedelta(hours=24)]
        last72 = [x for x in items if x["published"] >= now - timedelta(hours=72)]
        unique_sources = len({x["source"] for x in current if x["source"]})

        # 100 = same article rate as immediately preceding equivalent window.
        # +1 smoothing prevents division-by-zero explosions.
        activity_index = ((len(current) + 1) / (len(baseline) + 1)) * 100.0
        if len(current) == 0:
            activity_index = 0.0

        if len(current) >= 5 and activity_index >= 200:
            status = "HIGH"
        elif len(current) >= 3 and activity_index >= 125:
            status = "ELEVATED"
        else:
            status = "NORMAL"

        media[str(pid)] = {
            "articlesSinceLastMatch": len(current),
            "uniqueSources": unique_sources,
            "baselineArticles": len(baseline),
            "activityIndex": round(activity_index, 1),
            "last24h": len(last24),
            "last72h": len(last72),
            "windowHours": round(window_hours, 1),
            "lastMatch": last_match.isoformat() if last_match else "",
            "status": status,
        }

        if i % 25 == 0 or i == total:
            print(f"Media: {i}/{total}")

        # Avoid hammering Google News RSS.
        time.sleep(0.12)

    return media

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
        time.sleep(0.03)

    print("Building media activity snapshot...")
    media = media_snapshot(players, fixtures, bootstrap.get("teams", []))

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
    (DATA / "media.json").write_text(
        json.dumps(media, ensure_ascii=False, separators=(",", ":")),
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
