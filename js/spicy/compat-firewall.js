//js/spicy/compat-firewall.js
// Minimal `window.Spicetify` stand-in so the vendored Spicy engine (written
// against the Spotify desktop client) runs inside Monochrome. Every member
// here exists ONLY because verbatim vendored code touches it:
//
// - Tippy/TippyProps: tooltip popups -> inert stubs (title attr fallback)
// - Player.getVolume/setVolume/setMute/toggleMute/setRepeat/setShuffle:
//   transport controls -> Monochrome audio element + player buttons
// - GraphQL/CosmosAsync: Spotify backends (artist art, audio analysis) ->
//   rejecting stubs; callers run in DynamicBG paths that are skipped unless
//   those background modes are enabled
// - LocalStorage/SVGIcons: trivial bridges
//
// Import this module FIRST (side effect) before any vendored Spicy module.

import { MonoPlayer, liveAudio } from "./components/Global/SpotifyPlayer.ts";
import Global from "./components/Global/Global.ts";

function monoAudio() {
    return liveAudio() || MonoPlayer.audio;
}

function clickButton(...ids) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
            el.click();
            return true;
        }
    }
    return false;
}

function makeTippy() {
    return {
        destroy() {},
        setContent() {},
        show() {},
        hide() {},
        unmount() {},
        disable() {},
        enable() {},
        setProps() {},
    };
}

const pendingGraphQLWarned = { current: false };

globalThis.Spicetify = globalThis.Spicetify || {};
const Spicetify = globalThis.Spicetify;

Spicetify.Tippy =
    Spicetify.Tippy ||
    ((element, props) => {
        if (element && props?.content && typeof props.content === "string") {
            element.setAttribute("title", props.content);
        }
        return makeTippy();
    });
Spicetify.TippyProps = Spicetify.TippyProps || {};

Spicetify.Player = Spicetify.Player || {};
const SpPlayer = Spicetify.Player;
SpPlayer.getVolume =
    SpPlayer.getVolume ||
    (() => {
        const a = monoAudio();
        return a ? Math.round(a.volume * 100) : 100;
    });
SpPlayer.setVolume =
    SpPlayer.setVolume ||
    ((volume) => {
        const a = monoAudio();
        if (a) a.volume = Math.min(1, Math.max(0, volume / 100));
    });
SpPlayer.setMute =
    SpPlayer.setMute ||
    ((mute) => {
        const a = monoAudio();
        if (a) a.muted = !!mute;
    });
SpPlayer.toggleMute =
    SpPlayer.toggleMute ||
    (() => {
        const a = monoAudio();
        if (!a) return;
        const next = !a.muted;
        a.muted = next;
        try {
            Global.Event.evoke("playback:volume", next ? 0 : Math.round(a.volume * 100));
        } catch {}
    });
SpPlayer.setRepeat =
    SpPlayer.setRepeat ||
    (() => {
        clickButton("fs-repeat-btn", "repeat-btn");
    });
SpPlayer.setShuffle =
    SpPlayer.setShuffle ||
    (() => {
        clickButton("fs-shuffle-btn", "shuffle-btn");
    });

Spicetify.GraphQL =
    Spicetify.GraphQL ||
    (async () => {
        if (!pendingGraphQLWarned.current) {
            pendingGraphQLWarned.current = true;
            console.warn("[Spicy] Spotify GraphQL unavailable in Monochrome port; artist visuals degraded.");
        }
        throw new Error("Spotify GraphQL unavailable in Monochrome port");
    });

Spicetify.CosmosAsync =
    Spicetify.CosmosAsync ||
    ({
        get: async () => {
            throw new Error("Spotify Cosmos unavailable in Monochrome port");
        },
        post: async () => {
            throw new Error("Spotify Cosmos unavailable in Monochrome port");
        },
    });

Spicetify.LocalStorage = Spicetify.LocalStorage || {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
};

Spicetify.SVGIcons = Spicetify.SVGIcons || {};

export default Spicetify;
