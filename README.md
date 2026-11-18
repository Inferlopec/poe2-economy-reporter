# PoE2 Economy Reporter

Self-hosted daily Path of Exile 2 market reports and significant alerts for Gryt Chat, powered by poe.ninja.

> Documentation and development tooling only. Application, Docker image, Compose file and service commands are not implemented yet. MVP implementation is reserved for a separate session. Deployment/service commands below describe the accepted interface.

## Accepted behavior

- Daily at 09:00 Europe/Riga: three fixed currency pairs plus up to ten other currencies by turnover; top five increases/decreases and top ten most expensive items for Socketable Currency, Lineage Supports, Crafting Currency and Uniques; a separate top ten most expensive Boss Fragments/access items.
- All API `Currency` entries, including crafting orbs, appear only in the currency block. Base Transmutation and Augmentation are excluded from its additional ranking, without automatically excluding improved versions.
- Crafting Currency includes Essences, Omens, Catalysts and Liquid Emotions. Mixed mechanics endpoints need explicit item classification. Verified boss fragments/access items from different sources form one group.
- Individual/group alerts cover all four item groups and Boss Fragments. Maximum three automatic intermediate messages per day; no automatic alerts for Currency entries.
- Automatic league discovery, hourly fetches, seven-day history and persisted delivery state. One process/container, one volume, no extra services or inbound ports.

Individual alerts require at least 25% **and** 0.5 Div movement over six hours, two distinct qualifying observations and a 12-hour cooldown. A repeat must also meet both movement thresholds relative to the last alerted price. Group alerts require at least ten comparable eligible items, 30% moving in one direction by at least 15% over 24 hours, and two confirmations. An ongoing unchanged group trend does not repeatedly alert.

[SPEC.md](SPEC.md) defines exact source mapping, report layout, thresholds, delivery rules and acceptance criteria.

## Freshness and activity limitations

The reviewed overview responses have no verified source generation timestamp. The reporter will track retrieval time, ETag and meaningful content changes. Identical responses and `304` do not count as a second source confirmation or extend content freshness. The first valid response starts a provisional freshness interval but establishes no historical movement.

**Accepted default: a source becomes unusable if either successful retrieval or a meaningful content change has not been observed within two hours.** Daily reports wait for all required non-disabled sources; affected alerts are suppressed. Deliberate source omissions are disclosed as reduced coverage. This can delay a valid report on an unchanged quiet market. It is a conservative estimate, not proof of upstream freshness. Adjust `freshness.max_unchanged_hours` to change this tradeoff. Output says `Observed at`, not an invented source-update time.

Exchange activity is turnover normalized to Div; its time window is unverified. Call it `Trading volume`, not `Volume/Hour`. Uniques use active listings, not completed sales. Neither guarantees a reliable price. Initial filters may leave fewer than five/ten rows, especially for Soul Cores and Idols; never pad rankings. Missing history is shown as `—`, not zero.

## Development environment (available now)

Use Node.js 24 LTS and npm 11. `.nvmrc` selects Node 24 for an existing compatible version manager; no global packages are required.

```sh
# If using nvm:
nvm install
nvm use

# Install locked development tools:
npm ci
npx --no-install tsc --version
```

The private npm project contains TypeScript and Node.js types as development dependencies. `tsconfig.json` prepares strict ESM compilation from `src` to `dist`. There are no application files, npm scripts or placeholder tests. Typecheck/test/build scripts will accompany actual sources; running the compiler against this empty source tree is not application validation.

Git is initialized on `main`; preparation requires no remote, commits or published image/package. `.gitignore` excludes secrets, local configuration, history, dependencies and local tooling. Docker/Compose is needed for the later deployment/demo, not for documentation or installing npm tools.

## Deployment (planned)

1. Create an incoming webhook in Gryt server settings and select its channel.
2. Copy `.env.example` to `.env` and replace `GRYT_WEBHOOK_URL` with the full secret URL. The placeholder is not a usable credential.
3. Once the MVP Compose file exists:

```sh
docker compose up -d
docker compose logs -f
```

Only the webhook setting is required. Compose will load `.env`, supply a writable named volume at `/app/data` to a non-root process, and expose no ports. Fresh-volume permissions must work without manual root/chown steps. Keep the URL out of logs and YAML.

Image coordinates are not selected yet. After release publishing is authorized and implemented, pin a versioned tag, update with `docker compose pull` and `docker compose up -d`, and retain the data volume.

## Optional configuration (planned parser)

