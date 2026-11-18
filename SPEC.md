# PoE2 Economy Reporter — specification

## Scope and status

One instance sends an English-language daily Path of Exile 2 economy report and limited significant alerts to one Gryt channel. Source: poe.ninja. One Node.js process, one container, one persistent volume at `/app/data`. No inbound ports, database, external scheduler, LLM, bot SDK, plugin, web UI, chat commands, trading advice, item appraisal or farming-profit estimates.

The review decisions below are accepted. Current scope: documentation and development tooling only. Application, Docker/Compose, commands and CI will be implemented in a separate session. Planned interfaces below are not working commands yet.

## Source classification

Use the documented public economy API only. `GET /poe2/api/economy/leagues` lists leagues; the first entry is documented as the current temporary challenge league. Use its `id`, allow an explicit override, retain the last valid selection on discovery failure, and wait for discovery if no league has ever been resolved. Never mix league histories.

Exchange sources use `/poe2/api/economy/exchange/current/overview`; stash sources use `/poe2/api/economy/stash/current/item/overview`, with `league` and `type` query parameters. Keep adapters and a centralized classification table separate from formatting.

| Output group | Sources and inclusion rules |
| --- | --- |
| Currency rates | All eligible `Currency` entries, including crafting orbs. No entries from this source appear in item rankings or automatic alerts. |
| Socketable Currency (`socketable`) | `Runes`, `SoulCores`, `Idols`. |
| Lineage Supports (`lineage_supports`) | `LineageSupportGems`. |
| Crafting Currency (`crafting`) | `Essences`, Omens from `Ritual`, Catalysts from `Breach`, Liquid Emotions from `Delirium`; exclude fragments/access items from mixed sources. |
| Uniques (`uniques`) | `UniqueWeapons`, `UniqueArmours`, `UniqueAccessories`, `UniqueFlasks`, `UniqueCharms`, `UniqueJewels`, `UniqueSanctumRelics`, `UniqueTablets`; preserve source variants. |
| Boss Fragments (`boss_fragments`) | Verified boss fragments and boss-access items from `Fragments` and other relevant exchange sources, with explicit source/item IDs; exclude ordinary materials. |

Use source types and explicit IDs, not names alone or metadata `category`. Reviewed Soul Cores can be labeled `Vaal`, Idols `Expedition`; mechanics endpoints contain mixed item types. A boss-access item belongs only to `boss_fragments`. Deduplicate overlapping sources without combining different variants. No duplicate identities across output groups.

`Abyss` and `Verisium` require item-level purpose/ID verification before inclusion; exclude them by default until verified. `UncutGems`, non-boss fragments/access items, other Expedition items and `PrecursorTablets` are outside the default report. Operators may include verified items from supported sources through the overrides below. New mechanics are not added automatically.

Before implementing boss mapping, query representative `Fragments` and relevant boss-access sources, verify purposes against official sources, and record supported IDs in the adapter and fixtures. Do not guess IDs. A required boss source that fails or is stale makes that group incomplete unless the operator explicitly disables it as described below.

### League adjustments through YAML

Built-in mapping remains the default. Add only two override mechanisms; no configurable endpoint URLs, arbitrary transformations or new output groups.

