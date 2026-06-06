// Print the current month's Google Places API usage vs. the free caps.
//   npm run places:usage
import { printUsage } from "./lib/places-usage.mjs";

const monthArg = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
printUsage(monthArg);
