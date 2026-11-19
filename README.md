# PoE2 Economy Reporter

Version **0.2.0** — report formatting and independent alert categories. See [CHANGELOG.md](CHANGELOG.md) for release notes.

A small self-hosted service posting English PoE2 market reports to one Gryt incoming webhook. One Node.js process/container, one persistent volume, no inbound ports or additional services.

Daily at **09:00 Europe/Riga**: three currency pairs and up to ten additional currencies; top five gainers/losers and ten most expensive items for Socketable Currency, Lineage Supports, Crafting Currency and Uniques; a separate Boss Fragments expensive ranking. Currency never produces automatic alerts.

Individual alerts require ≥25% **and** ≥0.5 Div movement over six hours, two distinct confirmations and a twelve-hour cooldown. Group alerts require ten comparable items, ≥30% moving ≥15% in one direction over 24h and two confirmations. `alerts.categories` independently selects which item groups can alert; all five are enabled by default. At most three automatic intermediate messages per local day. See [SPEC.md](SPEC.md) for the complete behavior.

## Run locally

Node.js 24 LTS and npm 11 are required. No global packages are needed.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --demo
```

For scheduled operation, supply `GRYT_WEBHOOK_URL` in the process environment and run `npm start`. Local execution does **not** automatically load `.env`; Compose loads that file. Default local storage is `./data` and optional configuration is `./config.yaml`. `DATA_DIR` and `CONFIG_PATH` can select other local paths.

## Install the released Docker image

Use Docker Engine with the Compose plugin on Linux/amd64. Node.js, npm and a source checkout are not required. The image is pinned to `0.2.0`; installation needs the release files and the persistent data volume only.

```sh
mkdir -p poe2-economy-reporter
cd poe2-economy-reporter
curl -fL https://raw.githubusercontent.com/Inferlopec/poe2-economy-reporter/v0.2.0/compose.yaml -o compose.yaml
curl -fL https://raw.githubusercontent.com/Inferlopec/poe2-economy-reporter/v0.2.0/.env.example -o .env.example
cp .env.example .env
# Edit .env with your complete incoming webhook URL.
docker compose pull
docker compose run --rm reporter --version
docker compose run --rm reporter preview --demo --all
docker compose up -d
docker compose logs -f
```

`GRYT_WEBHOOK_URL` is the only required deployment setting. Create it in Gryt Server settings → Webhooks. The URL contains a secret; keep it out of YAML, source control and logs. Starting the service enables real scheduled publication. The demo preview is offline and does not send messages.

The non-root `reporter` service gets a writable named volume at `/app/data` with no manual ownership changes. No ports are exposed. Keep the same Compose project directory/name and volume across updates; do not use `docker compose down --volumes` when preserving history and delivery state.

Image: `ghcr.io/inferlopec/poe2-economy-reporter:0.2.0`. Stable releases also update `latest`; explicit version tags make upgrades deliberate. To update, edit the image version in `compose.yaml`, run `docker compose pull`, then `docker compose up -d`. The initial registry image targets Linux/amd64; build from source on other architectures.

## Build the image from source

For a source checkout, use the explicit build overlay. The default `compose.yaml` only pulls the released image.

```sh
git clone https://github.com/Inferlopec/poe2-economy-reporter.git
cd poe2-economy-reporter
git checkout v0.2.0
cp .env.example .env
# Edit .env before enabling scheduled delivery.
docker compose -f compose.yaml -f compose.build.yaml build
docker compose -f compose.yaml -f compose.build.yaml run --rm reporter preview --demo --all
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

## Configuration

Without YAML, built-in defaults apply. To override them, create `config.yaml` from [config.example.yaml](config.example.yaml) and uncomment its read-only mount in Compose. With the image-only installation, download the example once before editing it:

```sh
curl -fL https://raw.githubusercontent.com/Inferlopec/poe2-economy-reporter/v0.2.0/config.example.yaml -o config.yaml
```

Preserve an existing configuration when updating. Mappings merge with defaults; lists replace them. Unknown keys, duplicate rules, invalid types/ranges and incompatible classifications stop startup.

