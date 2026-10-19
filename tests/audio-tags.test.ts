import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import NodeID3 from "node-id3";
import { File as TagLibFile } from "node-taglib-sharp";
import { afterEach, test } from "node:test";
import { getTagStore, isProperlyTagged } from "../src/audio-tags.js";
import { Id3TagStore } from "../src/id3-tag-store.js";
import { TagLibTagStore } from "../src/taglib-tag-store.js";
import type { TrackInfo } from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) =>
                fs.rm(directory, { recursive: true, force: true })
            )
    );
});

async function createTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "soundtag-audio-tags-test-")
    );
    temporaryDirectories.push(directory);
    return directory;
}

async function writeTags(
    source: string,
    info: TrackInfo,
    coverData: Buffer | null
): Promise<void> {
    await getTagStore(source).write(source, { info, coverData });
}

async function readInfo(source: string): Promise<TrackInfo> {
    return (await getTagStore(source).read(source)).info;
}

async function isTagged(source: string): Promise<boolean> {
    return isProperlyTagged(await getTagStore(source).read(source));
}

const completeInfo: TrackInfo = {
    title: "Title",
    artist: "Artist",
    album: "Album",
    year: "2024",
};

test("getTagStore picks the store for each supported format", () => {
    assert.ok(getTagStore("song.MP3") instanceof Id3TagStore);

    for (const filename of ["song.ogg", "song.FLAC", "song.wav"]) {
        assert.ok(getTagStore(filename) instanceof TagLibTagStore, filename);
    }

    assert.throws(
        () => getTagStore("notes.txt"),
        /^Error: Unsupported audio format: notes\.txt$/
    );
});

test("isProperlyTagged requires title, artist, year, and cover art", () => {
    const tagged = { info: completeInfo, hasCover: true };

    assert.equal(isProperlyTagged(tagged), true);
    assert.equal(isProperlyTagged({ ...tagged, hasCover: false }), false);

    for (const field of ["title", "artist", "year"] as const) {
        assert.equal(
            isProperlyTagged({
                ...tagged,
                info: { ...completeInfo, [field]: " " },
            }),
            false,
            field
        );
    }

    assert.equal(
        isProperlyTagged({ ...tagged, info: { ...completeInfo, album: "" } }),
        true
    );
});

test("tag stores report whether cover art is embedded", async () => {
    const directory = await createTemporaryDirectory();
    const mp3 = path.join(directory, "cover.mp3");
    const flac = path.join(directory, "cover.flac");
    await fs.writeFile(mp3, "audio bytes");
    await fs.copyFile(
        path.join(process.cwd(), "tests/fixtures/silent.flac"),
        flac
    );

    for (const source of [mp3, flac]) {
        assert.equal((await getTagStore(source).read(source)).hasCover, false);
        await writeTags(source, completeInfo, Buffer.from("cover"));
        assert.equal((await getTagStore(source).read(source)).hasCover, true);
    }
});

test("tag stores write MP3 tags that make the file properly tagged", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "source.mp3");
    await fs.writeFile(source, "audio bytes");

    assert.equal(await isTagged(source), false);
    await writeTags(
        source,
        {
            title: "Title",
            artist: "Artist",
            album: "Album",
            year: "2024",
        },
        Buffer.from("cover image")
    );

    assert.equal(await isTagged(source), true);
    const tags = await NodeID3.Promise.read(source);
    assert.equal(tags.year, "2024");
    assert.notEqual(await fs.readFile(source, "utf8"), "audio bytes");
});

const pngCover = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

test("tag stores trim the artist read from TagLib formats", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "padded.wav");
    await fs.copyFile(
        path.join(process.cwd(), "tests/fixtures/silent.wav"),
        source
    );
    const file = TagLibFile.createFromPath(source);
    try {
        file.tag.performers = ["  ", " Padded artist "];
        file.save();
    } finally {
        file.dispose();
    }

    assert.equal((await readInfo(source)).artist, "Padded artist");
});

test("tag stores write the detected MIME type of MP3 cover art", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "png-cover.mp3");
    await fs.writeFile(source, "audio bytes");

    await writeTags(
        source,
        { title: "Title", artist: "Artist", album: "", year: "" },
        pngCover
    );

    const tags = await NodeID3.Promise.read(source);
    assert.ok(typeof tags.image === "object");
    assert.equal(tags.image.mime, "image/png");
});

test("tag stores write the detected MIME type of FLAC cover art", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "png-cover.flac");
    await fs.copyFile(
        path.join(process.cwd(), "tests/fixtures/silent.flac"),
        source
    );

    await writeTags(
        source,
        { title: "Title", artist: "Artist", album: "", year: "" },
        pngCover
    );

    const file = TagLibFile.createFromPath(source);
    try {
        assert.equal(file.tag.pictures[0].mimeType, "image/png");
    } finally {
        file.dispose();
    }
});

