#!/usr/bin/env python3
"""
FamHop Pinterest Pin Generator

Generates a daily batch of pin metadata (title, description, link, board, image)
ready for the posting automation to consume.

Usage:
    python3 generate_pins.py                    # Generate pins for today
    python3 generate_pins.py --date 2026-07-28  # Generate for a specific date
    python3 generate_pins.py --dry-run          # Preview without writing

Output:
    pins-queue/YYYY-MM-DD.json — array of pin objects to post
"""

import json
import os
import random
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
import argparse

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.json"
QUEUE_DIR = SCRIPT_DIR / "pins-queue"
POSTED_DIR = SCRIPT_DIR / "pins-posted"
POSTERS_DIR = SCRIPT_DIR.parent.parent / "public" / "weekend-posters"


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def get_weekend_dates(target_date):
    """Find the upcoming Saturday-Sunday for a given date."""
    weekday = target_date.weekday()  # 0=Mon, 5=Sat, 6=Sun
    if weekday < 5:  # Mon-Fri: next weekend
        days_to_sat = 5 - weekday
    elif weekday == 5:  # Saturday: this weekend
        days_to_sat = 0
    else:  # Sunday: this weekend
        days_to_sat = -1
    saturday = target_date + timedelta(days=days_to_sat)
    sunday = saturday + timedelta(days=1)
    return saturday, sunday


def format_dates_short(sat, sun):
    """Format like 'Jul 25–26' or 'Jul 30 – Aug 1'."""
    if sat.month == sun.month:
        return f"{sat.strftime('%b')} {sat.day}–{sun.day}"
    return f"{sat.strftime('%b')} {sat.day} – {sun.strftime('%b')} {sun.day}"


def deterministic_seed(city_id, date_str, variant):
    """Create a deterministic seed so re-running produces the same pins."""
    h = hashlib.md5(f"{city_id}:{date_str}:{variant}".encode()).hexdigest()
    return int(h[:8], 16)


def pick_template(patterns, city_id, date_str, variant):
    """Deterministically pick a template pattern."""
    rng = random.Random(deterministic_seed(city_id, date_str, variant))
    return rng.choice(patterns)


def load_manifest():
    """Load the latest weekend poster manifest if available."""
    manifest_path = POSTERS_DIR / "manifest.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            return json.load(f)
    return None


def get_event_count(manifest, city_id):
    """Get event count from manifest, with fallback estimates."""
    if manifest and city_id in manifest.get("posters", {}):
        return manifest["posters"][city_id].get("count", 20)
    # Fallback estimates by tier
    fallbacks = {
        "bay-area": 150, "los-angeles": 100, "new-york-city": 100,
        "washington-dc": 80, "chicago": 35, "dallas-fort-worth": 50,
        "houston": 35, "atlanta": 40, "philadelphia": 35, "miami": 45,
        "phoenix": 30, "boston": 25, "san-diego": 20, "honolulu": 30,
        "austin": 15, "seattle": 15
    }
    return fallbacks.get(city_id, 20)


