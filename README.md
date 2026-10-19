# SoundTag

SoundTag scans a folder of MP3, OGG, FLAC, and WAV files, looks up track
metadata with Last.fm, and updates files in place with audio tags and cover art
when a match is found.

## Requirements

- Node.js 24 or later
- A Last.fm API key
- A MusicBrainz User-Agent string to enable the MusicBrainz fallback lookup

## Setup

Install the dependencies, build, and link the `soundtag` command so it can be
run from any folder:

```sh
npm install
npm run build
npm link
```

The link points at this checkout, so run `npm run build` again after pulling
changes. `npm unlink -g soundtag` removes the command. `npm link` needs a
writable global npm prefix, as with Volta, nvm or a user-level
`npm config set prefix`; with a system-wide Node it may need `sudo`.

Provide your API keys in a `.env` file. SoundTag reads `.env` from the folder
you run it in and from `~/.config/soundtag/.env` (or
`$XDG_CONFIG_HOME/soundtag/.env`). A key in the local file wins over the same
key in the config file, and variables already set in your shell win over both.
Only the three keys below are read from these files; other variables are
ignored:

```env
LASTFM_API_KEY=your_lastfm_api_key
MUSICBRAINZ_USER_AGENT=SoundTag/1.0.0 (your-contact-information)
YOUTUBE_API_KEY=your_youtube_data_api_key
```

Last.fm API requests (up to two per track: a search, then the track details)
are spaced two seconds apart; cover image downloads are not.

MusicBrainz does not require an API key. It requires a meaningful User-Agent
string and limits requests to one per second; SoundTag spaces them three
seconds apart. Set `MUSICBRAINZ_USER_AGENT` to
identify your SoundTag installation and provide contact information. The
MusicBrainz fallback is used when Last.fm misses track metadata or cover
art; cover images are retrieved from the Cover Art Archive. If metadata is
still incomplete, SoundTag also searches the iTunes Store using
[Apple's Search API](https://performance-partners.apple.com/search-api) and
uses its song details and artwork as a final fallback. iTunes also provides
the genre and, when its release matches the track's album (or no album is
known), the track number, disc number and album artist. These are only taken
when the iTunes song has the same title and artist. Since only iTunes provides
them, a track missing its genre or track number is looked up on every
service. iTunes searches are spaced at least four seconds apart to stay within
the 20-requests-per-minute limit.
If no provider returns artwork for a track matched by the metadata services,
SoundTag can use a YouTube video thumbnail as a last resort. This requires a
YouTube Data API key with access to `search.list`; set `YOUTUBE_API_KEY` to
enable it. The thumbnail may be a video still rather than the track's album
art, and YouTube API quota limits apply.

The Last.fm API key can also be entered when prompted at startup.

## Usage

Run SoundTag with a source folder:

```sh
soundtag /path/to/music
```

From the project folder, `npm start -- /path/to/music` works too.

Paths containing spaces should be quoted.

If no source folder is supplied, SoundTag opens a full-screen browser in the
current directory. The left pane lists subfolders and audio files, and the
right pane shows the stored tags of the file under the cursor (or, for a
folder, its file counts). Processing messages appear in the log pane below.

| Key                    | Action                                          |
| ---------------------- | ----------------------------------------------- |
| `↑` `↓`, PgUp, PgDn    | Move the cursor                                 |
| Enter, `→`             | Open the folder under the cursor                |
| `←`, Backspace, Delete | Go up one folder                                |
| `t`                    | Tag the file or folder under the cursor         |
| `a`                    | Tag the folder being browsed                    |
| `r`                    | Include or exclude subfolders in folder runs    |
| `s`                    | Stop the current run after the file in progress |
| `q`, Ctrl+C            | Quit (press again during a run to quit at once) |

Tagging runs in the background, so you can keep browsing; further `t` and `a`
presses are queued and run one after another, and are ignored once you quit.
Once processed in this session, files get a colored dot: green for `TAGGED`,
yellow for `SKIPPED`, red for `FAILED`. A folder shows the worst status of the
files inside it. Folder runs include subfolders unless `--no-recursive` was
passed; `r` switches this for the folders queued next, and the status bar shows
the current choice. A file or folder that is already queued or running is not
queued again, even with a different choice; the log says so. A file renamed by
an earlier run before its own queued run starts is skipped. Quitting during a
run waits for the file in progress; quitting again exits immediately with
code 130. Symlinked folders are listed too. The browser needs an interactive
terminal; for scripted runs, pass the source folder as an argument.

