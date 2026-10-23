export interface EventLink {
    label: string
    url: string
}

export const WHATSAPP_URL = 'https://exun.co/26/whatsapp'

export const DEFAULT_EVENT_LINKS: EventLink[] = [{ label: 'WhatsApp', url: WHATSAPP_URL }]

const MAX_LABEL_LENGTH = 60
const MAX_LINK_COUNT = 12

function toAbsoluteUrl(raw: string): string | null {
    let value = String(raw || '').trim()
    if (!value) return null
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`
    try {
        const parsed = new URL(value)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
        if (!parsed.hostname || !parsed.hostname.includes('.')) return null
        return parsed.toString()
    } catch {
        return null
    }
}

function labelFromUrl(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./i, '')
    } catch {
        return url
    }
}

function cleanLabel(raw: unknown, url: string): string {
    const label = typeof raw === 'string' ? raw.trim() : ''
    return (label || labelFromUrl(url)).slice(0, MAX_LABEL_LENGTH)
}

/**
 * Parse the JSON stored in `events.links` (or an already-parsed array) into a
 * safe, de-duplicated list of links. Invalid entries are dropped.
 */
export function parseEventLinks(raw: unknown): EventLink[] {
    let value = raw
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return []
        try {
            value = JSON.parse(trimmed)
        } catch {
            return []
        }
    }
    if (!Array.isArray(value)) return []

    const links: EventLink[] = []
    const seen = new Set<string>()
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const url = toAbsoluteUrl(String((item as Record<string, unknown>).url ?? ''))
        if (!url || seen.has(url)) continue
        seen.add(url)
        links.push({ label: cleanLabel((item as Record<string, unknown>).label, url), url })
        if (links.length >= MAX_LINK_COUNT) break
    }
    return links
}

/** Links to render for an event: stored links, or the WhatsApp default. */
export function eventLinksFor(raw: unknown): EventLink[] {
    const links = parseEventLinks(raw)
    return links.length ? links : DEFAULT_EVENT_LINKS.map((link) => ({ ...link }))
}

function lineToLink(line: string): { label?: string; url: string } | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    const pipe = trimmed.indexOf('|')
    if (pipe === -1) return { url: trimmed }
    const label = trimmed.slice(0, pipe).trim()
    const url = trimmed.slice(pipe + 1).trim()
    if (!url) return null
    return label ? { label, url } : { url }
}

/**
 * Validate admin input for `events.links`.
 *
 * Accepts a JSON array of `{ label, url }`, a JSON string of the same, or a
 * textarea value with one link per line (`Label | URL`, or just `URL`).
 * Returns the JSON string to store in D1, or null when there are no links.
 */
export function normalizeEventLinksInput(input: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    let items: unknown[] = []

    if (typeof input === 'string') {
        const trimmed = input.trim()
        if (!trimmed) return { ok: true, value: null }
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed)
                if (!Array.isArray(parsed)) return { ok: false, error: 'Links must be an array' }
                items = parsed
            } catch {
                return { ok: false, error: 'Links JSON is invalid' }
            }
        } else {
            items = trimmed.split('\n').map(lineToLink).filter((item): item is { label?: string; url: string } => item !== null)
        }
    } else if (Array.isArray(input)) {
        items = input
    } else {
        return { ok: false, error: 'Links must be a string or array' }
    }

    if (items.length > MAX_LINK_COUNT) {
        return { ok: false, error: `At most ${MAX_LINK_COUNT} links are allowed` }
    }

    const links: EventLink[] = []
    const seen = new Set<string>()
    for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return { ok: false, error: 'Each link must have a URL' }
        }
        const record = item as Record<string, unknown>
        const rawUrl = String(record.url ?? '').trim()
        if (!rawUrl) return { ok: false, error: 'Each link must have a URL' }
        const url = toAbsoluteUrl(rawUrl)
        if (!url) return { ok: false, error: `Invalid link URL: ${rawUrl}` }
        if (seen.has(url)) continue
        seen.add(url)
        links.push({ label: cleanLabel(record.label, url), url })
    }

    return { ok: true, value: links.length ? JSON.stringify(links) : null }
}
