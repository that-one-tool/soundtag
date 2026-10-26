# SoundTag

SoundTag scans a folder of MP3, OGG, FLAC, and WAV files, looks up track
metadata with Discogs, ListenBrainz, MusicBrainz, Deezer, iTunes and Last.fm, and
updates files in place with audio tags and cover art when a match is found.

## Requirements

- Node.js 24 or later
- A MusicBrainz User-Agent string to enable the MusicBrainz lookups
- A ListenBrainz user token, recommended for the most accurate matches
- Optionally, a Last.fm API key for the last-resort lookup
- Optionally, a Discogs consumer key and secret for the Discogs lookups

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
Only the seven keys below are read from these files; other variables are
ignored:

```env
LASTFM_API_KEY=your_lastfm_api_key
MUSICBRAINZ_USER_AGENT=SoundTag/1.0.0 (your-contact-information)
LISTENBRAINZ_TOKEN=your_listenbrainz_user_token
YOUTUBE_API_KEY=your_youtube_data_api_key
DISCOGS_CONSUMER_KEY=your_discogs_consumer_key
DISCOGS_CONSUMER_SECRET=your_discogs_consumer_secret
# Optional: kitty, blocks or none (detected from the terminal by default)
# SOUNDTAG_COVER=kitty
```

SoundTag asks the services below in order, and stops once the title, artist,
album, year, genre, track number and cover are all known. A result is only used
when it is the searched song: the same title and, when known, an artist shared
by both credits ("Daft Punk" matches "Daft Punk feat. Pharrell Williams"). Case,
accents, punctuation, featured artists, remaster notes and a leading "The" in
artist names are ignored. One typo is tolerated inside a word of five letters
or more, in names of at least nine letters and digits, unless it changes a
number, a Roman numeral or a plural.
Albums ignore case, accents, punctuation and a note that only says the album
was remastered, but tolerate no typo: "(Deluxe Remastered Edition)" is another
release.
From ListenBrainz, Deezer and iTunes, the album, track and disc numbers and
counts, album artist and cover are only taken when the result is on the track's
album (or no album is known) and that album is by the track's artist or by
various artists; so is the year from ListenBrainz. A cover band's
record that credits the original artist is therefore not taken as the track's
album.