test("tag stores preserve existing MP3 fields when metadata is unavailable", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "partial.mp3");
    const cover = Buffer.from("existing cover");
    await fs.writeFile(source, "audio bytes");
    assert.equal(
        NodeID3.write(
            {
                title: "Old title",
                artist: "Old artist",
                album: "Existing album",
                year: "2020",
                image: {
                    mime: "image/jpeg",
                    type: { id: 3, name: "front cover" },
                    description: "Cover",
                    imageBuffer: cover,
                },
            },
            source
        ),
        true
    );

    await writeTags(
        source,
        { title: "New title", artist: "New artist", album: "", year: "" },
        null
    );

    const tags = await NodeID3.Promise.read(source);
    assert.equal(tags.title, "New title");
    assert.equal(tags.artist, "New artist");
    assert.equal(tags.album, "Existing album");
    assert.equal(tags.year, "2020");
    assert.ok(typeof tags.image === "object");
    assert.deepEqual(tags.image.imageBuffer, cover);
});

test("tag stores preserve existing OGG fields when metadata is unavailable", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "partial.ogg");
    const fixture = path.join(process.cwd(), "tests/fixtures/silent.ogg");
    const cover = Buffer.from("existing cover");
    await fs.copyFile(fixture, source);
    await writeTags(
        source,
        {
            title: "Old title",
            artist: "Old artist",
            album: "Existing album",
            year: "2020",
        },
        cover
    );

    await writeTags(
        source,
        { title: "New title", artist: "New artist", album: "", year: "" },
        null
    );

    const file = TagLibFile.createFromPath(source);
    try {
        assert.equal(file.tag.title, "New title");
        assert.deepEqual(file.tag.performers, ["New artist"]);
        assert.equal(file.tag.album, "Existing album");
        assert.equal(file.tag.year, 2020);
        assert.equal(file.tag.pictures.length, 1);
        assert.deepEqual(
            Buffer.from(file.tag.pictures[0].data.toByteArray()),
            cover
        );
    } finally {
        file.dispose();
    }
});

for (const format of ["flac", "wav"] as const) {
    test(`tag stores write ${format.toUpperCase()} tags and preserve unavailable fields`, async () => {
        const directory = await createTemporaryDirectory();
        const source = path.join(directory, `source.${format}`);
        const fixture = path.join(
            process.cwd(),
            `tests/fixtures/silent.${format}`
        );
        const cover = Buffer.from("test-cover-data");
        await fs.copyFile(fixture, source);

        await writeTags(
            source,
            {
                title: "Original title",
                artist: "Original artist",
                album: "Existing album",
                year: "2020",
            },
            cover
        );
        await writeTags(
            source,
            {
                title: "Updated title",
                artist: "Updated artist",
                album: "",
                year: "",
            },
            null
        );

        assert.deepEqual(await readInfo(source), {
            title: "Updated title",
            artist: "Updated artist",
            album: "Existing album",
            year: "2020",
        });
        assert.equal(await isTagged(source), true);

        const file = TagLibFile.createFromPath(source);
        try {
            assert.equal(file.tag.pictures.length, 1);
            assert.deepEqual(
                Buffer.from(file.tag.pictures[0].data.toByteArray()),
                cover
            );
            assert.ok(file.properties.audioSampleRate > 0);
        } finally {
            file.dispose();
        }
    });
}

test("tag stores read an MP3 missing its artist as not properly tagged", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "incomplete.mp3");
    await fs.writeFile(source, "audio bytes");

    assert.equal(
        NodeID3.write(
            {
                title: "Title",
                year: "2024",
                artist: "",
                image: {
                    mime: "image/jpeg",
                    type: { id: 3, name: "front cover" },
                    description: "Cover",
                    imageBuffer: Buffer.from("cover image"),
                },
            },
            source
        ),
        true
    );

    assert.equal(await isTagged(source), false);
});

test("tag stores read an MP3 missing its year as not properly tagged", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "missing-year.mp3");
    await fs.writeFile(source, "audio bytes");

    assert.equal(
        NodeID3.write(
            {
                title: "Title",
                artist: "Artist",
                image: {
                    mime: "image/jpeg",
                    type: { id: 3, name: "front cover" },
                    description: "Cover",
                    imageBuffer: Buffer.from("cover image"),
                },
            },
            source
        ),
        true
    );

    assert.equal(await isTagged(source), false);
});

test("tag stores leave a TagLib year unset when it is not numeric", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "year.flac");
    await fs.copyFile(
        path.join(process.cwd(), "tests/fixtures/silent.flac"),
        source
    );

    await writeTags(source, { ...completeInfo, year: "unknown" }, null);

    assert.equal((await readInfo(source)).year, "");
});
