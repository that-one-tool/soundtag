import { valueOrEmpty } from "./track-metadata.js";
import type { TrackSearch } from "./types.js";

export interface FoundTrack {
    title?: string;
    artist?: string;
}

export interface FoundRelease {
    album?: string;
    albumArtist?: string;
    trackArtist?: string;
}

// Albums made only of symbols ("+", "÷") are compared as written.
function normalizeAlbum(album: string | undefined): string {
    const folded = foldText(album);
    const withoutNotes = folded
        .replaceAll(ALBUM_NOTE_BRACKET, "")
        .replace(ALBUM_NOTE_SUFFIX, "");
    return splitWords(withoutNotes).join("") || folded.trim();
}

function isSameAlbum(
    foundAlbum: string | undefined,
    searchedAlbum: string
): boolean {
    return (
        !searchedAlbum ||
        normalizeAlbum(foundAlbum) === normalizeAlbum(searchedAlbum)
    );
}

// Notes that name another version (live, karaoke, remix) must still differ.
const NOISE_BRACKET =
    /[([][^)\]]*\b(?:remaster(?:ed|s)?|feat|ft|explicit|mono|stereo)\b[^)\]]*[)\]]/gu;
const NOISE_SUFFIX =
    /\s[-–—]\s[^-–—]*\b(?:remaster(?:ed|s)?|explicit|mono|stereo)\b[^-–—]*$/u;
// An album note may only hold a remaster: "(Deluxe Remastered Edition)" is another release.
const ALBUM_NOTE =
    "(?:\\d{4}\\s+)?(?:digital(?:ly)?\\s+)?remaster(?:ed)?(?:\\s+\\d{4})?(?:\\s+(?:version|edition))?";
const ALBUM_NOTE_BRACKET = new RegExp(`[([]\\s*${ALBUM_NOTE}\\s*[)\\]]`, "gu");
const ALBUM_NOTE_SUFFIX = new RegExp(`\\s[-–—]\\s${ALBUM_NOTE}\\s*$`, "u");
const FEATURING_SUFFIX = /\s(?:feat\.?|ft\.|featuring)\s.*$/u;
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;
const ARTIST_SEPARATOR = /\s+(?:feat\.?|ft\.?|featuring|&|x|with)\s+|\s*,\s*/iu;

// Shorter names are too often different words one letter apart.
const MIN_TYPO_LENGTH = 9;
const MIN_TYPO_WORD_LENGTH = 5;
const NUMBER_WORD = /\d|^[ivxlcdm]+$/;

function foldText(text: string | undefined): string {
    return valueOrEmpty(text)
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{M}/gu, "");
}

function splitWords(text: string): string[] {
    return text.split(WORD_SEPARATOR).filter(Boolean);
}

function getWords(name: string | undefined): string[] {
    const withoutNotes = foldText(name)
        .replaceAll(NOISE_BRACKET, "")
        .replace(NOISE_SUFFIX, "")
        .replace(FEATURING_SUFFIX, "");
    return splitWords(withoutNotes);
}

function getCommonPrefixLength(first: string, second: string): number {
    let length = 0;
    while (length < first.length && first[length] === second[length]) {
        length++;
    }
    return length;
}

function sortByLength(first: string, second: string): [string, string] {
    return first.length <= second.length ? [first, second] : [second, first];
}

function isOneEditApart(shorter: string, longer: string): boolean {
    const lengthGap = longer.length - shorter.length;

    if (lengthGap > 1) {
        return false;
    }

    const prefixLength = getCommonPrefixLength(shorter, longer);
    return (
        shorter.slice(prefixLength + 1 - lengthGap) ===
        longer.slice(prefixLength + 1)
    );
}

// A changed number (track 2 vs 12, part I vs II) or plural names another work.
function isMeaningfulChange(shorter: string, longer: string): boolean {
    const isPlural = `${shorter}s` === longer;
    return isPlural || [shorter, longer].some((word) => NUMBER_WORD.test(word));
}

function isTypoWord(first: string, second: string): boolean {
    const [shorter, longer] = sortByLength(first, second);
    return (
        longer.length >= MIN_TYPO_WORD_LENGTH &&
        isOneEditApart(shorter, longer) &&
        !isMeaningfulChange(shorter, longer)
    );
}

