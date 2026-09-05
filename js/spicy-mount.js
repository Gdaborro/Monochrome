//js/spicy-mount.js
// Boots the REAL vendored Spicy Lyrics page (js/spicy/) when the album cover
// in Monochrome's now-playing bar is pressed, mirroring how Spicetify opens
// Spicy's fullscreen:
//
//   PageView.Open(host)      — builds the authentic #SpicyLyricsPage DOM
//   Fullscreen.Open(true)    — cinema mode: Spicy takeover styling, no document
//                              fullscreen (Monochrome's overlay is the frame)
//   fetch -> ApplyLyrics     — Monochrome LRCLIB provider, real Spicy renderer
//
// Monochrome's own overlay chrome is hidden while the takeover lives, so what
// you see is one-to-one the Spicy page: NowBar transport, karaoke viewport,
// view controls. Closing (Spicy X button, Monochrome close, ESC/back) destroys
// the page and restores Monochrome.
//
// Same container contract as other fullscreen renderers: sets
// container.lyricsCleanup / container.lyricsManager so
// clearFullscreenLyricsSync() keeps working.

// Firewall FIRST: defines window.Spicetify before vendored modules evaluate.
import "./spicy/compat-firewall.js";

import "./spicy/css/tokens.css";
import "./spicy/css/primitives.css";
import "./spicy/css/default.css";
import "./spicy/css/ContentBox.css";
import "./spicy/css/Lyrics/main.css";
import "./spicy/css/Lyrics/Mixed.css";
import "./spicy/css/Simplebar.css";
import "./spicy/css/Loaders/DotLoader.css";
import "./spicy/css/Loaders/LoaderContainer.css";
import "./spicy/css/spicy-keyframes.css";
import "./spicy/css/spicy-fonts-local.css";
import "./spicy/css/DynamicBG/spicy-dynamic-bg.css";

import ApplyLyrics from "./spicy/utils/Lyrics/Global/Applyer.ts";
import monoFetchLyrics, {
    HideSpicyLoader,
    ShowQueueLoader,
} from "./spicy/utils/Lyrics/fetchLyrics.ts";
import PageView from "./spicy/components/Pages/PageView.ts";
import Fullscreen from "./spicy/components/Utils/Fullscreen.ts";
import { UpdateNowBar } from "./spicy/components/Utils/NowBar.ts";
import { ResetLastLine, ScrollToActiveLine } from "./spicy/utils/Scrolling/ScrollToActiveLine.ts";
import { ScrollSimplebar } from "./spicy/utils/Scrolling/Simplebar/ScrollSimplebar.ts";
import { onMonoGoBack } from "./spicy/components/Global/Session.ts";
import {
    SetMonoPlayer,
    SpotifyPlayer,
    liveAudio,
} from "./spicy/components/Global/SpotifyPlayer.ts";
import Global from "./spicy/components/Global/Global.ts";
import { $currentLyricsData, $currentLyricsType } from "./spicy/utils/stores.ts";
import ApplyDynamicBackground from "./spicy/components/DynamicBG/dynamicBackground.ts";
import LoadFonts, { ApplyFontPixel } from "./spicy/components/Styling/Fonts.ts";

let fontsLoaded = false;
let positionTimer = null;
let scrollRaf = null;
let lastLoop = null;
let lastShuffle = null;
let lastVolume = null;
let currentTrackId = null;

const syncedAudios = new Set();

function syncPlayState() {
    // Listen on every <audio> element: Monochrome crossfades between two, so
    // tracking a single captured element goes stale (frozen clock).
    document.querySelectorAll("audio").forEach((audio) => {
        if (syncedAudios.has(audio)) return;
        syncedAudios.add(audio);
        audio.addEventListener("play", onPlayState);
        audio.addEventListener("pause", onPlayState);
        audio.addEventListener("volumechange", onVolumeState);
    });
    onPlayState();
    onVolumeState();
}

function onPlayState() {
    const playing = (() => {
        try {
            const a = liveAudio();
            return a ? !a.paused : false;
        } catch {
            return false;
        }
    })();
    SpotifyPlayer.IsPlaying = playing;
    try {
        Global.Event.evoke("playback:playpause", { isPaused: !playing });
    } catch {}
}

