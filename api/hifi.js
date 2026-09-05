/**
 * Self-hosted API proxy for the music.aborro.dev / vercel.app origins.
 *
 * Why this exists: the public HiFi API mirrors and the Deezer stream mirror
 * only answer browser traffic from authorized origins (monochrome.tf,
 * localhost). From any other origin the browser gets 403s and playback dies
 * ("Could not resolve stream URL"). This function re-issues the same request
 * server-side with an authorized Origin/Referer and streams the response back
 * same-origin, so no browser gate applies.
 *
 * Route (parsed manually, no framework routing needed):
 *   /api/hifi/<key>/<rest...>?<query>
 * where <key> is one of HOSTS below. Examples:
 *   /api/hifi/dzr/stream/?isrc=USUG12208604&format=FLAC
 *   /api/hifi/lol/search/?q=blinding%20lights
 *
 * Notes / limits:
 * - Hobby-tier functions cap execution time; long audio streams are piped
 *   through, so very long plays may get cut by the platform. If that bites,
 *   move this route to infrastructure without duration caps.
 * - This impersonates an authorized origin. If a mirror owner objects or
 *   blocks it, respect that and point the instance settings at a mirror you
 *   have an arrangement with (long-term fix: your own HiFi API backend).
 */

const HOSTS = {
    // Official / community HiFi API mirrors (hifi-api compatible).
    tf: 'https://track-api.monochrome.tf',
    api: 'https://api.monochrome.tf',
    samidy: 'https://monochrome-api.samidy.com',
    lol: 'https://lol.samidy.workers.dev',
    wolf: 'https://wolf.qqdl.site',
    maus: 'https://maus.qqdl.site',
    vogel: 'https://vogel.qqdl.site',
    katze: 'https://katze.qqdl.site',
    hund: 'https://hund.qqdl.site',
    kinoplus: 'https://tidal.kinoplus.online',
    geeked: 'https://amz.geeked.wtf',
    // Deezer stream mirror used by the in-app Deezer fallback.
    dzr: 'https://dzr.tabs-vs-spaces.wtf',
};

const SPOOF_ORIGIN = 'https://monochrome.tf';

const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',
    'origin',
    'referer',
    'content-length',
]);

export default async function handler(req, res) {
    try {
        const fullUrl = new URL(req.url, 'http://localhost');
        const prefix = '/api/hifi/';
        if (!fullUrl.pathname.startsWith(prefix)) {
            res.status(404).json({ error: 'bad proxy path' });
            return;
        }
        const parts = fullUrl.pathname.slice(prefix.length).split('/').filter(Boolean);
        const key = parts.shift();
        const base = HOSTS[key];
        if (!base) {
            res.status(404).json({ error: `unknown upstream '${key || ''}'` });
            return;
        }

        const target = new URL(base + '/' + parts.map(encodeURIComponent).join('/'));
        fullUrl.searchParams.forEach((value, name) => {
            target.searchParams.append(name, value);
        });

        const headers = {};
        for (const [name, value] of Object.entries(req.headers || {})) {
            if (HOP_BY_HOP.has(String(name).toLowerCase())) continue;
            headers[name] = Array.isArray(value) ? value.join(', ') : value;
        }
        headers['Origin'] = SPOOF_ORIGIN;
        headers['Referer'] = SPOOF_ORIGIN + '/';
        if (!headers['user-agent']) headers['user-agent'] = 'Mozilla/5.0';
        delete headers['content-length'];

        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const upstream = await fetch(target.toString(), {
            method: req.method,
            headers,
            body: hasBody ? req : undefined,
            redirect: 'follow',
        });

        const outHeaders = {};
        upstream.headers.forEach((value, name) => {
            if (HOP_BY_HOP.has(String(name).toLowerCase())) return;
            if (String(name).toLowerCase() === 'content-encoding') return;
            outHeaders[name] = value;
        });
        outHeaders['Access-Control-Allow-Origin'] = '*';
        outHeaders['Cache-Control'] = 'no-store';

        res.writeHead(upstream.status, outHeaders);
        if (req.method === 'HEAD' || !upstream.body) {
            res.end();
            return;
        }
        const reader = upstream.body.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!res.write(value)) {
                    await new Promise((resolve) => res.once('drain', resolve));
                }
            }
        } finally {
            try {
                reader.releaseLock();
            } catch {}
        }
        res.end();
    } catch (error) {
        console.error('[hifi-proxy]', error);
        if (!res.headersSent) res.status(502).json({ error: 'upstream fetch failed' });
        else
            try {
                res.end();
            } catch {}
    }
}

export const config = {
    maxDuration: 60,
};