[config.example.yaml](config.example.yaml) contains all accepted defaults and comments. No parser exists yet. To prepare overrides, copy it to `config.yaml` and edit what you need. The future Compose example will offer an optional read-only mount at `/app/config.yaml`; local execution will read `./config.yaml`. Without a file, built-in defaults apply.

Use two spaces for indentation, numeric values without unit suffixes, `true`/`false` booleans, and quoted clock times. Keep the webhook in the environment. Omitted mapping keys retain defaults; supplied lists replace default lists. Unknown keys/invalid values must stop startup. Restart after edits.

Timezone precedence: YAML `timezone` > environment `TZ` > Europe/Riga. The full example explicitly sets `timezone`; remove that line to use `TZ`. Use an IANA name such as `Europe/Riga`, not a fixed UTC offset, to handle DST.

A minimal override file:

```yaml
daily_report:
  time: "10:00"
freshness:
  max_unchanged_hours: 3
liquidity:
  exchange_min_volume_divine:
    Runes: 20
  boss_fragments_min_volume_divine: 20
  uniques_min_listings: 50
currency:
  top_by_volume: 8
  excluded_ids: [transmute, aug, wisdom]
```

This preserves all other defaults, moves publication to 10:00, accepts unchanged contents for up to three hours, tightens the named filters and adds Wisdom to exclusions. Use API IDs, not display names; preserve `transmute` and `aug` when extending the list. Built-in classification can be adjusted for verified individual items using the league-adjustment settings below.

| Setting | Meaning/default |
| --- | --- |
| `league` | `auto` or an exact supported league ID. |
| `sources.disabled` | Known API source types to omit intentionally; default `[]`. Currency cannot be disabled. |
| `classification.overrides` | Item inclusion/reassignment/exclusion rules; default `[]`. Each rule has `source`, `id`, `group`; `null` excludes. |
| `refresh_minutes` | Default 60, minimum 60 minutes. |
| `freshness.max_unchanged_hours` | Default 2 hours; at least the fetch interval in hours. |
| `daily_report.time` | Local `HH:MM`, default `09:00`. |
| `daily_report.top_movers` / `top_expensive` | Positive row counts, defaults 5 / 10. |
| `daily_report.categories` | Nonempty unique list of `socketable`, `lineage_supports`, `crafting`, `uniques`, `boss_fragments`; default all five. Controls daily sections only; currency remains present and alert coverage is independent. |
| `currency.top_by_volume` | Additional ranked currencies, default 10; three fixed pairs are extra. |
| `currency.excluded_ids` | Ranking exclusion list, default `[transmute, aug]`. |
| `liquidity.exchange_min_volume_divine` | Per-source minimum turnover in Div; see table below. |
| `liquidity.boss_fragments_min_volume_divine` | Default 10 Div; overrides the containing source threshold for boss items. |
| `liquidity.uniques_min_listings` | Default 30 listings, for all included unique types. |
| `alerts.enabled` | Default `true`; `false` disables all automatic intermediate alerts. |
| `alerts.max_per_day` / `max_items_per_message` | Positive integers up to 3, defaults 3 / 3. |
| `alerts.confirmation_checks` / `cooldown_hours` | Defaults 2 distinct confirmations / 12 hours; confirmations must be an integer of at least 2. |
| `alerts.item.window_hours` | Default 6 hours. |
| `alerts.item.min_change_percent` / `min_change_divine` | Defaults 25 percent / 0.5 Div; both required. |
| `alerts.category.window_hours` | Default 24 hours. |
| `alerts.category.min_change_percent` / `min_affected_percent` | Defaults 15 percent movement / 30 percent affected share. |
| `alerts.category.min_eligible_items` | Default 10 comparable eligible items. |

Write percentages as `25`, not `0.25`. Thresholds are positive; affected share is at most 100 percent, but movement thresholds may exceed 100 percent. Counts are integers; horizons must fit seven-day retention and sampling. Cooldown is independent of history retention. English output and seven-day history are fixed: no `language` or `history_days` options. `top_by_volume` must be a positive integer.

| API source | Minimum turnover in Div |
| --- | ---: |
| Currency, Ritual | 20 |
| Runes, SoulCores, Idols, LineageSupportGems | 10 |
| Essences, Breach, Delirium | 5 |

Boss Fragments has a separate 10 Div default. Filters apply now and at baselines. Raising thresholds reduces coverage; lowering them admits less-active and potentially noisy items. No automatic tuning. Boss membership and its provisional threshold still need representative API verification before code implementation.

## New-league adjustments (planned)

