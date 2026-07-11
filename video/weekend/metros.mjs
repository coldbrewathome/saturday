// Per-metro theming for the weekend videos. Each metro gets its own accent
// color, nickname, and landmark emojis so the video feels local to that city.
// The FamHop wordmark stays coral everywhere (brand); `accent` colors the hook
// number, pins, and chips. `map`: "bay" uses the hand-drawn SF Bay; everything
// else uses the generic city map (pins placed by the metro's auto-computed bbox).
// `bbox` is only set where the map geometry is fixed (bay-area).

export const METROS = {
  "bay-area":        { label: "Bay Area",            nickname: "the Bay",                    accent: "#FF6B5B", emojis: ["🌉", "🌳", "🚋", "🦭"], map: "bay",
                       bbox: { latMax: 38.6, latMin: 36.5, lonMin: -122.9, lonMax: -121.3 } },
  "new-york-city":   { label: "New York City",       nickname: "the Big Apple",              accent: "#2F6FED", emojis: ["🗽", "🌆", "🚕", "🎭"], map: "generic" },
  "los-angeles":     { label: "Los Angeles",         nickname: "LA",                         accent: "#F5A623", emojis: ["🌴", "🎬", "🏖️", "☀️"], map: "generic" },
  "chicago":         { label: "Chicago",             nickname: "the Windy City",             accent: "#2C7BE5", emojis: ["🌭", "🎡", "🏙️", "🌬️"], map: "generic" },
  "miami":           { label: "Miami",               nickname: "the Magic City",             accent: "#FF5FA2", emojis: ["🌴", "🏖️", "🦩", "🌊"], map: "generic" },
  "washington-dc":   { label: "Washington, D.C.",    nickname: "the District",               accent: "#3B5BA5", emojis: ["🏛️", "🌸", "🦅", "🎒"], map: "generic" },
  "atlanta":         { label: "Atlanta",             nickname: "the A",                      accent: "#E8552B", emojis: ["🍑", "🌳", "🦅", "🎶"], map: "generic" },
  "dallas-fort-worth":{ label: "Dallas–Fort Worth",  nickname: "DFW",                        accent: "#1F7A4D", emojis: ["🤠", "🐎", "⭐", "🌵"], map: "generic" },
  "houston":         { label: "Houston",             nickname: "Space City",                 accent: "#EB6E1F", emojis: ["🚀", "🤠", "🌮", "🎢"], map: "generic" },
  "austin":          { label: "Austin",              nickname: "the Live Music Capital",     accent: "#6CA02C", emojis: ["🎸", "🌮", "🦇", "🛶"], map: "generic" },
  "phoenix":         { label: "Phoenix",             nickname: "the Valley",                 accent: "#E0513F", emojis: ["🌵", "☀️", "🏜️", "🌶️"], map: "generic" },
  "san-diego":       { label: "San Diego",           nickname: "America's Finest City",      accent: "#00A3C7", emojis: ["🏖️", "🌊", "🐬", "🌮"], map: "generic" },
  "seattle":         { label: "Seattle",             nickname: "the Emerald City",           accent: "#2E8B72", emojis: ["🏔️", "🌲", "☕", "☔"], map: "generic" },
  "boston":          { label: "Boston",              nickname: "Beantown",                   accent: "#2456A6", emojis: ["⚓", "🦞", "🎓", "🍂"], map: "generic" },
  "philadelphia":    { label: "Philadelphia",        nickname: "Philly",                     accent: "#2E7DB0", emojis: ["🔔", "🥨", "🎻", "🦅"], map: "generic" },
  "honolulu":        { label: "Honolulu",            nickname: "the Gathering Place",        accent: "#16A6A6", emojis: ["🌺", "🏝️", "🌊", "🍍"], map: "generic" },
};

export const DEFAULT_THEME = { label: "Your City", nickname: "town", accent: "#FF6B5B", emojis: ["🎉", "🌳", "🎨", "🎵"], map: "generic" };