function onVolumeState() {
    let audio = null;
    try {
        audio = liveAudio();
    } catch {}
    if (!audio) return;
    const volume = audio.muted ? 0 : Math.round(audio.volume * 100);
    if (volume === lastVolume) return;
    lastVolume = volume;
    try {
        Global.Event.evoke("playback:volume", volume);
    } catch {}
}

function pollTransportState() {
    try {
        Global.Event.evoke("playback:position", SpotifyPlayer.GetPosition());
    } catch {}
    try {
        const loop = SpotifyPlayer.LoopType;
        if (loop !== lastLoop) {
            lastLoop = loop;
            Global.Event.evoke("playback:loop", loop);
        }
        const shuffle = SpotifyPlayer.ShuffleType;
        if (shuffle !== lastShuffle) {
            lastShuffle = shuffle;
            Global.Event.evoke("playback:shuffle", shuffle);
        }
    } catch {}
}

function startTransportPolling() {
    stopTransportPolling();
    lastLoop = null;
    lastShuffle = null;
    lastVolume = null;
    onVolumeState();
    positionTimer = setInterval(pollTransportState, 500);
    // Mirrors upstream boot (app.tsx): the follow-the-active-line scroller is
    // driven by its own rAF loop, not by the animator. Without this there is
    // no autoscroll at all.
    const scrollTick = () => {
        try {
            if (ScrollSimplebar) ScrollToActiveLine(ScrollSimplebar);
        } catch {}
        scrollRaf = requestAnimationFrame(scrollTick);
    };
    scrollRaf = requestAnimationFrame(scrollTick);
}

function stopTransportPolling() {
    if (positionTimer) clearInterval(positionTimer);
    positionTimer = null;
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
}

function ensureHost() {
    const overlay = document.getElementById("fullscreen-cover-overlay");
    if (!overlay) return null;
    overlay.classList.add("spicy-native");
    let host = overlay.querySelector(":scope > #spicy-host");
    if (!host) {
        host = document.createElement("div");
        host.id = "spicy-host";
        overlay.prepend(host);
    }
    return host;
}

function teardownHost() {
    const overlay = document.getElementById("fullscreen-cover-overlay");
    overlay?.classList.remove("spicy-native");
    overlay?.querySelector(":scope > #spicy-host")?.remove();
}

async function destroyTakeover() {
    onMonoGoBack(null);
    stopTransportPolling();
    try {
        await PageView.Destroy();
    } catch (error) {
        console.warn("[Spicy] destroy failed", error);
    }
    teardownHost();
    currentTrackId = null;
}

onMonoGoBack(null);

function armGoBack() {
    // Spicy's X button lands here. Route it through Monochrome's own close
    // path (single teardown): overlay close -> lyrics cleanup -> destroyTakeover
    // below. That way X exits to the app instead of revealing Monochrome's
    // fullscreen underneath.
    onMonoGoBack(() => {
        try {
            document.getElementById("close-fullscreen-cover-btn")?.click();
        } catch (error) {
            console.warn("[Spicy] overlay close failed", error);
            void destroyTakeover();
        }
    });
}

function trackKey(track) {
    return track ? String(track.id ?? "") : "";
}

async function applyTrackLyrics(track) {
    const uri = `mono:track:${trackKey(track) || "unknown"}`;
    ShowQueueLoader();
    let result = null;
    try {
        result = await monoFetchLyrics(uri);
    } catch (error) {
        console.warn("[Spicy] provider failed", error);
        result = ["lyrics-not-found", 500, uri];
    }
    await ApplyLyrics(result);
    // Mirror Spicy's presentLyrics(): publish the payload type + data. The
    // animator (LyricsAnimator) and scroll engine do NOTHING while
    // $currentLyricsType is "None" — without this, rows mount with
    // transparent fill and no state classes: a blank viewport. Notice
    // payloads already maintain these stores inside ApplyLyrics.
    try {
        const descriptor = Array.isArray(result) ? result[0] : null;
        if (descriptor && typeof descriptor === "object" && descriptor.Type) {
            $currentLyricsType.set(descriptor.Type);
            try {
                $currentLyricsData.set(JSON.stringify(descriptor));
            } catch {}
        }
    } catch (error) {
        console.warn("[Spicy] lyrics store publish failed", error);
    }
    HideSpicyLoader();
}