- `classification.overrides` defaults to `[]`. Each rule has exactly `source`, `id` and `group`. Source is a known API type from the implemented adapter registry. Exchange `id` means `line.id`; stash `id` means stable `itemId`, applying to every published variant while preserving separate variant/corruption identities. Duplicate source/ID rules are invalid. A non-null group assigns or reassigns the item once; `group: null` excludes it. Rules run after built-in classification and before deduplication/activity filtering.
- Exchange entries may target `socketable`, `lineage_supports`, `crafting` or `boss_fragments`; supported unique stash entries may target `uniques`. Exclusion is allowed for either. Reject incompatible source/group pairs. `Currency` cannot be reassigned or excluded here: retain its currency-only contract and use `currency.excluded_ids` for its ranking. Rules do not bypass price, variant, freshness, activity or historical-baseline validation.
- An inclusion rule activates its supported source even if unused by the default mapping. A previously unused exchange source needs an explicit positive `liquidity.exchange_min_volume_divine` threshold unless every included item uses the dedicated boss threshold; never invent a fallback. Known source adapters/registry entries and their formats must be validated with fixtures before implementation handoff. Entirely new API types/formats still require a code/image update.
- An item absent from the selected league is an unmatched rule, not a fabricated observation or startup error. `check` and startup diagnostics warn with source/ID. Keep configuration global to the instance, not automatic per-league profiles; operators review rules when switching leagues. New leagues keep separate price histories and item/group signal state; instance-wide daily caps and report deduplication survive a league switch.
- `sources.disabled` defaults to `[]`, containing unique known API source types. Do not fetch or reuse cached data from disabled sources for any report/alert. `Currency` is mandatory for rates/conversion and cannot be disabled. Disabling takes precedence over item rules; retain dormant rules and warn rather than requiring their removal.
- Disabling explicitly reduces coverage, allowing daily publication from the remaining usable sources. Every affected report group and its group alerts must list excluded source types and say coverage is reduced; if no contributing sources remain, render the section as disabled/unavailable and suppress its alerts. Individual alerts never use excluded entries. A failed source is never automatically disabled: still defer affected reports/alerts until recovery or an explicit config change. Always show the configured omissions in report metadata, including sources with no currently matched items.
- Evaluate group-alert denominators only over the remaining included eligible universe; preserve the minimum eligible count. After a mapping/source-coverage change, reset affected pending item/group confirmations and group trend rearming, then require new evidence. Preserve item identities, last-alerted prices, cooldowns, daily counters and sent/unknown delivery records. Do not compare a newly classified item against history where it was excluded or belonged to another group; it warms up again for the required horizon. Raw history may remain for retention/debugging. Do not send old unsent report parts under a different classification/coverage: cancel those parts with an actionable warning, preserving successful/unknown records and existing same-day deduplication.

All config edits require restart, not an image rebuild. Known-source item additions/exclusions and deliberate source omissions work through YAML; adapter/format changes and new report groups require code. `check` must display effective source coverage, unmatched/dormant rules and missing activity thresholds without modifying production state.

## Observations and conversion

- Refresh hourly without overlap. Identify the app/contact with User-Agent, honor ETag/cache headers, use bounded timeouts, modest concurrency and rate-limit backoff. Do not bypass upstream caching.
- Retain seven days of compact JSON observations with league, source, stable identity/variant, original price/reference currency, conversion rates, available activity indicators, UTC observation time and freshness metadata. Do not store full API descriptions/icons/modifiers.
- Join exchange lines/metadata by `id`. Stash keys include `itemId`, meaningful `variant` and `corrupted`, scoped to source/league; do not depend on names or numeric stash line IDs alone. Preserve only variants published by the source; never infer appraisal of individual rolls.
- Normalize each observation to Div with its own response's `core`, rather than assuming all sources share simultaneous rates. In the reviewed Currency sample, `primary=divine`, `rates.exalted=513.4` means 513.4 Ex per Div. Validate direction against fixtures; store rates used. Core rates differ between sources.
- Calculate item changes with unrounded Div values. Display prices at least 1 Div in Div, otherwise Ex using a valid Currency rate from the current fetch cycle. Currency-pair changes compare the pair itself: Divine/Exalted is Ex per Div, Chaos/Exalted is Ex per Chaos, Mirror/Divine is Div per Mirror.
- Compare to the closest distinct valid observation near the 6h/24h horizon, maximum one-hour deviation; on an equal-distance tie prefer the earlier baseline. Require finite positive prices, valid conversions and qualifying activity at both endpoints. Missing history is unavailable, never zero. Missing items do not have zero prices.

## Accepted conservative freshness policy

The reviewed overview responses expose no source generation timestamp. HTTP `Date` is response time; sparklines are not dated observations suitable for these horizons. Freshness is an estimate, not proof the upstream producer is current.