Ordinary changes to league ID, activity/alert thresholds, freshness, item classification and source omissions require editing YAML and restarting, without rebuilding the image. There is no hot reload. With a single-file config mount, prefer `docker compose up -d --force-recreate reporter` after saving edits: editors may replace the file, leaving an existing bind mount attached to the old file. This deployment command becomes available with the future Compose file; it preserves the named data volume. Changing the webhook environment also requires container recreation.

For example, after verifying the item in the selected league:

```yaml
sources:
  disabled: [Idols]
classification:
  overrides:
    - source: Ritual
      id: an-audience-with-the-king
      group: boss_fragments
```

This deliberately omits Idols from Socketable Currency and assigns the reviewed boss-access ID to Boss Fragments, overriding its built-in classification if necessary. It does not enable new endpoints or relax activity filters. The rule may be redundant once the built-in boss mapping is verified. To exclude the item instead, set `group: null`. There is one rule per source/ID; duplicate rules are invalid, not ordered exceptions. Lists replace defaults and must contain every custom rule/disabled source you want to retain.

- Use exact source types supported by the installed adapter registry. For exchange items, use `line.id`; for stash items, use `itemId`. A stash rule covers all published variants but does not merge them.
- Exchange targets are `socketable`, `lineage_supports`, `crafting`, `boss_fragments`; supported unique stash items target `uniques`. Rules may also exclude either type. Currency stays in its own block; configure its exclusions under `currency.excluded_ids`.
- A rule can activate a previously unused supported source. Supply its minimum Div turnover under `liquidity.exchange_min_volume_divine` unless all its included items use the boss threshold. New API types/formats or new report groups still require code and an updated image.
- Unknown source/group names, incompatible pairs and missing required thresholds fail validation. An ID absent from the selected league produces a warning; no synthetic entry is created. Disabled sources take precedence, leaving their item rules dormant with a warning.
- Disabled sources are not fetched and their cached items are excluded from reports and alerts. Reports visibly list omissions and mark affected groups as reduced coverage. A group with no remaining sources is shown as unavailable. Failed/stale sources are never silently treated as disabled.
- Group alerts use only the remaining eligible universe, retain the ten-item default minimum, and disclose reduced coverage. Classification/coverage changes reset affected confirmations and group rearming, preserving cooldowns, last-alerted prices, daily counters and sent/unknown records. Reclassified items need new in-group history for changes; old unsent report parts are canceled rather than mixed with the new configuration.

For a league launch: review `league` (`auto` normally needs no edit), item IDs and source availability; adjust thresholds if early trading is sparse; use the planned `check` and `preview` commands before enabling delivery with the new config. Their results must show effective coverage and unmatched/dormant rules. Configuration is instance-wide: old item rules do not disappear automatically when the league changes. The new league starts its own history; 6h/24h comparisons need new observations, and initial activity filters or the conservative two-hour freshness policy may reduce coverage.

## Operations (planned)

```sh
docker compose run --rm reporter check
docker compose run --rm reporter preview
docker compose run --rm reporter preview --demo
docker compose run --rm reporter send-test
docker compose run --rm reporter report-currency
```

- `check`: configuration/source checks, no webhook delivery or production writes.
- `preview`: local report from stored history, showing unavailable/stale status. `--demo` is deterministic and offline. Neither requires a webhook or writes production state.
- `send-test`: explicitly publish one labeled test message.
- `report-currency`: manually publish only currency rates from usable stored observations, including while the scheduler runs; refuse stale/missing data. No changes to scheduled state/counters. A server CLI command, not a Gryt chat command.

Only delivery commands require the webhook. Manual/test sends have no automatic retries and do not use the automatic daily alert allowance. Initial prices are available immediately; historical changes and alerts need collected baselines.

An automatic timeout/interrupted send may have reached Gryt: record it as unknown and do not blindly replay. Confirmed report parts are not resent; uncertain alerts conservatively reserve a daily slot/cooldown. Exactly-once delivery is not guaranteed. Inspect uncertain delivery before deliberately repeating a manual send.

## Sources and verification

Reviewed on 2026-11-18: [poe.ninja API](https://poe.ninja/docs/api), [Gryt webhooks](https://docs.gryt.chat/docs/build/webhooks) and [official OpenAPI](https://github.com/Gryt-chat/server/blob/main/openapi/webhooks.json). Current Gryt allows 10 cards/message, 25 fields/card and 6000 combined card-text characters; split reports into numbered parts without dropping rankings. Actual deployed-server compatibility remains a separately authorized check; no live webhook was called.

[SPEC.md](SPEC.md) records representative API coverage, unresolved source checks and acceptance. [AGENTS.md](AGENTS.md) defines development constraints. Read both at the start of the separate MVP implementation session; no extra roadmap/planning document is needed.