Timezone precedence is YAML `timezone`, then environment `TZ`, then Europe/Riga. All configuration edits require restart. After saving a bind-mounted file, recreate the container to handle editors that replace its inode:

```sh
docker compose up -d --force-recreate reporter
```

Use `classification.overrides` for supported source/item IDs and `sources.disabled` for deliberate omissions. Currency cannot be disabled or reassigned. A new exchange source needs an explicit turnover threshold unless included items all use the boss threshold. Unknown API formats still require an adapter update. Unmatched rules warn; disabled sources take precedence and leave rules dormant.

Use `alerts.categories` to enable a subset of `socketable`, `lineage_supports`, `crafting`, `uniques` and `boss_fragments` for individual and group alerts. It defaults to all five; `[]` disables alert generation for every group. This does not change `daily_report.categories` or market data/history collection. Disabling a category resets its pending confirmations while preserving cooldowns, delivery state and daily limits.

Coverage reductions are printed in reports. Failed/stale sources are never automatically disabled. Mapping/coverage edits cancel old unsent report parts and reset affected evidence; cooldowns, last-alerted prices, reservations and same-day report records survive. Reclassified items need new history. Configuration is global across leagues, while price history and item/group signal identities are league-specific.

## Commands

Build first for local npm commands. Container commands use the installed image and need no local build:

| Local | Container | Behavior |
| --- | --- | --- |
| `npm run check` | `docker compose run --rm reporter check` | Validate config, GET public sources, show coverage and unmatched/dormant rules; no writes or Gryt calls |
| `npm run preview` | `docker compose run --rm reporter preview` | Render stored data, explicitly labeling stale/incomplete coverage; no network or writes |
| `npm run preview -- --demo` | `docker compose run --rm reporter preview --demo` | Deterministic offline report, no webhook/history required |
| `npm run send-test` | `docker compose run --rm reporter send-test` | Explicitly send one labeled test message |
| `npm run report-currency` | `docker compose run --rm reporter report-currency` | Manually send currency from usable stored data, including while scheduler runs |

Only scheduler and delivery commands need the webhook. Manual/test sends never change scheduled counters and never automatically retry. Run them only when you intend to publish to the channel. Initial prices need no baseline; percentage changes and alerts require collected history. Optional factual narrative summaries are omitted.

## Visual checks in a Gryt test channel

Reports use Markdown descriptions with a combined gainers/losers card per category, distinct category icons and accent colors, and compact prices. Movement rows put the signed percentage, compact price and item name in that order, separated by vertical bars (for example, `🟩 **+28%** | **2.8 Div** | Soul Core of Azcapa`). Daily rankings, currency and individual alerts share that format; oversized sections continue in numbered messages.

The deterministic suite uses production formatters with synthetic data and realistic example names, and marks every card/message `[DEMO]`. It includes the full daily report, currency-only report, all 14 selected Fragments, individual and group alerts in both directions for all five groups, merged alerts with three examples, missing history, empty rankings, reduced/stale coverage, variants/corruption and long names split into numbered parts. It does not wait for real market signals.

Inspect the exact payloads and total message count offline first (no webhook or production config/history required):

```sh
docker compose run --rm reporter preview --demo --all
# Inspect one case:
docker compose run --rm reporter preview --demo --case item-up
```

Create a webhook for a separate **test channel** and set `GRYT_TEST_WEBHOOK_URL` in `.env`. This variable is used only by `send-test --demo`; there is no fallback to `GRYT_WEBHOOK_URL`. Set the actual target channel in Gryt when creating the webhook; the service cannot read channel settings through an incoming webhook.

The following commands intentionally post test messages. Start with one case, then send the complete suite if desired:

```sh
docker compose run --rm reporter send-test --demo --case daily
docker compose run --rm reporter send-test --demo
```

Local equivalents after building are `npm run preview -- --demo --all` and `npm run send-test -- --demo --case daily`; local runs need `GRYT_TEST_WEBHOOK_URL` exported in the environment, since Node does not load `.env` automatically.