- Track successful retrieval time, ETag, deterministic fingerprint of meaningful pricing/activity/conversion content, and time that content was first observed to change. Exclude ordering, images and descriptive metadata from the fingerprint. An ETag change alone is insufficient.
- The first valid response starts a provisional freshness interval. Identical content and `304` do not advance last-change time or count as distinct alert confirmations. Repeated observations can record an unchanged price for local history while the source remains usable; never invent a new source snapshot.
- A source is usable only while both its last successful retrieval and last observed content change are at most `freshness.max_unchanged_hours` old (default 2). Failures extend neither clock.
- This intentionally may suppress valid unchanged quiet-market data. The two-hour limit is an accepted configurable operational assumption, not an upstream guarantee.
- Save successful sources independently; do not present a fetch cycle as an atomic upstream snapshot. Label output `Observed at`, using a time range when observations differ.
- Suppress affected stale/incomplete group alerts. Publish a daily report only when Currency and all non-disabled required sources for enabled sections are usable; disclose deliberate coverage reductions. Defer after failure rather than substitute stale cached data or automatically omit a source. Valid short/empty rankings after filtering are different from failed/incomplete sources.
- Two confirmations need distinct relevant fresh source contents, not repeated GETs. Group confirmation requires updated evidence for the items counted toward its qualifying movement, not merely an unrelated source changing.

## Activity filters

Apply thresholds to current observations and, for changes, baselines. Normalize exchange `volumePrimaryValue` from the response primary currency to Div. Its time window is unverified: call it `Trading volume`, never `Volume/Hour` or daily turnover. Stash `listingCount` is active listings, not completed sales.

| Source | Initial minimum |
| --- | --- |
| Currency, Ritual/Omens | 20 Div turnover |
| Runes, SoulCores, Idols, LineageSupportGems | 10 Div turnover |
| Essences, Breach/Catalysts, Delirium/Liquid Emotions | 5 Div turnover |
| Boss Fragments, regardless of containing source | 10 Div turnover |
| All eight unique types | 30 listings |

These provisional noise filters do not guarantee reliable prices: an expensive trade can meet turnover thresholds. The reviewed single-league sample retained 15/121 Runes, 4/48 Soul Cores and 2/34 Idols at 10 Div, and 5/51 Essences at 5 Div. Short rankings are expected. Boss defaults must be checked against representative data before implementation; document any necessary change before implementing it.

## Daily report

Default 09:00 Europe/Riga, once per local calendar day after fresh complete data. Include title, league, requested 24h comparison window, observation timestamp and source link. Output is English.

### Block 1 — Currency rates

- Three fixed pairs: Divine/Exalted, Chaos/Exalted, Mirror/Divine, with 24h changes. Show unavailable for invalid/missing pair data rather than invent values.
- Up to 10 additional eligible `Currency` entries by current Div turnover descending, then stable ID. Omit duplicate Divine, Chaos and Mirror rows represented by anchor pairs; Exalted may remain in this ranking.
- Exclude base Orb of Transmutation and Orb of Augmentation by verified IDs (`transmute`, `aug` in the reviewed response). Do not automatically exclude improved Greater/Perfect versions. Make the exclusion ID list configurable.
- Each ranked row: name, current price, signed 24h change or `—`. Turnover selects the ranking but need not be printed. Anchor changes compare pair rates; additional ranked currencies compare their Div prices.
- All Currency entries are confined to this block and the manual currency command; no item rankings or automated Currency alerts.

### Block 2 — Market movements

- For each of `socketable`, `lineage_supports`, `crafting`, `uniques`: top 5 positive and top 5 negative 24h changes, ordered by percentage after filtering, stable ID for ties.
- Each row: name/variant, current price and signed change. Never pad with unchanged or ineligible entries.
- Optional short factual summary produced deterministically from supported movements.

### Block 3 — Most expensive items and Boss Fragments

- Separate top 10 for each of the four item groups, plus a dedicated top 10 Boss Fragments/access-items section. Sort by current Div price descending, then stable ID.
- Each row: name/variant, price, signed 24h change or `—`.
- Boss Fragments gets this expensive ranking and automatic alerts; no additional daily gainers/losers section is required.

Three logical blocks, up to 90 item-ranking rows plus three fixed pairs and ten currency rows. Physical cards/messages may differ: split at group boundaries or labeled continuation sections, number parts, preserve ordering and all eligible rows. Never silently truncate rankings or names.

