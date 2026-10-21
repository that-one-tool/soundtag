import { isVariousArtists } from "../metadata/track-matching.js";
import type {
    AlternativeSearch,
    TrackInfo,
    TrackSearch,
} from "../metadata/types.js";
import { normalizeTagValue } from "./album-tags.js";
import { getSuspectFields, splitSuspectTitle } from "./suspect-tags.js";

export interface CorrectionSearches {
    tagSearch: TrackSearch;
    fileSearch: TrackSearch;
}

const WORD_GAP = /\s+/u;
const LEADING_ARTICLE = /^the$/iu;

function getSplitTitleSearch(info: TrackInfo): AlternativeSearch {
    const [artist, title] = splitSuspectTitle(info.title).map((part) =>
        part.trim()
    );
    const isTitleSuspect = getSuspectFields(info).includes("title");
    return {
        search: { title, artist, album: "" },
        replaces: isTitleSuspect ? ["title", "artist"] : [],
    };
}

function getFileSearch(
    info: TrackInfo,
    fileSearch: TrackSearch
): AlternativeSearch {
    return {
        search: { ...fileSearch, album: "" },
        replaces: getSuspectFields(info),
    };
}

// "The Beatles" and "Various Artists" are not names filed surname first.
function canSwapArtist(artist: string, words: string[]): boolean {
    const isSwappable = words.length === 2 && !LEADING_ARTICLE.test(words[0]);
    return isSwappable && !isVariousArtists(artist);
}

// Some libraries file artists surname first: "Marley Bob".
function getSwappedArtistSearch({
    title,
    artist,
}: TrackInfo): AlternativeSearch {
    const words = artist.trim().split(WORD_GAP);
    const swapped = canSwapArtist(artist, words)
        ? words.toReversed().join(" ")
        : "";
    return {
        search: { title, artist: swapped, album: "" },
        replaces: ["artist"],
    };
}

function hasTitleAndArtist({ title, artist }: TrackSearch): boolean {
    return Boolean(title.trim() && artist.trim());
}

function isUsable({ search, replaces }: AlternativeSearch): boolean {
    const isNamed =
        hasTitleAndArtist(search) && !isVariousArtists(search.artist);
    return isNamed && replaces.length > 0;
}

function getSearchKey({ title, artist }: TrackSearch): string {
    return [title, artist].map(normalizeTagValue).join("\u0000");
}

// Repeating a search only costs rate-limited requests.
function keepFirstOfEachSearch(
    alternatives: AlternativeSearch[],
    tagSearch: TrackSearch
): AlternativeSearch[] {
    const seen = new Set([getSearchKey(tagSearch)]);
    return alternatives.filter(({ search }) => {
        const key = getSearchKey(search);
        const isNew = !seen.has(key);
        seen.add(key);
        return isNew;
    });
}

// The album may be wrong too, and would narrow the searches to it.
export function getAlternativeSearches(
    info: TrackInfo,
    { tagSearch, fileSearch }: CorrectionSearches
): AlternativeSearch[] {
    const alternatives = [
        getSplitTitleSearch(info),
        getFileSearch(info, fileSearch),
        getSwappedArtistSearch(info),
    ].filter(isUsable);
    return keepFirstOfEachSearch(alternatives, tagSearch);
}