def city_highlight_pool(city_id):
    """Pool of highlight phrases per city for description variety."""
    highlights = {
        "bay-area": [
            "Stern Grove Festival, Circus Bella, Ferry Plaza Farmers Market",
            "free museum days, outdoor concerts, kids' nature walks",
            "STEM workshops, story times, farmers markets across the Bay",
            "beach days, park programs, library events — all verified",
        ],
        "los-angeles": [
            "OC Fair, museum free days, outdoor movies in the park",
            "beach festivals, arts workshops, family-friendly shows",
            "nature hikes, library programs, free community events",
            "Griffith Park adventures, Santa Monica fun, museum days",
        ],
        "new-york-city": [
            "park events across all five boroughs, museum free hours",
            "Greenmarket, LEGO clubs, outdoor concerts in the park",
            "waterfront festivals, nature walks, free kids' workshops",
            "Brooklyn bridge walks, Queens festivals, Manhattan fun",
        ],
        "washington-dc": [
            "Smithsonian family days, nature programs, live shows",
            "free museum events, outdoor concerts on the Mall",
            "library programs, garden walks, waterfront activities",
            "Capitol Hill kids events, Georgetown family fun",
        ],
        "chicago": [
            "summer fairs, block parties, lakefront festivals",
            "museum free days, nature programs, outdoor theater",
            "Chinatown festivals, park events, library crafts",
            "Lincoln Park adventures, Navy Pier, beach activities",
        ],
        "dallas-fort-worth": [
            "zoo programs, water parks, library crafts in Frisco",
            "fair park events, nature centers, free museum days",
            "farmers markets, outdoor movies, splash pads",
            "Plano kids events, Arlington family fun, McKinney festivals",
        ],
        "houston": [
            "arboretum walks, science programs, nature activities",
            "museum district fun, park events, library programs",
            "splash pads, outdoor concerts, community festivals",
            "Pearland family events, Katy kids activities, Sugar Land fun",
        ],
        "atlanta": [
            "Piedmont Park festivals, pool parties, back-to-school events",
            "nature walks, museum programs, community markets",
            "Marietta Square events, Decatur family fun, Acworth festivals",
            "brunch shows, outdoor adventures, free library events",
        ],
        "philadelphia": [
            "Center City parades, carousel rides, book giveaways",
            "museum programs, park events, waterfront activities",
            "Bensalem workshops, Hamilton Hall concerts, library crafts",
            "Please Touch Museum, outdoor art, community festivals",
        ],
        "miami": [
            "Beach Bandshell concerts, Lincoln Road markets, museum days",
            "waterfront activities, outdoor festivals, nature programs",
            "Fort Lauderdale family fun, Coral Gables events, Key Biscayne",
            "splash parks, community days, free cultural events",
        ],
        "phoenix": [
            "Children's Museum programs, Desert Botanical Garden events",
            "indoor activities, library STEAM programs, splash pads",
            "Scottsdale family fun, Mesa events, Tempe activities",
            "early-morning outdoor events, AC-friendly museum programs",
        ],
        "boston": [
            "Children's Museum workshops, garden walks, singalongs",
            "Cambridge family fun, Somerville events, library programs",
            "waterfront activities, historical walks, outdoor concerts",
            "escape rooms, nature programs, community festivals",
        ],
        "san-diego": [
            "Balboa Park activities, Spreckels Organ concerts, beach events",
            "carousel rides, museum free days, nature programs",
            "La Jolla family fun, North County events, Coronado activities",
            "zoo programs, waterfront walks, outdoor art marts",
        ],
        "honolulu": [
            "Waimea Valley concerts, beach programs, cultural events",
            "keiki activities, nature walks, community gatherings",
            "Kapolei family events, Haleiwa fun, Pearl City activities",
            "hip hop for families, therapy pets, book programs",
        ],
        "austin": [
            "LEGO festivals, museum free days, outdoor movies",
            "Round Rock family events, library programs, nature walks",
            "live music for kids, food truck festivals, splash pads",
            "chess clubs, Pokemon meetups, family story times",
        ],
        "seattle": [
            "Seafair events, outdoor theater, waterfront festivals",
            "Volunteer Park programs, Bellevue workshops, nature walks",
            "Pike Place adventures, library events, community concerts",
            "rain-or-shine indoor activities, museum programs, art walks",
        ],
    }
    return highlights.get(city_id, ["family events, free activities, kids workshops"])


