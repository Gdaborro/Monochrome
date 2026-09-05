# Spicy engine inside Monochrome — provenance & license

The `js/spicy/` tree embeds the **real Spicy Lyrics engine** by
[Spikerko](https://github.com/Spikerko/spicy-lyrics)
(plus contributors), vendored from source for use as Monochrome's fullscreen
lyrics view.

- **Upstream:** https://github.com/Spikerko/spicy-lyrics
- **Upstream license:** AGPL-3.0 (see upstream `LICENSE`). That license applies
  to the vendored files listed below and to this site when it serves them:
  if you host this build publicly you must offer the complete corresponding
  source (this requirement comes from the upstream project, not from us).
- **Vendored verbatim** (byte-for-byte, only the import path roots changed by
  the mirror location): all files under `js/spicy/utils/`,
  `js/spicy/modules/`, `js/spicy/components/Global/Global.ts`,
  `js/spicy/css/` (including `spicy-keyframes.css`, transcribed from the
  runtime-injected keyframes block in upstream `src/app.tsx`) and
  `js/project/config.ts` (upstream keeps `project/` beside `src/`,
  mirrored here beside the vendor tree).
- **Upstream fonts self-hosted** under `public/fonts/spicy/` (same files as
  upstream's `fonts.spikerko.org`, which refuses cross-origin loads):
  `SpicyLyrics` (400-700), `Vazirmatn` (100-900), `Noto Sans Georgian`
  subsets; descriptors in `js/spicy/css/spicy-fonts-local.css`.
- **Written for this port (Monochrome-side, same license as this repo):**
  `js/spicy/components/Pages/PageView.ts` (host element holder),
  `js/spicy/components/Global/SpotifyPlayer.ts` (player shim),
  `js/spicy/utils/Lyrics/fetchLyrics.ts` (LRCLIB provider),
  `js/spicy/utils/stores.ts` + `js/spicy/utils/uiState.ts` (localStorage
  instead of Spicetify storage), `js/spicy/components/Utils/CompactMode.ts`,
  `PopupLyrics.ts`, `Fullscreen.ts` (stubs for Spotify-only surfaces),
  and `js/spicy-mount.js` (mounts the engine into Monochrome's overlay).

Spotify is a trademark of Spotify AB. This port is not affiliated with
Spotify, Spicetify, or the Spicy Lyrics project.
