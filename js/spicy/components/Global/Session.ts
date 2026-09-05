// Monochrome session shim — stands in for Spicy's components/Global/Session.ts,
// which drives Spotify-client routing (Spicetify.Platform.History). The real
// Spicy engine only ever calls Navigate (fire-and-forget route changes inside
// the Spotify client) and GoBack (leaving the lyrics page). In Monochrome,
// leaving the page means tearing down the fullscreen takeover, so GoBack is
// wired to a destroy callback registered by the mount code.
let goBackHandler: (() => void) | null = null;

export function onMonoGoBack(handler: (() => void) | null): void {
    goBackHandler = handler;
}

const Session = {
    Navigate(_location: unknown): void {},
    GoBack(): void {
        try {
            goBackHandler?.();
        } catch (error) {
            console.warn("[Spicy] GoBack handler failed", error);
        }
    },
    RecordNavigation(_location: unknown): void {},
};

export default Session;
