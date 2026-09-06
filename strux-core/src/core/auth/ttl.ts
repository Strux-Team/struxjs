/**
 * Parse a TTL value (number in seconds or string duration like "30d", "1h", "15m", "60s", "1w")
 * into a safe, positive integer number of seconds.
 *
 * @param ttl            - The TTL value as number or string (e.g. 3600, "1h", "30d", "7d", "60s")
 * @param defaultSeconds - Fallback integer seconds if ttl is undefined, invalid, or <= 0
 */
export function parseTtlToSeconds(ttl: number | string | undefined | null, defaultSeconds: number): number {
    const fallback = Math.max(1, Math.floor(defaultSeconds));
    if (ttl === undefined || ttl === null) return fallback;

    if (typeof ttl === "number") {
        return !isNaN(ttl) && ttl > 0 ? Math.floor(ttl) : fallback;
    }

    if (typeof ttl === "string") {
        const trimmed = ttl.trim();
        if (/^\d+$/.test(trimmed)) {
            const val = parseInt(trimmed, 10);
            return val > 0 ? val : fallback;
        }
        const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/i);
        if (match) {
            const num = parseFloat(match[1]);
            const unit = (match[2] || "s").toLowerCase();
            let seconds = num;
            switch (unit) {
                case "w": seconds = num * 7 * 24 * 3600; break;
                case "d": seconds = num * 24 * 3600; break;
                case "h": seconds = num * 3600; break;
                case "m": seconds = num * 60; break;
                case "s": seconds = num; break;
            }
            const res = Math.floor(seconds);
            return res > 0 ? res : fallback;
        }
    }

    return fallback;
}
