mixin () {
  /// Returns the public API documentation as static Markdown.
  public query func getApiDoc() : async Text {
    "# Grand-Scale Historical RTS — Backend API\n" #
    "\n" #
    "## Purpose\n" #
    "\n" #
    "This canister persists the outcome of single-player historical RTS skirmishes and\n" #
    "each player's match-setup preferences. It exposes a small, caller-scoped API:\n" #
    "record a completed match, read recent matches and aggregate statistics, and read\n" #
    "or save per-player settings. It also exposes the OQL query surface (`schema` and\n" #
    "`execute`) so the Caffeine Data Intelligence agent can answer natural-language\n" #
    "questions over the persisted match and settings data.\n" #
    "\n" #
    "## Authentication and identity\n" #
    "\n" #
    "- `recordMatch`, `saveSettings`, `getSettings`, `listRecentMatches`, and\n" #
    "  `getMatchStats` are caller-scoped: they read and write only the rows belonging\n" #
    "  to the principal that signs the call. They do not require a role, but they do\n" #
    "  require a stable identity. The anonymous principal is a single shared identity\n" #
    "  presented by every unauthenticated visitor, so it is never used as a data key:\n" #
    "  `recordMatch` and `saveSettings` trap for an anonymous caller, and\n" #
    "  `listRecentMatches`, `getMatchStats`, and `getSettings` return empty results\n" #
    "  for an anonymous caller. Sign in before calling any of them.\n" #
    "- The app's frontend pins an Internet Identity derivation origin, published at\n" #
    "  `/.well-known/ii-derivation-origin` when available. An agent already holding\n" #
    "  the user's Internet Identity authorization derives the correct per-app\n" #
    "  principal against that origin (for example\n" #
    "  `icp identity link web <name> --app <host>`). Such a delegation acts with the\n" #
    "  user's full authority in this app until it expires.\n" #
    "- The OQL `schema` and `execute` endpoints are authorization-checked per entity\n" #
    "  against the live caller. The `match` and `playerSettings` entities are\n" #
    "  `controllerOnly`: only the platform controller (the Data Intelligence agent)\n" #
    "  reads them, and no end user reads them directly through OQL. The regular\n" #
    "  caller-scoped endpoints above are the supported path for a player's own data.\n" #
    "- `getApiDoc` is a public query and requires no authentication.\n" #
    "\n" #
    "## Endpoints\n" #
    "\n" #
    "### `recordMatch(faction, mapSize, difficulty, result, durationSeconds) : async MatchId`\n" #
    "\n" #
    "Records one completed skirmish for the caller and returns its assigned id.\n" #
    "\n" #
    "- `faction` — `#romans | #mongols | #vikings`\n" #
    "- `mapSize` — `#small | #medium | #large`\n" #
    "- `difficulty` — `#easy | #normal | #hard`\n" #
    "- `result` — `#victory | #defeat`\n" #
    "- `durationSeconds` — match length in **seconds** (a plain `Nat`, not nanoseconds)\n" #
    "- Returns the new `MatchId` (`Nat`), assigned from a monotonic counter shared\n" #
    "  across all callers.\n" #
    "\n" #
    "### `listRecentMatches(limit) : async [MatchRecord]`\n" #
    "\n" #
    "Returns the caller's matches, **newest first**, capped at `limit`. `limit = 0`\n" #
    "returns an empty array. Ordering is by insertion order reversed, so the most\n" #
    "recently recorded match is first.\n" #
    "\n" #
    "### `getMatchStats() : async MatchStats`\n" #
    "\n" #
    "Returns aggregate statistics over all of the caller's recorded matches:\n" #
    "`totalMatches`, `wins`, `losses`, `totalDurationSeconds` (seconds), and\n" #
    "`byFaction`, an array with one entry per faction (`#romans`, `#mongols`,\n" #
    "`#vikings`) carrying `wins`, `losses`, and `totalMatches`. Factions with no\n" #
    "matches are still present with zero counts.\n" #
    "\n" #
    "### `getSettings() : async ?PlayerSettings`\n" #
    "\n" #
    "Returns the caller's saved settings, or `null` if none have been saved.\n" #
    "`PlayerSettings` is `{ preferredFaction : Faction; preferredDifficulty :\n" #
    "AiDifficulty; lastMapSize : MapSize }`.\n" #
    "\n" #
    "### `saveSettings(value) : async PlayerSettings`\n" #
    "\n" #
    "Overwrites the caller's settings with `value` and returns the stored value.\n" #
    "This is a full replace, not a merge.\n" #
    "\n" #
    "### `getApiDoc() : async Text`\n" #
    "\n" #
    "Returns this document.\n" #
    "\n" #
    "### OQL: `schema()` and `execute(queryJson)`\n" #
    "\n" #
    "Exposes the `match` and `playerSettings` entities to the Data Intelligence\n" #
    "agent. Both are controller-only. `schema()` reports the entity fields;\n" #
    "`execute` accepts a JSON query (filter / order / paginate / aggregate).\n" #
    "\n" #
    "## Units and encoding\n" #
    "\n" #
    "- `durationSeconds` and `totalDurationSeconds` are **seconds**.\n" #
    "- `recordedAt` is a **nanosecond** Unix-epoch timestamp (`Time.now()`), not\n" #
    "  seconds. Do not mix the two.\n" #
    "- `MatchId` is a `Nat`; ids are unique across all callers, not per caller.\n" #
    "- Variant fields cross the API boundary as Candid variants (`#romans`, …), not\n" #
    "  as text. The OQL projection renders them as lowercase text\n" #
    "  (`romans`, `medium`, `normal`, `victory`).\n" #
    "- `?PlayerSettings` is a Candid `opt`; `null` means never saved.\n" #
    "\n" #
    "## Lifecycle and polling\n" #
    "\n" #
    "- All endpoints are request/response; there is no background job and nothing to\n" #
    "  poll. A match is persisted synchronously by `recordMatch`, so a subsequent\n" #
    "  `listRecentMatches` or `getMatchStats` call observes it immediately.\n" #
    "- `listRecentMatches` and `getMatchStats` are `query` calls: they read the\n" #
    "  replicated state without consensus and are safe to call frequently.\n" #
    "\n" #
    "## Mutation retry safety\n" #
    "\n" #
    "- `recordMatch` is **not idempotent**: each successful call appends a new record\n" #
    "  and consumes a new id. Retrying a call that already succeeded creates a\n" #
    "  duplicate match. If a call's result is unknown, re-read `listRecentMatches`\n" #
    "  before retrying.\n" #
    "- `saveSettings` is idempotent: saving the same value repeatedly leaves the same\n" #
    "  single stored settings record.\n" #
    "\n" #
    "## Errors and gotchas\n" #
    "\n" #
    "- There are no caller-fixable error variants; the endpoints return values\n" #
    "  directly. A trap indicates a platform-level failure (for example, an\n" #
    "  out-of-cycles or serialization error), not a validation failure.\n" #
    "- `recordMatch` and `saveSettings` trap with\n" #
    "  `Unauthorized: sign in to access your match data` when the caller is the\n" #
    "  anonymous principal. The read endpoints do not trap for an anonymous caller;\n" #
    "  they return empty results (`[]`, `null`, or zeroed statistics).\n" #
    "- `durationSeconds` is not validated against a maximum; passing an implausible\n" #
    "  value is accepted and will skew `totalDurationSeconds`.\n" #
    "- Statistics are computed on read over the caller's full match history, so cost\n" #
    "  grows with the number of matches a caller has recorded.\n" #
    "- The OQL entities are controller-only by design; a player cannot read their own\n" #
    "  rows through `execute`. Use the caller-scoped endpoints instead.\n"
  };
};
