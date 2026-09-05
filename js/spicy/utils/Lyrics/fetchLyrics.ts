// Monochrome lyrics provider — replaces Spicy's Spotify-oriented
// utils/Lyrics/fetchLyrics.ts. Same exported contract:
//   default fetchLyrics(uri) -> [payload | notice, status, uri] | null
//   ShowQueueLoader(), ClearLyricsPageContainer(), FetchLyricsResult
// Lyrics come from LRCLIB (exact match, then fuzzy search, then plain
// untimed lyrics) and are shaped into Spicy's authentic Line/Static
// payloads so the real Spicy renderer + animator run unmodified.

import { MonoPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { PageContainer } from "../../components/Pages/PageView.ts";

export type FetchLyricsResult = [object | string, number, string?] | null;

type ParsedLine = { time: number; text: string };

function parseLrc(subtitles: string): ParsedLine[] {
    if (!subtitles) return [];
    return subtitles
        .split("\n")
        .map((raw) => {
            const line = raw.trim();
            const match = line.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)/);
            if (!match) return null;
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const frac = match[3] ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
            const text = (match[4] || "").trim();
            if (!text) return null;
            return { time: minutes * 60 + seconds + frac, text };
        })
        .filter((l): l is ParsedLine => l !== null);
}

function trackField(track: any, ...keys: string[]): string {
    for (const key of keys) {
        const value = track?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function getTitle(track: any): string {
    return trackField(track, "title", "name");
}

function getArtist(track: any): string {
    if (Array.isArray(track?.artists) && track.artists.length) {
        return track.artists
            .map((a: any) => (typeof a === "string" ? a : (a?.name ?? "")))
            .filter(Boolean)
            .join(", ");
    }
    const artist = track?.artist;
    if (typeof artist === "string") return artist;
    return artist?.name ?? "";
}

function getAlbum(track: any): string {
    const album = track?.album;
    if (typeof album === "string") return album;
    return album?.title ?? album?.name ?? "";
}

function toLinePayload(lines: ParsedLine[], uri: string, songWriters: string[]): object {
    // The animator divides by (EndTime - StartTime); LRCLIB sometimes repeats
    // a timestamp, which would make that span 0 (NaN gradient -> invisible
    // text). Enforce a minimum 0.5s span while keeping every start truthful.
    const content = lines.map((line, index) => {
        const next = lines[index + 1];
        const end = next ? Math.max(next.time, line.time + 0.5) : line.time + 4;
        return {
            Type: "Vocal",
            Text: line.text,
            StartTime: line.time,
            EndTime: end,
        };
    });
    return {
        Type: "Line",
        Content: content,
        StartTime: content.length ? content[0].StartTime : 0,
        SongWriters: songWriters,
        uri,
    };
}

function toStaticPayload(texts: string[], uri: string, songWriters: string[]): object {
    return {
        Type: "Static",
        Lines: texts.map((text) => ({ Text: text })),
        SongWriters: songWriters,
        uri,
    };
}

/**
 * Monochrome track objects can carry `composers: [{name}]` and/or
 * `credits: [{type, name}]` (see events.js track-info rendering). Map those
 * onto Spicy's SongWriters so the authentic "Written by" credits line shows.
 */
function getSongWriters(track: any): string[] {
    try {
        if (Array.isArray(track?.composers) && track.composers.length) {
            const names = track.composers
                .map((c: any) => (typeof c === "string" ? c : (c?.name ?? "")))
                .filter(Boolean);
            if (names.length) return names;
        }
        if (Array.isArray(track?.credits) && track.credits.length) {
            const names = track.credits
                .filter((c: any) => /composer|writer|lyricist/i.test(c?.type ?? ""))
                .map((c: any) => c?.name ?? "")
                .filter(Boolean);
            if (names.length) return [...new Set(names)];
        }
    } catch {}
    return [];
}

async function lrclibGet(title: string, artist: string, album: string, duration: number | null) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) params.append("album_name", album);
    if (duration) params.append("duration", String(duration));
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
    if (!response.ok) return null;
    return response.json();
}

async function lrclibSearch(title: string, artist: string) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
    if (!response.ok) return null;
    const hits = await response.json();
    return Array.isArray(hits) ? hits : [];
}

export function ClearLyricsPageContainer(): void {
    PageContainer?.querySelector(".LyricsContainer .LyricsContent")?.replaceChildren();
}

export function ShowQueueLoader(message?: string): void {
    // Mirrors the real Spicy loader: the page DOM owns .loaderContainer,
    // visibility is driven by the .active class (styled by LoaderContainer.css).
    const loader = PageContainer?.querySelector<HTMLElement>(
        ".LyricsContainer .loaderContainer"
    );
    if (!loader) return;
    loader.classList.add("active");
    if (message) {
        let messageEl = loader.querySelector<HTMLElement>(".loaderMessage");
        if (!messageEl) {
            messageEl = document.createElement("div");
            messageEl.className = "loaderMessage";
            loader.appendChild(messageEl);
        }
        messageEl.textContent = message;
    }
}

export function HideSpicyLoader(): void {
    const loader = PageContainer?.querySelector<HTMLElement>(
        ".LyricsContainer .loaderContainer"
    );
    loader?.classList.remove("active", "queued");
    loader?.querySelector(".loaderMessage")?.remove();
}

export default async function fetchLyrics(uri: string): Promise<FetchLyricsResult> {
    const track: any = MonoPlayer.track;
    if (!track) return ["lyrics-not-found", 404, uri];

    const title = getTitle(track);
    const artist = getArtist(track);
    if (!title || !artist) return ["lyrics-not-found", 404, uri];

    const album = getAlbum(track);
    const duration = track.duration ? Math.round(track.duration) : null;
    const songWriters = getSongWriters(track);

    try {
        const exact = await lrclibGet(title, artist, album, duration);
        if (exact?.syncedLyrics) {
            const lines = parseLrc(exact.syncedLyrics);
            if (lines.length) {
                console.info(`[Spicy] ${lines.length} synced lines via lrclib-get`);
                return [toLinePayload(lines, uri, songWriters), 200, uri];
            }
        }
        if (exact?.plainLyrics) {
            const texts = exact.plainLyrics.split("\n").map((s: string) => s.trim()).filter(Boolean);
            if (texts.length) {
                console.info(`[Spicy] ${texts.length} static lines via lrclib-get`);
                return [toStaticPayload(texts, uri, songWriters), 200, uri];
            }
        }
    } catch (error) {
        console.warn("[Spicy] exact lyrics lookup failed", error);
    }

    try {
        const hits = await lrclibSearch(title, artist);
        const syncedHit = hits.find((h: any) => h?.syncedLyrics);
        if (syncedHit) {
            const lines = parseLrc(syncedHit.syncedLyrics);
            if (lines.length) {
                console.info(`[Spicy] ${lines.length} synced lines via lrclib-search`);
                return [toLinePayload(lines, uri, songWriters), 200, uri];
            }
        }
        const plainHit = hits.find((h: any) => h?.plainLyrics);
        if (plainHit) {
            const texts = plainHit.plainLyrics.split("\n").map((s: string) => s.trim()).filter(Boolean);
            if (texts.length) {
                console.info(`[Spicy] ${texts.length} static lines via lrclib-search`);
                return [toStaticPayload(texts, uri, songWriters), 200, uri];
            }
        }
    } catch (error) {
        console.warn("[Spicy] fuzzy lyrics lookup failed", error);
    }

    // Keep the host binding referenced so bundlers preserve the wiring.
    void PageContainer;
    return ["lyrics-not-found", 404, uri];
}