function getDifferentWordPairs(
    found: string[],
    searched: string[]
): [string, string][] {
    return found
        .map((word, index): [string, string] => [word, searched[index]])
        .filter(([foundWord, searchedWord]) => foundWord !== searchedWord);
}

function canHoldTypo(found: string[], searched: string[]): boolean {
    const shortestLength = Math.min(
        found.join("").length,
        searched.join("").length
    );
    return (
        found.length === searched.length && shortestLength >= MIN_TYPO_LENGTH
    );
}

function isTypo(found: string[], searched: string[]): boolean {
    const pairs = getDifferentWordPairs(found, searched);
    return (
        canHoldTypo(found, searched) &&
        pairs.length === 1 &&
        isTypoWord(...pairs[0])
    );
}

export function isSameName(found: string | undefined, searched: string) {
    const foundWords = getWords(found);
    const searchedWords = getWords(searched);
    const isEqual = foundWords.join("") === searchedWords.join("");
    return isEqual || isTypo(foundWords, searchedWords);
}

// Unlike isSameName, notes such as "(feat. X)" count, so a correction keeps them.
export function isSameWording(found: string | undefined, searched: string) {
    const foundWords = splitWords(foldText(found));
    const searchedWords = splitWords(foldText(searched));
    const isEqual = foundWords.join("") === searchedWords.join("");
    return isEqual || isTypo(foundWords, searchedWords);
}

function splitArtists(credit: string | undefined): string[] {
    return valueOrEmpty(credit)
        .split(ARTIST_SEPARATOR)
        .filter((artist) => getWords(artist).length > 0);
}

const LEADING_ARTICLE = /^\s*the\s+(?=\S)/iu;

function removeLeadingArticle(name: string | undefined): string {
    return valueOrEmpty(name).replace(LEADING_ARTICLE, "");
}

// Services disagree on "The Black Eyed Peas" versus "Black Eyed Peas".
function isSameArtistName(found: string | undefined, searched: string) {
    const withoutArticles = [found, searched].map(removeLeadingArticle);
    return (
        isSameName(found, searched) ||
        isSameName(withoutArticles[0], withoutArticles[1])
    );
}

// Credits list featured artists in any order: "A feat. B", "B & A", "B, A".
function hasSharedArtist(found: string | undefined, searched: string) {
    const foundArtists = splitArtists(found);
    return splitArtists(searched).some((searchedArtist) =>
        foundArtists.some((foundArtist) =>
            isSameArtistName(foundArtist, searchedArtist)
        )
    );
}

function hasEveryArtist(artists: string[], others: string[]): boolean {
    return artists.every((artist) =>
        others.some((other) => isSameArtistName(other, artist))
    );
}

// Unlike isSameTrack, every artist must be on both sides, so a correction keeps them all.
export function isSameCredit(found: string | undefined, searched: string) {
    const foundArtists = splitArtists(found);
    const searchedArtists = splitArtists(searched);
    return (
        foundArtists.length === searchedArtists.length &&
        hasEveryArtist(foundArtists, searchedArtists) &&
        hasEveryArtist(searchedArtists, foundArtists)
    );
}

function isSameArtist(found: string | undefined, searched: string): boolean {
    return (
        isSameArtistName(found, searched) || hasSharedArtist(found, searched)
    );
}

// The first search result can be a karaoke or cover version, whose extras would stick.
export function isSameTrack(
    found: FoundTrack,
    { title, artist }: TrackSearch
): boolean {
    const isSearchedArtist = !artist || isSameArtist(found.artist, artist);
    return isSearchedArtist && isSameName(found.title, title);
}

const VARIOUS_ARTISTS = "variousartists";

export function isVariousArtists(artist: string): boolean {
    return getWords(artist).join("") === VARIOUS_ARTISTS;
}

function isAlbumArtistOf(albumArtist: string, trackArtist: string): boolean {
    return (
        isVariousArtists(albumArtist) || isSameArtist(albumArtist, trackArtist)
    );
}

// A cover band's record can list the original artist on its track.
function isCreditedRelease({ albumArtist, trackArtist }: FoundRelease) {
    return (
        !albumArtist ||
        !trackArtist ||
        isAlbumArtistOf(albumArtist, trackArtist)
    );
}

// Numbers, year and cover from another release (compilation, single) would be wrong.
export function isSameRelease(
    release: FoundRelease,
    searchedAlbum: string
): boolean {
    return (
        isSameAlbum(release.album, searchedAlbum) && isCreditedRelease(release)
    );
}