By default, SoundTag scans subfolders. Use `--no-recursive` to scan only the
source folder itself:

```sh
soundtag /path/to/music --no-recursive
```

Use `--recursive` or `-r` to explicitly include subfolders:

```sh
soundtag /path/to/music --recursive
soundtag /path/to/music -r
```

Each run processes at most 3,000 MP3, OGG, FLAC, or WAV files. Hidden files and
folders (names starting with a dot) are ignored. OGG files use Vorbis comments,
FLAC files use their supported native tags and picture metadata, and MP3 files
use ID3 tags. WAV metadata is written through TagLib's RIFF/ID3 support;
embedded artwork compatibility can vary between players.

With a source folder argument, press Ctrl+C to stop a run: SoundTag finishes
the file it is working on, prints the summary (with the number of files not
processed), and exits with code 130. Press Ctrl+C a second time to quit
immediately. Ctrl+C at a prompt exits with code 130.

When you quit the browser, SoundTag exits with code 1 if any run failed (a
file failed), otherwise 0. Stopped runs do not count as failures. Without an
interactive terminal and without a source folder, SoundTag exits with code 1
before asking for anything.

After a file is tagged, or skipped because it was already fully tagged,
SoundTag renames it to `<Artist> - <Title>.<extension>` from its tags when the
name differs (letter case is ignored). Files skipped because no service found
them keep their name, since their tags are unverified. Characters that
filenames cannot hold, such as `/` or `?`, become `_`, a leading `.` becomes
`_`, and names are shortened to 200 bytes. An existing file is never
overwritten, even one whose name differs only in letter case. Use
`--no-rename` to keep file names:

```sh
soundtag /path/to/music --no-rename
```

Pass `-v` or `--verbose` to log the Last.fm `track.getInfo` request URL:

```sh
soundtag /path/to/music -v
```

For filenames in the common `Artist - Title.<extension>` format, SoundTag
searches Last.fm using the title and artist separately. It also removes
leading track or disc-track numbers and recognizes spaced hyphens, en dashes,
and em dashes as separators. If no reliable artist/title split is present, it
uses the cleaned filename as the title query. Existing embedded tags are used
as search context when present. Otherwise, SoundTag infers album context from
the nearest meaningful folder and artist context from the folder above it.
Single ambiguous folders are treated as album context, not assumed to be an
artist. Structural folders such as disc numbers, cover-art folders, and
unknown placeholders are ignored.

## Output

Files are updated in place; no tagged copies are created. A source file is
skipped as already tagged only when it has a title, artist, year, genre, and
embedded cover art. If any of these are missing, SoundTag attempts to process
the file, so files tagged before genre support are processed again. An
embedded cover is kept and never replaced, and a genre, album artist, track or
disc number already in the file is never rewritten.
If the services return a title and artist but cannot find optional fields such
as the album, year, genre, track number, or cover art, SoundTag still writes
the fields it found.
Fields that the services did not find are left unchanged if the source file
already has values for them.
When the services add nothing the file lacks, it is not rewritten and is
reported as skipped.
After all files are processed, a track still without cover art takes the cover
of another track in the same folder with the same artist and album (ignoring
case), even when the services did not find the track itself. A skipped track
that gets a cover this way is reported as tagged, and is renamed only when it
also has a title, artist and year.
Because the file is not considered fully tagged until year, genre and cover
art are present, later runs can retry to fill those gaps. SoundTag gets the year from
Last.fm or, when needed, from the MusicBrainz recording or release date. Each
file is processed sequentially using a temporary copy before replacement;
large lossless files therefore need temporary free space comparable to the
file size and can require substantial additional disk or NAS I/O.

With a source folder argument, a summary is printed at the end of the run:
the number of tagged, skipped and failed files, then each failed file and each
rename (`old → new`), with paths relative to the source folder. SoundTag writes
no report file; `soundtag_output.json` files left by older versions can be
deleted.

## Development

The source is organized by domain under `src/` (`cli`, `processing`, `library`,
`tags`, `metadata`, `shared`), and `tests/` mirrors that layout. See
[AGENTS.md](AGENTS.md) for the architecture and contribution conventions.

Build the application:

```sh
npm run build
```

Run the test suite:

```sh
npm test
```

Run every quality check (type checking, Oxlint, Prettier, and tests with
coverage thresholds), as CI does:

```sh
npm run check
```

Apply Prettier formatting with `npm run format`.
