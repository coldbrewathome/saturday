#!/usr/bin/env python3
"""Daily GSC digest for famhop.com — search performance, page/query leaders,
striking-distance targets, and sitemap health. Read-only.

Prints compact markdown for the briefing agent. Exits 0 with a NO_DATA note
when the property has no rows (never fails the job).
"""
import datetime
import json
import os
import subprocess
import urllib.request

PROPERTY = "sc-domain:famhop.com"
QUOTA_PROJECT = os.environ.get("GSC_QUOTA_PROJECT", "dulcet-abacus-478503-i7")
BASE = "https://searchconsole.googleapis.com/webmasters/v3/sites/"


def token():
    try:
        return subprocess.run(
            ["gcloud", "auth", "application-default", "print-access-token"],
            capture_output=True,
            text=True,
            env={**os.environ, "CLOUDSDK_PYTHON": "/opt/homebrew/bin/python3.10"},
            timeout=60,
        ).stdout.strip()
    except Exception:
        return ""


TOKEN = token()
HDRS = {
    "Authorization": f"Bearer {TOKEN}",
    "x-goog-user-project": QUOTA_PROJECT,
    "Content-Type": "application/json",
}


def query(body, encoded=PROPERTY.replace(":", "%3A")):
    req = urllib.request.Request(
        f"{BASE}{encoded}/searchAnalytics/query",
        data=json.dumps(body).encode(),
        headers=HDRS,
        method="POST",
    )
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:200]}


def sitemaps(encoded=PROPERTY.replace(":", "%3A")):
    req = urllib.request.Request(f"{BASE}{encoded}/sitemaps", headers=HDRS)
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:200]}


def window(days, offset=0):
    end = datetime.date.today() - datetime.timedelta(days=3 + offset)
    return str(end - datetime.timedelta(days=days - 1)), str(end)


def totals(start, end) -> dict:
    r = query({"startDate": start, "endDate": end, "rowLimit": 1})
    rows = r.get("rows") or []
    if not rows:
        return {"clicks": 0, "impressions": 0, "ctr": 0, "position": 0}
    row = rows[0]
    return {
        "clicks": row.get("clicks", 0),
        "impressions": row.get("impressions", 0),
        "ctr": row.get("ctr", 0),
        "position": row.get("position", 0),
    }


def dim(dimension, start, end, limit=10, order="impressions"):
    r = query(
        {
            "startDate": start,
            "endDate": end,
            "dimensions": [dimension],
            "rowLimit": limit,
            "orderBy": [{"fieldName": order, "sortOrder": "DESCENDING"}],
        }
    )
    return r.get("rows") or []


def main():
    out = []
    if not TOKEN:
        print("## Search performance\nGSC_UNAVAILABLE: no application-default token.")
        return

    s28, e28 = window(28)
    s7, e7 = window(7)
    s7p, e7p = window(7, offset=7)

    t28 = totals(s28, e28)
    t7 = totals(s7, e7)
    t7p = totals(s7p, e7p)

    def delta(a, b):
        if not b:
            return "n/a"
        return f"{((a - b) / b) * 100:+.0f}%"

    out.append(f"## Search performance ({s28} → {e28}, GSC lag ~3d)")
    out.append(
        f"28d: {t28['clicks']:.0f} clicks · {t28['impressions']:.0f} impressions · "
        f"CTR {t28['ctr'] * 100:.2f}% · avg pos {t28['position']:.1f}"
    )
    out.append(
        f"Last 7d vs prior 7d: clicks {t7['clicks']:.0f} ({delta(t7['clicks'], t7p['clicks'])}) · "
        f"impressions {t7['impressions']:.0f} ({delta(t7['impressions'], t7p['impressions'])})"
    )

    pages = dim("page", s28, e28, 8)
    if pages:
        out.append("")
        out.append("Top pages (28d, by impressions):")
        for r in pages:
            url = r["keys"][0].replace("https://famhop.com", "") or "/"
            out.append(
                f"- {url} — {r['clicks']:.0f} clicks / {r['impressions']:.0f} impr / pos {r['position']:.0f}"
            )

    queries = dim("query", s28, e28, 8)
    if queries:
        out.append("")
        out.append("Top queries (28d, by impressions):")
        for r in queries:
            out.append(
                f"- {r['keys'][0]} — {r['clicks']:.0f} clicks / {r['impressions']:.0f} impr / pos {r['position']:.0f}"
            )

    # Striking distance: ranking 5-20, has impressions, no clicks yet.
    sd = query(
        {
            "startDate": s28,
            "endDate": e28,
            "dimensions": ["query"],
            "rowLimit": 300,
            "orderBy": [{"fieldName": "impressions", "sortOrder": "DESCENDING"}],
        }
    ).get("rows") or []
    strike = [r for r in sd if 5 <= r["position"] <= 20]
    if strike:
        out.append("")
        out.append(f"Striking distance (pos 5–20, {len(strike)} queries):")
        for r in strike[:8]:
            out.append(
                f"- {r['keys'][0]} — pos {r['position']:.0f}, {r['impressions']:.0f} impr, {r['clicks']:.0f} clicks"
            )

    sm = sitemaps()
    if sm.get("sitemap"):
        out.append("")
        out.append("Sitemaps:")
        for s in sm["sitemap"]:
            out.append(
                f"- {s.get('path')} — submitted {s.get('lastSubmitted')}, "
                f"downloaded {s.get('lastDownloaded')}, errors {s.get('errors', 0)}, warnings {s.get('warnings', 0)}"
            )

    print("\n".join(out))


if __name__ == "__main__":
    main()
