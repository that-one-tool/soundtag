# AGENTS.md

SoundTag is a Node.js CLI and terminal UI that scans a music folder, looks up missing track
metadata (Last.fm, then MusicBrainz, then iTunes, with YouTube as a cover-only
fallback), and rewrites tags and cover art in place. User-facing behaviour is
documented in [README.md](README.md).

## Commands

```sh
npm install
npm run check      # typecheck + lint + format check + tests with coverage gates (what CI runs)
npm test           # tests only
npm run format     # apply Prettier
npm run build      # compile to dist/
```

`npm run check` must pass before every commit. CI runs it on Node 24 and 26.

## Layout

`tests/` mirrors the `src/` folder layout (`src/tags/audio-tags.ts` →
`tests/tags/audio-tags.test.ts`); the tag stores are tested through
`tests/tags/audio-tags.test.ts`.

| Folder                    | Responsibility                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`            | Entry point and `soundtag` bin: loads `.env` and wires the terminal session and browser launcher to `runApp`.                                                                                |
| `src/cli/`                | Run lifecycle: argument parsing, config loading and validation, terminal prompts and Ctrl+C handling, banner, summary, exit codes, and the lazy launch of the TUI.                           |
| `src/tui/`                | Ink terminal UI: folder browser reducer, metadata panel, log pane, background `TaggingQueue`, session status dots. React components live in `components/` and hooks in `hooks/`.             |
| `src/processing/`         | `processBatch` walks the files and records statuses in the report; `processTrack` handles one file and returns `SKIPPED`, `TAGGED` or `FAILED`; `renameTrack` then renames it from its tags. |
| `src/library/`            | Filesystem: audio-file discovery, temporary-copy writes, renames with a per-batch folder name cache, track filenames, and search terms derived from filenames and folders.                   |
| `src/tags/`               | `TagStore` implementations per format (`Id3TagStore` for MP3, `TagLibTagStore` for OGG/FLAC/WAV), chosen by `getTagStore`.                                                                   |
| `src/metadata/`           | `MetadataChain` runs providers in order and fills only missing fields; `create-metadata-chain.ts` is the composition root; pure merge helpers.                                               |
| `src/metadata/providers/` | One class per external service, implementing `MetadataProvider` or `CoverProvider`.                                                                                                          |
| `src/shared/`             | Domain-free helpers: HTTP with timeouts and image download, per-batch `ImageCache`, rate limiter with an injectable `Clock`, errors, `Logger`.                                               |

Each domain owns its contracts in its own `types.ts`. Imports only point toward
lower layers, and a layer may skip levels: `cli` → `tui` → `processing` → `tags` /
`metadata` / `library` → `shared`. `tags` may use `library` and `metadata`, and
`metadata` must not depend on `tags`, `library`, `processing` or `cli`. Keep the
graph free of cycles.

## Configuration

- Environment variables, loaded by `src/cli/env-file.ts` from `./.env`, then
  from `$XDG_CONFIG_HOME/soundtag/.env` (default `~/.config/soundtag/.env`).
  Only the keys below are taken, the first file wins key by key, and variables
  already set in the shell win over both. A new key must be added to
  `SOUNDTAG_KEYS`:
  - `LASTFM_API_KEY` is required (prompted when missing).
  - `MUSICBRAINZ_USER_AGENT` enables MusicBrainz.
  - `YOUTUBE_API_KEY` enables the YouTube cover fallback.
- Runs write no report file: headless runs print failed files and renames in
  the summary, and the TUI keeps statuses for the session only.

## Extending

- **New metadata source:** add a class in `src/metadata/providers/` that
  implements `MetadataProvider` and takes the shared `ProviderServices`, then
  register it in `create-metadata-chain.ts`. Do not change `MetadataChain`.
  Download images through `services.images` so repeated cover URLs hit the
  per-batch cache.
- **New audio format:** add it to `AUDIO_FORMATS` in `src/library/file.ts`, then
  map it to a `TagStore` in `src/tags/audio-tags.ts`. The compiler enforces that
  every format has a store.
- **Rate-limited or slow work:** take a `Clock` (or a `RateLimiter`) as a
  constructor dependency so tests can use `instantClock` or `createFakeClock`.
- **Output from processing or metadata code:** log through an injected
  `Logger` (`src/shared/logger.ts`), never `console`, so the TUI can route it to
  its log pane. Headless runs pass `consoleLogger`.

## Conventions

These are enforced by Oxlint (`.oxlintrc.json`) as errors, and `--deny-warnings`
means any warning fails too:

- Cyclomatic complexity ≤ 3. `??`, `?.`, `&&`, `||`, ternaries and default
  parameters all count. Extract small helpers or use lookup tables (`Map`,
  `Record`).
- Functions ≤ 20 lines, ≤ 3 parameters (group related values in an object),
  block nesting ≤ 2.

Not enforced by tooling, but expected:

- Write tests before the behaviour or fix (TDD). When refactoring, first add
  tests that pass against the current code to lock its behaviour.
- Function names start with a verb. Use descriptive names and no one-letter
  variables.
- Prefer early returns over nested conditions.
- Prefer composition, constructor-injected dependencies, and polymorphism
  through interfaces or handler tables over `switch`/`if` chains.
- Add an abstraction only when there are at least two implementations or real
  duplication.
- Comments only for a non-obvious _why_.
- Formatting is Prettier's job (`.prettierrc.json`).

## Testing

- Use `node:test` with `node:assert/strict` and run through `tsx`. No other test
  framework.
- Never hit the network: replace `globalThis.fetch` in each test and call
  `restoreFetchAfterEach()` once per file.
- Shared helpers live in `tests/helpers/`:
  - `useTemporaryDirectories(prefix)`
  - `captureConsole()`
  - `instantClock`, `createFakeClock()`
  - `createTestChain()` and `findTrackMetadata()`, which give a chain with
    instant rate limiting
  - `createRecordingLogger()`
  - `createProviderServices()` for provider and chain constructors
  - `waitForFrame()`, `KEYS` and `createFakeTerminal()` for Ink, and
    `createControlledServices()` for TUI services with a hand-driven queue
- Audio fixtures live in `tests/fixtures/`. Copy a fixture into a temporary
  directory before writing tags to it.
- `tests/index.test.ts` spawns the real CLI (smoke tests, prompts, Ctrl+C).
  Its stdin is piped, so it never reaches the TUI. Prefer in-process tests
  through `runApp`, `loadConfig` and the like.
- Render components with `ink-testing-library`. Test files stay `.ts` and use
  `createElement`, because tsx only applies the `jsx` setting to files that
  `tsconfig.json` includes (`src/`).
- Run tests from the repo root: fixture paths are resolved from
  `process.cwd()`.
- Coverage gates are 99% lines, 97% branches and 100% functions, and only
  ratchet up. Node only counts files that some test imports, so every new
  `src` file needs a test that imports it.

## Gotchas

- TypeScript 7 has no JS API, so `typescript-eslint` does not work, which is why
  Oxlint is used. Do not add ESLint.
- The code is ESM with `NodeNext` resolution, so relative imports need the
  `.js` extension, also for `.tsx` files.
- The TUI is loaded with a dynamic `import()` (`runTuiLazily`) so scripted runs
  never load React and Ink. Run it from `dist/` or from the repo root: tsx
  picks up the `tsconfig.json` of the working directory for JSX.
- Ink owns stdin in raw mode, so the readline session is closed before the TUI
  starts and Ctrl+C reaches the UI as a key press, not a `SIGINT`.
- Node ≥ 24 is required, and `@types/node` is pinned to v24 so the typecheck
  rejects newer APIs.
- Files are rewritten through a hidden temporary copy (`.<name>.<uuid>.<ext>`).
  The scan skips hidden files and folders so leftovers are never tagged.
- MusicBrainz needs `MUSICBRAINZ_USER_AGENT` and allows 1 request/s; SoundTag
  spaces requests 2 s apart, like Last.fm API calls. iTunes is spaced 4 s apart.
  Cover image downloads are not rate-limited.
- With piped stdin, readline drops lines that arrive before `question()` is
  called. The CLI test helper answers each prompt only once it appears.
