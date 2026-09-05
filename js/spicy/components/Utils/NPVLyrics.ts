// Compatibility stub — Spicy's NPVLyrics injects a lyrics card into Spotify's
// Now Playing sidebar, which does not exist in Monochrome. The real engine
// only calls these to hand the page over to / back from that card, so they
// are safe no-ops here.
export const NPVCardOwnsPage = (): boolean => false;
export async function DeRenderNPVCard(): Promise<void> {}
export function RequestNPVCardEvaluate(): void {}
