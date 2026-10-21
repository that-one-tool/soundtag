# SoundTag

SoundTag scans a folder of MP3, OGG, FLAC, and WAV files, looks up track
metadata with ListenBrainz, MusicBrainz, Deezer, iTunes and Last.fm, and
updates files in place with audio tags and cover art when a match is found.

## Requirements

- Node.js 24 or later
- A MusicBrainz User-Agent string to enable the MusicBrainz lookups
- A ListenBrainz user token, recommended for the most accurate matches
- Optionally, a Last.fm API key for the last-resort lookup

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
Only the five keys below are read from these files; other variables are
ignored:

```env
LASTFM_API_KEY=your_lastfm_api_key
MUSICBRAINZ_USER_AGENT=SoundTag/1.0.0 (your-contact-information)
LISTENBRAINZ_TOKEN=your_listenbrainz_user_token
YOUTUBE_API_KEY=your_youtube_data_api_key
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

1. **ListenBrainz** maps the artist and title to a MusicBrainz recording, and
   corrects typos in fields the file does not have yet. It needs a known artist, a user token (copy it from
   [your ListenBrainz settings](https://listenbrainz.org/settings/) into
   `LISTENBRAINZ_TOKEN`) and `MUSICBRAINZ_USER_AGENT`. It gives the album, the
   album artist, the most-voted genre and the Cover Art Archive cover. While
   details are missing, one MusicBrainz release lookup per album and batch adds
   the year the song was first released and the track and disc numbers and
   counts.
   ListenBrainz requests are spaced one second apart.
2. **MusicBrainz** search finds the recording, its year of first release and
   the Cover Art Archive cover, including for tracks with no known artist. It
   needs no API key, but a meaningful User-Agent: set `MUSICBRAINZ_USER_AGENT`
   to identify your SoundTag installation and provide contact information.
   MusicBrainz allows one request per second; SoundTag spaces its requests,
   release lookups included, three seconds apart.
3. **Deezer** needs no key or account. Among its results, it prefers the
   searched song on the track's album, and gives the genre, the track and disc
   numbers and counts, the album artist and the 1000×1000 artwork. Its release
   dates are often those of a reissue, so SoundTag takes no year from Deezer.
   Its album requests are made once per album and batch, only while details are
   missing, and its requests are spaced half a second apart.
4. **iTunes**, through
   [Apple's Search API](https://performance-partners.apple.com/search-api),
   gives the year and the same details and artwork. Its searches are spaced at
   least four seconds apart to stay within the 20-requests-per-minute limit.
5. **Last.fm** is the last resort for the title, artist, album, year and cover.
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
48 columns by 24 rows (from about 61 rows and 104 columns). Konsole 22.04 or
later, kitty and Ghostty show it at full quality through the kitty graphics
protocol; other terminals draw it with colored half blocks, which needs true
color support (`COLORTERM=truecolor`, which tmux only passes on when configured
to). Inside tmux, screen or Zellij the kitty protocol is not detected. Set
`SOUNDTAG_COVER` to `kitty`, `blocks` or `none` to choose instead, for example
`kitty` in WezTerm with its kitty graphics enabled. Processing messages appear in the log pane below.

| Key                    | Action                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `↑` `↓`, PgUp, PgDn    | Move the cursor                                            |
| Enter, `→`             | Open the folder under the cursor                           |
| `←`, Backspace, Delete | Go up one folder                                           |
| `t`                    | Tag the file or folder under the cursor                    |
| `a`                    | Tag the folder being browsed                               |
| `e`                    | Rename the file or folder under the cursor                 |
| `D` (Shift+d)          | Remove all tags and the cover of the file under the cursor |
| `r`                    | Include or exclude subfolders in folder runs               |
| `s`                    | Stop the current run after the file in progress            |
| `q`, Ctrl+C            | Quit (press again during a run to quit at once)            |
| Tab                    | Switch between the browser and the log pane                |

`e` edits the name in place: Enter saves it, Esc or Ctrl+C cancels. A file
keeps its extension. A name already used in the folder (ignoring case) is
refused, and so is renaming a file or folder that a queued or running tag job
works on, including the other entries in the folder of a queued file (its job
may rename that folder).

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
immediately.

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
overwritten, even one whose name differs only in letter case.

At the end of a run that was not stopped, each folder holding processed tracks
is renamed to `<Artist> - <Album>` when all its audio files share the same
artist and album tags (ignoring case). The album artist is used when a track
has one, so soundtracks and albums with guest artists count as one album. The
folder needs at least two tracks, all processed in the same run and trusted
enough to be renamed themselves. Other files, such as images, and subfolders
without audio files do not matter, but a subfolder holding tracks keeps the
folder as it is.

A disc folder such as `CD1` or `Disc 2` becomes `<Artist> - <Album> - CD1`,
unless the album title already ends with that disc. When sibling folders hold
the same album, each is suffixed with its disc number tag (`- CD3`); without a
distinct disc for each, they all keep their names and the log says so. A lone
folder of a multi-disc album also gets its disc number. The source folder and
its parents keep their names; in the browser, this is the folder it started
in. Runs of spaces in generated names are collapsed, so files whose tags hold
such spaces are renamed once. Use `--no-rename` to keep
file and folder names:

```sh
soundtag /path/to/music --no-rename
```

Pass `-v` or `--verbose` to log the Last.fm `track.getInfo` request URL:

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
art are present, later runs can retry to fill those gaps. SoundTag prefers the
year the song was first released, from ListenBrainz or MusicBrainz, and
otherwise takes the year of the matched song from iTunes or Last.fm. Each
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