## Intermediate alerts

Rules cover all five item groups, including Boss Fragments; Currency is excluded.

### Individual items — all conditions required

1. Absolute movement at least 25% and 0.5 Div over 6 hours.
2. Qualifying activity and valid baseline.
3. Two consecutive distinct fresh observations qualify in the same direction. Failed/stale cycles, interruption, lost eligibility or a broken condition reset pending confirmation; duplicates never advance it.
4. At least 12 hours since the last item alert, regardless of direction.
5. Repeat alerts also require at least 25% and 0.5 Div movement from the last alerted price, in the current signal direction. Cooldown expiry alone cannot retrigger.

### Group movements — all conditions required

1. A group is one of the five output item groups, not a raw API type. Denominator: all group items with valid 24h baselines and qualifying activity at both endpoints. Require at least 10 items.
2. At least 30% of the denominator move in one direction by at least 15% over 24 hours. Compare unrounded fractions, equivalent to rounding required item counts upward.
3. Two consecutive distinct fresh observations confirm the same group/direction; use the same interruption/reset rules as individual alerts.
4. Cooldown 12 hours per group/direction. The qualifying trend must cease, then qualify and confirm again; an ongoing unchanged trend never retriggers after cooldown alone.

### Selection and delivery limits

- Score eligible item signals by an equally weighted sum of percentile ranks of absolute percentage movement, absolute Div movement and activity, within the same source/activity type. Average ranks for ties, percentile 0.5 for a singleton, stable identity as final tie-break. Never compare raw turnover and listings.
- Merge related group/item events. Show at most three notable items, current/baseline prices, movement, actual comparison interval, group and source. Group-only signals show affected count/denominator. Keep one alert within one physical message, selecting fewer examples if needed without omitting essential signal details.
- Maximum three automatic intermediate physical messages per local day across all groups. Daily report parts and explicit manual/test messages are excluded. Reserve before POST; retrying a definitely rejected request reuses the reservation.
- Persist confirmations, cooldowns, last alerted prices, group rearming and day counters. No stale/backfilled alerts after downtime. Retain valid history but reset pending confirmations across restart/downtime; require a new fresh sequence.

## Storage, scheduling and delivery

- Compact JSON snapshots and a small versioned state file, atomic replacement on the same filesystem, seven-day retention, league isolation. Prune old observations without losing delivery state. Enforce one scheduled writer per directory.
- Read-only commands never modify production state. Ignore unfinished temporary files. Preserve corrupted history, warn and stop using it; never silently discard corruption. Corrupt delivery state blocks automatic sending pending explicit repair, rather than resetting counters.
- Schedule using IANA timezone and local date: once through a repeated DST time, first opportunity after a nonexistent scheduled time. Recover a missed report only for the current day after scheduled time and fresh complete data. No earlier-day replays. Deduplicate by instance/local date even if league changes during that day.
- Persist immutable numbered report payloads before sending; track successful parts independently. Never regenerate remaining parts from another snapshot. Stop a pending report when payload becomes stale or its day ends; log incompleteness and preserve successful-part records.
- Persist `sending` before automatic POST; on valid success store `sent` and `message_id`. Timeout, ambiguous 5xx, malformed success or restart with `sending` becomes `unknown`, is not replayed, and conservatively reserves alert slots/cooldowns. Do not proceed past an unknown report part. Exactly-once webhook delivery is not promised.
- Explicit validation/auth/not-found/body-size rejections are errors to correct. A definite `429` may retry after `retry_after_ms` while freshness/day limits hold. Log response warnings without secret URLs. Never blindly retry a possibly successful POST.
- Use Gryt `cards`, not Discord `embeds`. Reviewed limits: 10 cards/message, 25 fields/card, title 256, description 4000, field name 256, field value 1024, footer 2048; total card text 6000 characters, message `text` 4000, body 256 KiB. Validate individual, aggregate and serialized-byte limits, including numbering overhead. No images by default. Pace messages at least two seconds apart and honor rate-limit delays.

## Configuration and commands

