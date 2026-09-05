// Monochrome-backed player shim — same export surface as Spicy's
// components/Global/SpotifyPlayer.ts, driven by Monochrome's track object
// and HTML audio element instead of the Spotify desktop client.
//
// Units match the original: positions/durations in MILLISECONDS,
// Seek() takes milliseconds.

export type CoverSizes = "standard" | "small" | "large" | "xlarge";
export type Artist = {
    type: "artist";
    name: string;
    uri: string;
};

type MonoTrack = {
    id?: string | number;
    title?: string;
    name?: string;
    artists?: Array<string | { name?: string }>;
    artist?: { name?: string } | string;
    album?: { title?: string; name?: string } | string;
    duration?: number;
};

export const MonoPlayer: {
    track: MonoTrack | null;
    audio: HTMLAudioElement | null;
} = {
    track: null,
    audio: null,
};

export function SetMonoPlayer(track: MonoTrack | null, audio: HTMLAudioElement | null): void {
    MonoPlayer.track = track;
    MonoPlayer.audio = audio;
    SpotifyPlayer.IsPlaying = audio ? !audio.paused : false;
}

function trackId(): string {
    const t = MonoPlayer.track;
    if (!t) return "";
    return String(t.id ?? "");
}

function artistNames(): string[] {
    const t = MonoPlayer.track as any;
    if (!t) return [];
    if (Array.isArray(t.artists)) {
        return t.artists.map((a: any) => (typeof a === "string" ? a : (a?.name ?? ""))).filter(Boolean);
    }
    if (t.artist) {
        return [typeof t.artist === "string" ? t.artist : (t.artist.name ?? "")].filter(Boolean);
    }
    return [];
}

export function MonoCoverUrl(): string {
    const img = document.getElementById("fullscreen-cover-image") as HTMLImageElement | null;
    const url = img?.currentSrc || img?.src || "";
    if (!url || url.includes("/assets/appicon.png") || url.startsWith("data:")) return "";
    return url;
}

let liveCache: HTMLAudioElement | null = null;
let liveCacheAt = 0;
const LIVE_TTL_MS = 250;

/**
 * The element actually producing sound. Monochrome crossfades between two
 * <audio> elements, so an element captured earlier can go stale (frozen at
 * 0:00 while music plays). Re-resolves cheaply, cached for 250ms.
 */
export function liveAudio(): HTMLAudioElement | null {
    const now = performance.now();
    if (liveCache && now - liveCacheAt < LIVE_TTL_MS && liveCache.isConnected) return liveCache;
    const els = Array.from(document.querySelectorAll("audio"));
    liveCache = els.find((el) => !el.paused && !el.ended) ?? MonoPlayer.audio ?? els[0] ?? null;
    liveCacheAt = now;
    return liveCache;
}

export const SpotifyPlayer = {
    IsPlaying: false,
    GetPosition: (): number => {
        const a = liveAudio();
        return a ? a.currentTime * 1000 : 0;
    },
    GetContentType: (): string => "track",
    GetMediaType: (): string => "audio",
    GetDuration: (): number => {
        const t = MonoPlayer.track;
        return t?.duration ? t.duration * 1000 : 0;
    },
    Seek: (position: number): void => {
        const a = liveAudio();
        if (!a) return;
        try {
            a.currentTime = Math.max(0, position / 1000);
            void a.play().catch(() => {});
        } catch {
            /* ignore */
        }
    },
    GetCover: (_size: CoverSizes): string | undefined => MonoCoverUrl() || undefined,
    GetCoverFrom: (
        _size: CoverSizes,
        source: Array<{ url: string; label: string }> | undefined
    ): string | undefined => source?.[0]?.url ?? MonoCoverUrl() ?? undefined,
    GetName: (): string | undefined => {
        const t = MonoPlayer.track;
        return t ? ((t.title ?? t.name ?? "") as string) : undefined;
    },
    GetShowName: (): undefined => undefined,
    GetAlbumName: (): string | undefined => {
        const a = (MonoPlayer.track as any)?.album;
        if (!a) return undefined;
        return typeof a === "string" ? a : (a.title ?? a.name);
    },
    GetId: (): string | undefined => trackId() || undefined,
    GetSongId: (): string | undefined => trackId() || undefined,
    GetArtists: (): Artist[] | undefined =>
        artistNames().map((name) => ({ type: "artist" as const, name, uri: "" })),
    GetUri: (): string | undefined => {
        const id = trackId();
        return id ? `mono:track:${id}` : undefined;
    },
    Pause: (): void => {
        liveAudio()?.pause();
    },
    Play: (): void => {
        void liveAudio()?.play().catch(() => {});
    },
    TogglePlayState: (): void => {
        const a = liveAudio();
        if (!a) return;
        if (a.paused) void a.play().catch(() => {});
        else a.pause();
    },
    Skip: {
        Next: (): void => {
            document.getElementById("next-btn")?.click();
        },
        Prev: (): void => {
            document.getElementById("prev-btn")?.click();
        },
    },
    LoopType: "none",
    ShuffleType: "none",
    IsDJ: (): boolean => false,
    IsLiked: (): boolean => {
        // Monochrome marks liked tracks with .active on its like buttons.
        return (
            document.getElementById("fs-like-btn")?.classList.contains("active") ??
            document.getElementById("now-playing-like-btn")?.classList.contains("active") ??
            false
        );
    },
    ToggleLike: async (): Promise<void> => {
        // Delegate to Monochrome's own favorite toggle so state stays in sync.
        (document.getElementById("fs-like-btn") ??
            document.getElementById("now-playing-like-btn"))?.click();
    },
};

// Live transport-state bridges, read from Monochrome's own player UI so the
// vendored NowBar always reflects reality. Kept as getters on the same object.
function monoShuffleType(): string {
    const active =
        document.getElementById("fs-shuffle-btn")?.classList.contains("active") ??
        document.getElementById("shuffle-btn")?.classList.contains("active") ??
        false;
    return active ? "normal" : "none";
}

function monoLoopType(): string {
    const repeatBtn = document.getElementById("fs-repeat-btn");
    const one = repeatBtn?.innerHTML.includes("REPEAT_ONE") ?? repeatBtn?.innerHTML.includes("repeat-one") ?? false;
    const active = repeatBtn?.classList.contains("active") ?? false;
    if (one) return "track";
    return active ? "context" : "none";
}

Object.defineProperties(SpotifyPlayer, {
    LoopType: { get: monoLoopType, configurable: true },
    ShuffleType: { get: monoShuffleType, configurable: true },
});