1. **Discogs**, when the album is known (from the path or the tags), searches
   its masters (every edition of an album) by artist and album, then
   its releases when no master has the song, and only keeps the album whose
   tracklist holds the song. It gives the album, the genre, the album artist,
   the track and disc numbers and counts (not for vinyl sides such as `A1`),
   the cover and, from a master only, the album's original year. It needs a
   consumer key and secret: register an application in
   [your Discogs developer settings](https://www.discogs.com/settings/developers)
   and copy them into `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET`.
   Discogs allows 60 requests per minute, so its requests are spaced one
   second apart. When no album is known, Discogs searches the song after
   Deezer instead. With a known album, the search leaves out the title, so
   an album costs two requests per batch (search and album), shared by all its
   tracks; an album Discogs does not have costs two searches, also once.
2. **ListenBrainz** maps the artist and title to a MusicBrainz recording, and
   corrects typos in fields the file does not have yet. It needs a known artist, a user token (copy it from
   [your ListenBrainz settings](https://listenbrainz.org/settings/) into
   `LISTENBRAINZ_TOKEN`) and `MUSICBRAINZ_USER_AGENT`. It gives the album, the
   album artist, the most-voted genre and the Cover Art Archive cover. While
   details are missing, one MusicBrainz release lookup per album and batch adds
   the year the song was first released and the track and disc numbers and
   counts.
   ListenBrainz requests are spaced one second apart.
3. **MusicBrainz** search finds the recording, its year of first release and
   the Cover Art Archive cover, including for tracks with no known artist. It
   needs no API key, but a meaningful User-Agent: set `MUSICBRAINZ_USER_AGENT`
   to identify your SoundTag installation and provide contact information.
   MusicBrainz allows one request per second; SoundTag spaces its requests,
   release lookups included, 3.5 seconds apart, and asks once more when a
   request times out.
4. **Deezer** needs no key or account. Among its results, it prefers the
   searched song on the track's album, and gives the genre, the track and disc
   numbers and counts, the album artist and the 1000×1000 artwork. Its release
   dates are often those of a reissue, so SoundTag takes no year from Deezer.
   Its album requests are made once per album and batch, only while details are
   missing, and its requests are spaced half a second apart.
5. **iTunes**, through
   [Apple's Search API](https://performance-partners.apple.com/search-api),
   gives the year and the same details and artwork. Its searches are spaced at
   least four seconds apart to stay within the 20-requests-per-minute limit.
6. **Last.fm** is the last resort for the title, artist, album, year and cover.
   It makes up to two requests per track (a search, then the track details),
   spaced two seconds apart.

Cover image downloads are not rate-limited.
If no provider returns artwork for a track matched by the metadata services,
SoundTag searches Deezer for the album's cover when the album is known. As a
last resort, it can use a YouTube video thumbnail. This requires a
YouTube Data API key with access to `search.list`; set `YOUTUBE_API_KEY` to
enable it. The thumbnail may be a video still rather than the track's album
art, and YouTube API quota limits apply.

## Usage

Run SoundTag with a source folder:

```sh
soundtag /path/to/music
```

From the project folder, `npm start -- /path/to/music` works too.

Paths containing spaces should be quoted.

If no source folder is supplied, SoundTag opens a full-screen browser in the
current directory. The left pane lists subfolders and audio files, and the right
pane shows the stored tags of the file under the cursor (or, for a folder, its
file counts). When the terminal is tall enough (about 37 rows or more), the
file's embedded cover is drawn below its tags, growing with the terminal up to
24 rows tall, from about 61 rows. With the kitty graphics protocol, SoundTag
asks the terminal for its character size so the cover stays square: 48 columns
wide for characters twice as tall as wide (from about 104 columns), 54 for
8×18-pixel ones (from about 116). Konsole 22.04 or
later, kitty and Ghostty show it at full quality through the kitty graphics
protocol; other terminals draw it with colored half blocks, which needs true
color support (`COLORTERM=truecolor`, which tmux only passes on when configured
to). Inside tmux, screen or Zellij the kitty protocol is not detected. Set
`SOUNDTAG_COVER` to `kitty`, `blocks` or `none` to choose instead, for example
`kitty` in WezTerm with its kitty graphics enabled. Processing messages appear in the log pane below.

| Key                    | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `↑` `↓`, PgUp, PgDn    | Move the cursor                                              |
| Enter, `→`             | Open the folder under the cursor                             |
| `←`, Backspace, Delete | Go up one folder                                             |
| `t`                    | Tag the file or folder under the cursor                      |
| `a`                    | Tag the folder being browsed                                 |
| `e`                    | Rename the file or folder under the cursor                   |
| `D` (Shift+d)          | Remove all tags and the cover of the file under the cursor   |
| `r`                    | Include or exclude subfolders in folder runs                 |
| `w`                    | Turn overwriting (`--overwrite`) on or off for the next runs |
| `s`                    | Stop the current run after the file in progress              |
| `q`, Ctrl+C            | Quit (press again during a run to quit at once)              |
| Tab                    | Switch between the browser and the log pane                  |

`e` edits the name in place: Enter saves it, Esc or Ctrl+C cancels. A file
keeps its extension. A name already used in the folder (ignoring case) is
refused, and so is renaming a file or folder that a queued or running tag job
works on, including the other entries in the folder of a queued file.

`D` asks for confirmation in the log pane: press `y` to remove every tag and
the embedded cover (on MP3, ID3v1 and APE tags too); any other key cancels. Like a rename, it is refused for a file that a queued or running tag
job works on, including the other files in the folder of a queued file.

While the log pane has focus, `↑` `↓`, PgUp and PgDn scroll it; it stays in
place as new messages arrive until you scroll back to the bottom.

Tagging runs in the background, so you can keep browsing; further `t` and `a`
presses are queued and run one after another, and are ignored once you quit.
Once processed in this session, files get a colored dot: green for `TAGGED`,
yellow for `SKIPPED`, red for `FAILED`. A folder shows the worst status of the
files inside it. Folder runs include subfolders unless `--no-recursive` was
passed; `r` switches this for the folders queued next. Likewise, `w` switches
overwriting (off unless `--overwrite` was passed) for the files and folders
queued next. The status bar shows both choices. A file or folder that is already queued or running is not
queued again, even with a different choice; the log says so. A file moved or
removed outside SoundTag before its queued run starts is skipped. Quitting during a
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
immediately.

When you quit the browser, SoundTag exits with code 1 if any run failed (a
file failed), otherwise 0. Stopped runs do not count as failures. Without an
interactive terminal and without a source folder, SoundTag exits with code 1
before asking for anything.

Each file gets one log line per step: its current `tags`, each `search`, then
`write` or `skip`. A step
lists every service it asked, with its result (`✓` and the fields it added,
`no match`, or `✗` and the error) and its time, then any wait for the
service's request spacing (MusicBrainz takes one request every 3.5 seconds), and
names the song a service matched when it is not the searched one:

```text
[3/3] marley.flac (FLAC)
  tags   Is This Love · Bob Marley · Legend · 2002
  search ListenBrainz no match 0.5s · MusicBrainz ✓ (MusicBrainz HTTP 503, retried) track number 0.4s (+5.9s wait) · Deezer ✓ genre, cover 0.2s
  write  genre "Reggae" · track 3 · cover
```

While a service is still answering, the TUI log pane and an interactive
terminal show the step so far on a last line that the finished step replaces.
Service requests time out after 6 seconds, cover downloads after 10. A
service error moves on to the next service; any other error fails the file.

Pass `--overwrite` to replace existing tags too, not only fill empty ones:
even fully tagged files are searched, and every field a service finds (title,
artist, album, year, genre, album artist, track and disc numbers, cover)
replaces the stored one. Fields no service finds keep their stored value,
except a track or disc count whose number changed, which is cleared. The
folder album of an `<Artist> - <Album>` path still wins over the one a service
gives; elsewhere, the stored album is replaced too. A cover is only replaced
by one a metadata service finds for the song, never by the Deezer album or
YouTube fallbacks, and a cover identical to the stored one is not rewritten:

```sh
soundtag /path/to/music --overwrite
```

Pass `-v` or `--verbose` to also log every service request URL, with API keys
and tokens hidden:

```sh
soundtag /path/to/music -v
```

For filenames in the common `Artist - Title.<extension>` format, SoundTag
searches with the title and artist separately. It also removes
leading track or disc-track numbers and recognizes spaced hyphens, en dashes,
and em dashes as separators. If no reliable artist/title split is present, it
uses the cleaned filename as the title query. Existing embedded tags are used
as search context when present. Otherwise, SoundTag infers album context from
the nearest meaningful folder and artist context from the folder above it.
Single ambiguous folders are treated as album context, not assumed to be an
artist. Structural folders such as disc numbers, cover-art folders, and
unknown placeholders are ignored.

Files filed as `<Artist>/<Artist> - <Title>.<extension>` or
`<Artist> - <Album>/<Artist> - <Title>.<extension>` (disc folders such as
`CD1` in between are skipped) are searched first by the artist, title and album
of their path, and only then by their tags. The folder must name the file's
artist (ignoring case), and folders above the scanned one count too. An album
or track number repeated in the file name (`Artist - Album - 01 - Title`) is
left out of the title, and rip notes after the folder album (`(1991)`,
`[FLAC]`, `(Disc 1)`) are left out of the album; `Discography`, `Singles` and
similar folders give no album. When the tags name another version of the path's song (`Song (Live)` for
`Song`), what the path search finds is not used, so a live version never gets
the studio song's details.
The folder album fills an empty album tag and is never replaced by a service,
so a best-of or a compilation keeps all its tracks on one album; release
details (track and disc numbers, album artist, cover) are only taken from that
album.

## Output

Files are updated in place; no tagged copies are created. A source file is
skipped as already tagged only when it has a title, artist, year, genre, and
embedded cover art. If any of these are missing, SoundTag attempts to process
the file, so files tagged before genre support are processed again. An
embedded cover, genre, album artist, track or disc number already in the file
is kept, unless `--overwrite` is passed.
If the services return a title and artist but cannot find optional fields such
as the album, year, genre, track number, or cover art, SoundTag still writes
the fields it found.
Fields that the services did not find are left unchanged if the source file
already has values for them.
When the services add nothing the file lacks, it is not rewritten and is
reported as skipped.
Because the file is not considered fully tagged until year, genre and cover
art are present, later runs can retry to fill those gaps. SoundTag prefers the
year the song was first released, from ListenBrainz or MusicBrainz, and
otherwise takes the year of the matched song from iTunes or Last.fm. Each
file is processed sequentially using a temporary copy before replacement;
large lossless files therefore need temporary free space comparable to the
file size and can require substantial additional disk or NAS I/O.

With a source folder argument, a summary is printed at the end of the run:
the number of tagged, skipped and failed files, then each failed file, with
paths relative to the source folder. SoundTag writes
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