def generate_pins_for_date(config, target_date, manifest=None):
    """Generate the full day's pin queue."""
    pins = []
    cities = config["cities"]
    templates = config["pin_templates"]
    tier_pins = config["posting"]["tier_daily_pins"]
    date_str = target_date.strftime("%Y-%m-%d")
    day_of_week = target_date.weekday()  # 0=Mon ... 6=Sun

    saturday, sunday = get_weekend_dates(target_date)
    dates_short = format_dates_short(saturday, sunday)
    is_weekend = day_of_week >= 5

    for city_id, city_cfg in cities.items():
        tier = city_cfg["tier"]
        num_pins = tier_pins.get(tier, 1)
        display = city_cfg["display"]
        url_slug = city_cfg["url_slug"]
        event_count = get_event_count(manifest, city_id)
        highlights_pool = city_highlight_pool(city_id)

        city_board = city_cfg["board"]
        main_board = "Weekend with Kids"
        poster_path = str(POSTERS_DIR / f"{city_id}.png")
        link = f"https://famhop.com/{url_slug}/this-weekend/"

        for i in range(num_pins):
            variant = f"v{i}"
            rng = random.Random(deterministic_seed(city_id, date_str, variant))
            highlights = rng.choice(highlights_pool)

            # Decide pin type based on day and variant
            if i == 0:
                # First pin is always the weekend roundup (or daily if weekday)
                if is_weekend or day_of_week >= 3:  # Thu-Sun: weekend focus
                    pin_type = "weekend_roundup"
                else:
                    pin_type = "daily_spotlight"
            elif i == 1:
                # Second pin: evergreen angle for search traffic
                pin_type = "evergreen"
            else:
                # Additional pins: rotate
                pin_type = rng.choice(["weekend_roundup", "daily_spotlight", "evergreen"])

            type_templates = templates[pin_type]
            title_pattern = pick_template(type_templates["title_patterns"], city_id, date_str, f"title_{variant}")
            desc_pattern = pick_template(type_templates["description_patterns"], city_id, date_str, f"desc_{variant}")

            title = title_pattern.format(
                city=display,
                count=event_count,
                dates=dates_short
            )
            description = desc_pattern.format(
                city=display,
                count=event_count,
                dates=dates_short,
                highlights=highlights
            )

            # Assign to board: first pin to city board, others alternate
            if i == 0:
                board = city_board
            elif i % 2 == 1:
                board = main_board
            else:
                board = city_board

            pin = {
                "id": f"{city_id}_{date_str}_{variant}",
                "city_id": city_id,
                "city": display,
                "type": pin_type,
                "title": title[:100],  # Pinterest title limit
                "description": description[:500],  # Pinterest desc limit
                "link": link,
                "board": board,
                "image_path": poster_path,
                "status": "pending",
                "scheduled_date": date_str,
                "created_at": datetime.utcnow().isoformat() + "Z"
            }
            pins.append(pin)

    # Shuffle pins so cities are interleaved (not all Bay Area then all LA)
    rng = random.Random(deterministic_seed("shuffle", date_str, "main"))
    rng.shuffle(pins)

    return pins


def main():
    parser = argparse.ArgumentParser(description="Generate FamHop Pinterest pins")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD), default today")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--days", type=int, default=1, help="Generate for N days ahead")
    args = parser.parse_args()

    config = load_config()
    manifest = load_manifest()

    if args.date:
        start_date = datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        start_date = datetime.utcnow().date()

    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    POSTED_DIR.mkdir(parents=True, exist_ok=True)

    for day_offset in range(args.days):
        target_date = start_date + timedelta(days=day_offset)
        date_str = target_date.strftime("%Y-%m-%d")
        pins = generate_pins_for_date(config, target_date, manifest)

        # Summary
        by_city = {}
        by_type = {}
        by_board = {}
        for p in pins:
            by_city[p["city"]] = by_city.get(p["city"], 0) + 1
            by_type[p["type"]] = by_type.get(p["type"], 0) + 1
            by_board[p["board"]] = by_board.get(p["board"], 0) + 1

        print(f"\n{'='*60}")
        print(f"Date: {date_str} ({target_date.strftime('%A')})")
        print(f"Total pins: {len(pins)}")
        print(f"By type: {json.dumps(by_type)}")
        print(f"By board (top 5): {json.dumps(dict(sorted(by_board.items(), key=lambda x: -x[1])[:5]))}")
        print(f"Cities covered: {len(by_city)}")

        if args.dry_run:
            print("\nSample pins:")
            for p in pins[:3]:
                print(f"  [{p['type']}] {p['board']}")
                print(f"    Title: {p['title']}")
                print(f"    Desc:  {p['description'][:80]}...")
                print(f"    Link:  {p['link']}")
                print()
        else:
            output_path = QUEUE_DIR / f"{date_str}.json"
            with open(output_path, "w") as f:
                json.dump(pins, f, indent=2)
            print(f"Written to: {output_path}")


if __name__ == "__main__":
    main()
