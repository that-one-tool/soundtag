# SoundTag

SoundTag scans a folder of MP3, OGG, FLAC, and WAV files, looks up track
metadata with Last.fm, and updates files in place with audio tags and cover art
when a match is found.

## Requirements

- Node.js 24 or later
- A Last.fm API key
- A MusicBrainz User-Agent string to enable the MusicBrainz fallback lookup

## Setup

Install the dependencies:

```sh
npm install
```

Provide your Last.fm API key using either a `.env` file in the project root:

```env
LASTFM_API_KEY=your_lastfm_api_key
MUSICBRAINZ_USER_AGENT=SoundTag/1.0.0 (your-contact-information)
YOUTUBE_API_KEY=your_youtube_data_api_key
```

MusicBrainz does not require an API key. It requires a meaningful User-Agent
string and limits requests to one per second. Set `MUSICBRAINZ_USER_AGENT` to
identify your SoundTag installation and provide contact information. The
MusicBrainz fallback is used when Last.fm misses track metadata or cover
art; cover images are retrieved from the Cover Art Archive. If metadata is
still incomplete, SoundTag also searches the iTunes Store using
[Apple's Search API](https://performance-partners.apple.com/search-api) and
uses its song details and artwork as a final fallback. iTunes searches are
spaced at least three seconds apart to stay within the 20-requests-per-minute
limit.
If no provider returns artwork for a track matched by the metadata services,
SoundTag can use a YouTube video thumbnail as a last resort. This requires a
YouTube Data API key with access to `search.list`; set `YOUTUBE_API_KEY` to
enable it. The thumbnail may be a video still rather than the track's album
art, and YouTube API quota limits apply.

The Last.fm API key can also be entered when prompted at startup.

## Usage

Build the TypeScript project:

```sh
npm run build
```

Run SoundTag with a source folder:

```sh
npm start -- /path/to/music
```

Paths containing spaces should be quoted.

If no source folder is supplied, SoundTag opens a folder browser in the current
directory. Type a number to open a subfolder, `0` to go up, `s` to process the
folder shown, or `q` to quit. After each run the browser reopens on the
processed folder. Symlinked folders are listed too. The browser needs an
interactive terminal; for scripted runs, pass the source folder as an argument.

By default, SoundTag scans subfolders. Use `--no-recursive` to scan only the
source folder itself:

```sh
npm start -- /path/to/music --no-recursive
```

Use `--recursive` or `-r` to explicitly include subfolders:

```sh
npm start -- /path/to/music --recursive
npm start -- /path/to/music -r
```

Each run processes at most 3,000 MP3, OGG, FLAC, or WAV files. Hidden files and
folders (names starting with a dot) are ignored. OGG files use Vorbis comments,
FLAC files use their supported native tags and picture metadata, and MP3 files
use ID3 tags. WAV metadata is written through TagLib's RIFF/ID3 support;
embedded artwork compatibility can vary between players.

Press Ctrl+C to stop a run: SoundTag finishes the file it is working on and
writes the report (unprocessed files stay `READ`). With a source folder
argument it then exits with code 130; in the folder browser it returns to the
browser instead. Press Ctrl+C a second time during a run to quit immediately
without writing the report. Ctrl+C at a prompt exits with code 130.

When you leave the folder browser with `q` or when input ends, SoundTag exits
with code 1 if any run failed, otherwise 0. Stopped runs do not count as
failures.

After a file is tagged, or skipped because it was already fully tagged,
SoundTag renames it to `<Artist> - <Title>.<extension>` from its tags when the
name differs (letter case is ignored). Files skipped because no service found
them keep their name, since their tags are unverified. Characters that
filenames cannot hold, such as `/` or `?`, become `_`, a leading `.` becomes
`_`, and names are shortened to 200 bytes. An existing file is never
overwritten, even one whose name differs only in letter case. Renames are
listed under `renamed` in the report. Use `--no-rename` to keep file names:

```sh
npm start -- /path/to/music --no-rename
```

Pass `-v` or `--verbose` to log the Last.fm `track.getInfo` request URL:

```sh
npm start -- /path/to/music -v
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
skipped as already tagged only when it has a title, artist, year, and embedded
cover art. If any of these are missing, SoundTag attempts to process the file.
If the services return a title and artist but cannot find optional fields such
as the album, year, or cover art, SoundTag still writes the fields it found.
Fields that the services did not find are left unchanged if the source file
already has values for them.
Because the file is not considered fully tagged until year and cover art are
present, later runs can retry to fill those gaps. SoundTag gets the year from
Last.fm or, when needed, from the MusicBrainz recording or release date. Each
file is processed sequentially using a temporary copy before replacement;
large lossless files therefore need temporary free space comparable to the
file size and can require substantial additional disk or NAS I/O.

At the end of each run, `soundtag_output.json` is written inside the source
folder used for that run. It maps each processed file's path relative to the
source folder to its final status:

| Status    | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `READ`    | The file was discovered and is awaiting processing.                      |
| `SKIPPED` | The file was already tagged, or a complete metadata match was not found. |
| `TAGGED`  | Metadata was found and the source file was updated.                      |
| `FAILED`  | An error occurred while processing the file.                             |

Statuses are keyed by each file's original path. Renamed files are also listed
under `renamed`, which maps the original path to the new one.

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