function refreshDynamicBackground() {
    try {
        const contentBox = document.querySelector("#SpicyLyricsPage .ContentBox");
        if (contentBox) void ApplyDynamicBackground(contentBox, "lpagebg");
    } catch (error) {
        console.warn("[Spicy] dynamic background failed", error);
    }
}

/**
 * Open the Spicy fullscreen takeover for `track`, synced to `audioPlayer`.
 * Re-entry with a new track updates the live page instead of rebuilding it.
 */
export async function mountSpicyFullscreen(track, audioPlayer, lyricsManager, container) {
    const renderId = (container._spicyRenderId = (container._spicyRenderId || 0) + 1);
    void lyricsManager;

    if (!fontsLoaded) {
        fontsLoaded = true;
        try {
            // NOTE: upstream LoadFonts() pulls stylesheets from
            // fonts.spikerko.org, whose font files refuse cross-origin loads
            // (no ACAO), so the faces would never resolve here. The same
            // families are self-hosted via spicy-fonts-local.css instead; we
            // only run the font-measurement pixel the animator relies on.
            ApplyFontPixel();
            void LoadFonts;
        } catch (error) {
            console.warn("[Spicy] fonts failed", error);
        }
    }

    SetMonoPlayer(track, audioPlayer);
    syncPlayState();

    const key = trackKey(track);
    if (PageView.IsOpened && key && key === currentTrackId) return container._spicyHost || null;

    if (PageView.IsOpened) {
        // Track changed while open: live-update transport, backdrop, lyrics.
        // No teardown: destroying per track flashes and trips scroll measuring.
        return updateSpicyFullscreen(track, audioPlayer, lyricsManager, container, renderId);
    }

    // Fresh open.
    const host = ensureHost();
    if (!host) return null;
    container._spicyHost = host;
    currentTrackId = key;
    armGoBack();

    try {
        await PageView.Open(host);
    } catch (error) {
        console.error("[Spicy] page open failed", error);
        teardownHost();
        currentTrackId = null;
        return null;
    }
    if (renderId !== container._spicyRenderId) {
        await destroyTakeover();
        return null;
    }

    try {
        Fullscreen.Open(true, false);
    } catch (error) {
        console.warn("[Spicy] fullscreen enter failed", error);
    }

    startTransportPolling();
    await applyTrackLyrics(track);
    if (renderId !== container._spicyRenderId) {
        await destroyTakeover();
        return null;
    }

    const cleanup = () => {
        container._spicyDestroyed = true;
        void destroyTakeover();
    };
    container.lyricsCleanup = cleanup;
    container.lyricsManager = lyricsManager || null;
    container._spicyDestroyed = false;

    (globalThis.__spicyState = () => ({
        opened: PageView.IsOpened,
        fullscreen: Fullscreen.IsOpen,
        cinema: Fullscreen.CinemaViewOpen,
        uri: SpotifyPlayer.GetUri(),
        positionMs: SpotifyPlayer.GetPosition(),
        lines: document.querySelectorAll("#SpicyLyricsPage .LyricsContent .line").length,
        notice: document.querySelector("#SpicyLyricsPage .LyricsNotice")?.textContent?.trim() ?? null,
        pageHeight: document.querySelector("#SpicyLyricsPage")?.clientHeight ?? 0,
    }))();

    return host;
}

/** Live-update an open takeover for a new track (no teardown, no flash). */
export async function updateSpicyFullscreen(track, audioPlayer, lyricsManager, container, renderId) {
    SetMonoPlayer(track, audioPlayer);
    syncPlayState();
    currentTrackId = trackKey(track);
    try {
        UpdateNowBar(true);
    } catch (error) {
        console.warn("[Spicy] NowBar update failed", error);
    }
    refreshDynamicBackground();
    try {
        ResetLastLine();
    } catch {}
    await applyTrackLyrics(track);
    if (renderId !== undefined && renderId !== container._spicyRenderId) return null;
    const cleanup = () => {
        container._spicyDestroyed = true;
        void destroyTakeover();
    };
    container.lyricsCleanup = cleanup;
    container.lyricsManager = lyricsManager || null;
    container._spicyDestroyed = false;
    return container._spicyHost || null;
}

/** True while the Spicy takeover page is open. */
export function isSpicyTakeoverOpen() {
    try {
        return PageView.IsOpened === true;
    } catch {
        return false;
    }
}
