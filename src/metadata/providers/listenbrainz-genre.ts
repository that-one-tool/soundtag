import type {
    ListenBrainzTag,
    ListenBrainzTags,
} from "./listenbrainz-client.js";

// The most specific level with a genre wins: an album's genre can be wrong for one track.
const TAG_LEVELS = ["recording", "release_group", "artist"] as const;
const WORD_START = /(^|[\s\-&/])(\p{L})/gu;
const WORD = /[\p{L}\p{N}]+/gu;
const ACRONYMS = new Set(["uk", "us", "edm", "idm", "ebm", "dj", "mc"]);

function getGenreTags(tags: ListenBrainzTag[] = []): ListenBrainzTag[] {
    return tags.filter((tag) => tag.genre_mbid && tag.tag);
}

function getMostSpecificGenres(tags: ListenBrainzTags = {}): ListenBrainzTag[] {
    const levels = TAG_LEVELS.map((level) => getGenreTags(tags[level]));
    return levels.find((genres) => genres.length > 0) ?? [];
}

function getVotes(tag: ListenBrainzTag): number {
    return tag.count ?? 0;
}

function getMostVoted(tags: ListenBrainzTag[]): ListenBrainzTag | undefined {
    return tags.toSorted(
        (first, second) => getVotes(second) - getVotes(first)
    )[0];
}

function capitalizeAcronyms(text: string): string {
    return text.replaceAll(WORD, (word) =>
        ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word
    );
}

function toTitleCase(text: string): string {
    const capitalized = text.replaceAll(
        WORD_START,
        (_match, separator: string, letter: string) =>
            separator + letter.toUpperCase()
    );
    return capitalizeAcronyms(capitalized);
}

export function pickGenre(
    tags: ListenBrainzTags | undefined
): string | undefined {
    const genre = getMostVoted(getMostSpecificGenres(tags))?.tag;
    return genre && toTitleCase(genre);
}