Case IDs: `daily`, `currency`, `fragments`, `item-up`, `item-down`, `group-up`, `group-down`, `combined`, `no-history`, `empty`, `reduced`, `stale`, `long-names`. Alert cases send one example per group. Inspect all numbered parts, signs/units, variant and corruption labels, empty/unavailable indicators and coverage notices; check narrow/mobile layouts as well as desktop.

The suite bypasses production YAML, reads/writes no production history or delivery state, and never consumes scheduled limits/cooldowns. Messages are paced at least two seconds apart. Logs identify the case, part and result/message ID. Any failure, `429` or uncertain delivery stops the batch without retries. Inspect the test channel before deliberately rerunning `--case`: it repeats the entire selected case, including parts that previously succeeded. Stale/incomplete reports are sent only as labeled synthetic rendering samples; automatic production freshness rules are unchanged.

## Freshness and recovery

poe.ninja does not expose a verified generation timestamp. The service tracks successful retrieval and meaningful content changes separately. Identical content and `304` do not refresh the content-change clock or confirm alerts. Both clocks must be within two hours by default. This conservative assumption can suppress genuinely unchanged markets. Output says `Observed at`; observations are not an atomic upstream snapshot.

Exchange activity is `Trading volume` normalized to Div, with an unverified time window. Unique activity is active listings, not completed sales. Thresholds apply at both comparison endpoints; short rankings are expected. Missing history is `—`, never zero.

Snapshots and delivery state are atomic JSON replacements. A maintained filesystem lock with heartbeat permits one scheduled writer; after an unclean exit allow 30 seconds for stale-lock recovery. Docker's restart policy retries startup. Read-only/manual commands do not take the writer lock. SIGINT/SIGTERM stop collection and release the lock.

Corrupted files remain on disk. Corrupt history is not used; corrupt delivery state blocks automatic sending. Stop the service and preserve a backup before explicit inspection/repair; do not delete state to clear an uncertain delivery. There is no automatic repair command.

A report stores immutable numbered payloads before POST. Successful parts are not replayed. Timeout, ambiguous server errors, malformed success or restart during `sending` become `unknown`; subsequent report parts stop. Uncertain alerts reserve their daily slot/cooldown. Exactly-once delivery is not guaranteed. Logs distinguish incomplete/canceled reports; inspect unknown records in `state.json` before any deliberate manual repeat.

## Verification and dependencies

Tests use compact real API fixtures plus deterministic synthetic history and mocked delivery. They cover conversion, classification/coverage, variants, baselines, freshness, rankings, confirmations, delivery ambiguity, persistence, DST, payload splitting and read-only commands. The default Boss Fragments selection includes the 14 user-selected Fragments entries plus the existing Audience and Breachstone entries. Other Fragments entries stay excluded; activity/history/freshness filters still apply. Fixture provenance and exact IDs are recorded in [SPEC.md](SPEC.md).

Runtime dependencies are `yaml` for YAML parsing and `proper-lockfile` for cross-process writer exclusion and crash recovery. Network, analysis, scheduling, JSON storage and tests use Node built-ins. CI checks types, tests, production build and an offline container demo; release-tag CI publishes GHCR images. No real webhook is called by tests or demo. Compatibility with a particular deployed Gryt server still requires a separately authorized live check.

## Release preparation

For `0.2.0`, package/lockfile/runtime versions, the Docker label and the Compose image tag must agree. Run the release guard and standard checks before publishing:

```sh
node scripts/release-check.mjs v0.2.0
npm ci
npm run typecheck
npm test
npm run build
```

Publishing is a separate authorized action: commit the reviewed source on `main`, then create and push the matching `v0.2.0` tag. Tag CI rejects mismatched/unstable versions, verifies source and the built image offline, publishes GHCR tags `0.2.0` and `latest`, then creates the GitHub release with changelog notes. No npm package is published. A workflow failure can leave a published image without GitHub release notes; inspect both jobs before retrying. Registry visibility/access and actual CI execution are verified after publication, not by local checks.