`config.example.yaml` defines accepted defaults. YAML is optional; deep-merge known mappings, replace explicitly supplied lists, reject unknown keys/types/ranges. Changes apply on restart. English and seven-day retention are fixed; no `language` or `history_days` option.

Timezone precedence: explicit YAML `timezone` > nonempty environment `TZ` > Europe/Riga. The only required normal-deployment setting is environment `GRYT_WEBHOOK_URL`. Never put it in YAML, logs or history. Validate URL, IANA zones and `HH:MM` time at startup. Locally read optional `./config.yaml`; the planned container uses optional `/app/config.yaml`. Missing file uses defaults; malformed/invalid file stops startup.

Refresh interval is at least 60 minutes; freshness ceiling is at least that interval. Thresholds are positive; affected share is at most 100 percent, while movement thresholds may exceed 100 percent. Counts are positive integers, confirmation checks at least 2, daily cap and alert examples at most 3. Time windows must fit seven-day retention and sampling; reject a horizon the schedule cannot meaningfully observe. Cooldown is independent of history retention. `daily_report.categories` controls daily sections only; alert group coverage is independent.

Planned commands:

- `check`: config/source checks, no Gryt POST or production writes. Report unsupported sources/classification problems explicitly.
- `preview`: local rendering from read-only history, exposing missing/stale/incomplete status. `--demo` uses deterministic fixtures with no network, history or webhook requirement. No production writes or Gryt calls.
- `send-test`: explicitly send one labeled test message, separate from scheduled state and without automatic retries.
- `report-currency`: explicitly publish just the currency block from usable stored observations; refuse stale/missing data. Can read atomic history while scheduler runs, without acquiring its writer role or changing scheduled state/counters. No automatic retry of ambiguous sends; print success ID or an actionable uncertain result. No inbound/chat listener.

Only scheduler, `send-test` and `report-currency` require a webhook. Test implementation with mocked delivery unless real sending is authorized.

## Deployment and acceptance

- Node.js 24 LTS, npm lockfile, non-root multi-stage image, Compose service `reporter`, no exposed ports, writable named volume and optional read-only YAML mount. Fresh volume ownership works without a manual root/chown step. Graceful shutdown and `restart: unless-stopped`.
- Minimal dependencies: native fetch, filesystem, date/Intl and Node test runner where sufficient; YAML parser and TypeScript tooling as needed. No extra framework.
- GitHub Actions will typecheck/test/build changes and publish versioned GHCR images plus `latest` on release tags. Do not publish, push or send real webhooks without authorization. Image coordinates depend on the future repository/package owner.
- Deterministic fixtures/mocked-network tests cover conversion direction and differing source rates; filtering, mixed IDs and variants; classification includes/exclusions, duplicate/incompatible rules, unmatched/dormant IDs, source disabling/disclosure, coverage changes and preserved cooldowns/counters; all rankings including Currency and Boss Fragments; horizon edges, unchanged/304/stale/missing data; both alert directions/boundaries, confirmation gaps, denominator/rearming, cap, league changes, DST, restart/corruption, ambiguous delivery and payload splitting.
- MVP handoff requires typechecking, tests, production build and Docker demo if available. Preserve all eligible report rows and prove demo/read-only commands cannot send or modify production state.

## Verification and remaining source checks

Review date: 2026-11-18. Sources: [poe.ninja API documentation](https://poe.ninja/docs/api), representative Forbidden Rites API responses, [Gryt webhook documentation](https://docs.gryt.chat/docs/build/webhooks), [OpenAPI](https://github.com/Gryt-chat/server/blob/main/openapi/webhooks.json) and [POST handler](https://github.com/Gryt-chat/server/blob/main/src/routes/webhooks.ts).

Representative responses were checked for Currency, Runes, SoulCores, Idols, LineageSupportGems, Essences, Ritual, Breach, Delirium, Abyss, Verisium and all eight included unique types. Fragments, UncutGems, Expedition and PrecursorTablets are documented; boss coverage/IDs need representative verification before implementation. Source generation time, turnover window and a real multi-variant example remain unverified. Actual deployed Gryt compatibility has not been tested; current upstream limits do not guarantee behavior on every self-hosted version. No live webhook was called.
