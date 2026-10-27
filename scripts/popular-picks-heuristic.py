#!/usr/bin/env python3
"""Generate heuristic 'Popular this weekend' picks from the candidate digests.

Reads output/popular-candidates/*.md (produced by `npm run popular:candidates`),
scores events on category + marquee keywords, and writes proposal JSON for
`npm run popular:merge`. Reasons are factual one-liners (title, category, venue, day).
"""
import json
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CAND = ROOT / "output" / "popular-candidates"
OUT = ROOT / "output" / "popular-picks"
WEEKEND = ("2026-10-31", "2026-11-01")

CAT_SCORE = {
    "Festival": 7, "Zoo": 6, "Farm": 6, "Museum": 5, "Ticketed": 5,
    "Theater": 5, "Concert": 5, "Park": 4, "Outdoors": 4, "Community": 3,
    "Library": 1, "Storytime": 1,
}
KEYWORDS = {
    "halloween": 6, "boo": 5, "pumpkin": 5, "dia de los muertos": 6,
    "día de los muertos": 6, "spooktacular": 6, "festival": 5, "fair": 4,
    "parade": 5, "circus": 5, "bluey": 6, "carnival": 5, "trunk-or-treat": 5,
    "harvest": 4, "fall fest": 5, "day of the dead": 5,
}
LINE = re.compile(r"^-\s+(?P<id>[^|]+?)\s*\|\s*(?P<when>[^|]+?)\s*\|\s*(?P<title>[^|]+?)\s*\|\s*(?P<venue>[^|]+?)\s*\|\s*(?P<price>[^|]+?)\s*\|\s*(?P<cat>[^|]+?)\s*\|")


def parse(path):
    rows = []
    for line in path.read_text().splitlines():
        m = LINE.match(line)
        if not m:
            continue
        d = {k: v.strip() for k, v in m.groupdict().items()}
        when = d["when"]
        d["day"] = "Sat" if when.startswith("Sat") else ("Sun" if when.startswith("Sun") else "?")
        d["time"] = when[4:].strip()
        rows.append(d)
    return rows


def score(d):
    s = CAT_SCORE.get(d["cat"], 2)
    t = d["title"].lower()
    s += sum(w for k, w in KEYWORDS.items() if k in t)
    if d["time"] not in ("12:00 AM", ""):
        s += 2  # a real start time beats an all-day library listing
    if d["price"].lower().startswith("free"):
        s += 1
    return s


def norm_title(t):
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def reason(d):
    bits = [f"{d['title']} at {d['venue']}"]
    bits.append(d["cat"].lower())
    when = f"{d['day']} {d['time']}".strip()
    bits.append(when)
    price = d["price"]
    if price.lower().startswith("free") and price.lower() != "free":
        bits.append(price[0].lower() + price[1:])
    elif price.lower() == "free":
        bits.append("free")
    return f"{bits[0]} — {bits[1]}, {bits[2]}" + (f" ({bits[3]})" if len(bits) > 3 else "") + "."


def pick(rows, n):
    rows = sorted(rows, key=lambda r: (-score(r), r["title"]))
    chosen, seen = [], set()
    for d in rows:
        key = norm_title(d["title"])
        if key in seen:
            continue
        if sum(1 for c in chosen if c["cat"] == d["cat"]) >= 2:
            continue
        chosen.append(d)
        seen.add(key)
        if len(chosen) == n:
            break
    # keep at least one Sunday event when the pool allows it
    if chosen and not any(c["day"] == "Sun" for c in chosen):
        sunday = next((r for r in rows if r["day"] == "Sun" and norm_title(r["title"]) not in seen), None)
        if sunday:
            chosen[-1] = sunday
    return chosen[:n]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for path in sorted(CAND.glob("*.md")):
        name = path.stem  # e.g. bay-area-kids
        metro, audience = name.rsplit("-", 1)
        rows = parse(path)
        if not rows:
            print("skip (no rows)", name)
            continue
        n = 4 if audience == "adults" else 6
        picks = pick(rows, n)
        doc = {
            "weekendStart": WEEKEND[0],
            "weekendEnd": WEEKEND[1],
            "note": "Halloween weekend — marquee seasonal events across the metro.",
            "picks": [{"eventId": d["id"], "rank": i + 1, "reason": reason(d)} for i, d in enumerate(picks)],
        }
        (OUT / f"{name}.json").write_text(json.dumps(doc, indent=2))
        written.append((name, len(picks)))
    for w in written:
        print("wrote", w[0], w[1])


if __name__ == "__main__":
    main()
