import { getDb } from '../db/client'
import * as queries from '../db/queries'
import type { EventRow } from '../db/queries'
import { getAuthenticatedEmail } from '../middleware/auth'
import { getEmailFromCookie } from '../middleware/auth'
import { isAuthenticated } from '../middleware/auth'
import { isAdmin } from './admin'
import { slugify } from './slug'
import type { AppContext } from '../types'

type SessionInfo = { authenticated: boolean; email: string | null; isAdmin: boolean }

const assetTextCache = new Map<string, string>()

async function assetText(c: AppContext, path: string): Promise<string> {
    const cached = assetTextCache.get(path)
    if (cached !== undefined) return cached
    const url = new URL(c.req.url)
    url.pathname = path
    const res = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
    const text = await res.text()
    if (assetTextCache.size > 100) assetTextCache.clear()
    assetTextCache.set(path, text)
    return text
}

function esc(s: unknown): string {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function safeJson(v: unknown): string {
    return JSON.stringify(v).replace(/</g, '\\u003c')
}

function isAllowedUrl(url: string): boolean {
    const v = String(url || '').trim()
    return /^(https?:\/\/|\/|#)/i.test(v) && !/^javascript:/i.test(v) && !/^data:/i.test(v)
}

function formatEventMode(mode: unknown): string {
    if (!mode || typeof mode !== 'string') return ''
    return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase()
}

function formatParticipants(count: unknown): string {
    const n = Number(count)
    if (!Number.isFinite(n)) return String(count || 'TBA')
    if (n === 1) return '1 participant'
    return `${n} participants`
}

function formatParticipantsDisplay(ev: any): string {
    const custom = ev ? ev.display_participants || ev.displayParticipants : ''
    if (custom && /[a-zA-Z]/.test(String(custom))) return String(custom)
    if (ev) {
        const name = String(ev.name || '')
        const id = String(ev.id || '')
        if (/surprise/i.test(name) || /surprise/i.test(id)) return '2 Teams | 1 Participant each'
    }
    return formatParticipants(ev ? ev.participants : 0)
}

function formatEligibility(eligibility: unknown, openToAll: unknown): string {
    if (openToAll) return 'Open to All'
    const nums = (String(eligibility == null ? '' : eligibility).match(/\d+/g) || []).map((n) => n.trim())
    if (nums.length >= 2) return `${nums[0]}th - ${nums[nums.length - 1]}th`
    if (nums.length === 1) return `${nums[0]}th`
    const clean = String(eligibility == null ? '' : eligibility).trim()
    return clean === '' ? 'All Classes' : clean
}

function formatEligibilityDetail(ev: any): string {
    if (ev.openToAll || ev.open_to_all || ev.openToAll) return 'Open to All'
    const nums = String(ev.eligibility == null ? '' : ev.eligibility).match(/\d+/g) || []
    if (nums.length >= 2) return `Grades ${nums[0]}-${nums[nums.length - 1]}`
    if (nums.length === 1) return `Grade ${nums[0]}`
    const clean = String(ev.eligibility == null ? '' : ev.eligibility).trim()
    return clean === '' ? 'TBA' : clean
}

function imageFor(ev: any): string {
    const raw = ev.image
    if (!raw) return '/assets/exun_base.webp'
    const s = String(raw)
    if (s.startsWith('/')) return s
    return `/illustrations/${s.split('/').pop()}`
}

function toPayload(ev: EventRow, regCount?: number) {
    const participantsText = String((ev as any).participants ?? 1)
    return {
        id: (ev as any).id,
        name: (ev as any).name,
        image: (ev as any).image,
        slug: slugify(String((ev as any).name || '')),
        description_short: (ev as any).descriptionShort,
        description_long: (ev as any).descriptionLong,
        descriptionShort: (ev as any).descriptionShort,
        descriptionLong: (ev as any).descriptionLong,
        participants: (ev as any).participants,
        display_participants: participantsText,
        displayParticipants: participantsText,
        mode: (ev as any).mode,
        points: (ev as any).points,
        individual: (ev as any).independentRegistration,
        independentRegistration: (ev as any).independentRegistration,
        independent_registration: (ev as any).independentRegistration,
        eligibility: (ev as any).eligibility,
        open_to_all: (ev as any).openToAll,
        openToAll: (ev as any).openToAll,
        dates: (ev as any).dates,
        ...(regCount !== undefined ? { registrations: regCount } : {}),
    }
}

function eventCardHtml(ev: any): string {
    const slug = slugify(String(ev.name || ev.id || ''))
    const eligibilityText = formatEligibility(ev.eligibility, ev.open_to_all || ev.openToAll)
    const participantsText = formatParticipantsDisplay(ev)
    const modeText = formatEventMode(ev.mode)
    return `<a href="/event/${esc(slug)}" class="event-card" data-event-id="${esc(ev.id)}">`
        + `<img src="${esc(imageFor(ev))}" alt="${esc(ev.name)}" class="event-card__image" loading="lazy" fetchpriority="low" />`
        + `<h3 class="event-card__title">${esc(ev.name)}</h3>`
        + `<div class="event-card__pills"><span class="event-card__mode">${esc(modeText)}</span><span class="event-card__eligibility">${esc(eligibilityText)}</span></div>`
        + `<div class="event-card__participants"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2977f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>${esc(participantsText)}</span></div>`
        + `</a>`
}

function sponsorRowHtml(list: any[]): string {
    return list.map((s) => {
        const rawHref = s.link || s.Link || '#'
        const rawSrc = s.imageUrl || s.ImageURL || s.image || ''
        const href = isAllowedUrl(rawHref) ? rawHref : '#'
        const src = isAllowedUrl(rawSrc) || String(rawSrc).startsWith('/') ? rawSrc : ''
        const alt = s.alt || s.Alt || 'Sponsor'
        const height = s.height || s.Height || '80px'
        return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="sponsor-link"><img src="${esc(src)}" alt="${esc(alt)}" class="sponsor-img" data-height="${esc(height)}" style="max-height:${esc(height)};height:auto;width:auto;max-width:100%" loading="lazy" fetchpriority="low" /></a>`
    }).join('')
}

function authHtml(session: SessionInfo): string {
    if (session.authenticated) {
        let links = `<a href="/summary" class="navbar__link">Registration Summary</a>`
        if (session.isAdmin) links += `<a href="/admin" class="navbar__link">Admin</a>`
        links += `<button class="btn btn--primary navbar__link" data-action="logout">Logout</button>`
        return links
    }
    return `<button class="btn btn--primary navbar__link" data-action="login">Login</button>`
}

function applyActiveLink(navbar: string, activePath: string): string {
    const norm = activePath === '/index.html' ? '/' : activePath
    return navbar.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*?)>/g, (m, pre: string, href: string, post: string) => {
        const h = href === '/index.html' ? '/' : href
        if (h !== norm) return m
        if (/navbar__link--active/.test(m)) return m
        if (/class="/.test(m)) return m.replace(/class="([^"]*)"/, 'class="$1 navbar__link--active"')
        return `<a ${pre}href="${href}"${post} class="navbar__link--active">`
    })
}

function inlineNavbar(html: string, navbar: string, session: SessionInfo, activePath: string): string {
    let nav = applyActiveLink(navbar, activePath)
    nav = nav.replace(/<div data-nav="auth"><\/div>/, `<div data-nav="auth">${authHtml(session)}</div>`)
    nav = nav.replace(/<div data-nav="auth"\/>/, `<div data-nav="auth">${authHtml(session)}</div>`)
    return html.replace(/<div id="navbar-container"><\/div>/, `<div id="navbar-container">${nav}</div>`)
}

function inlineFooter(html: string, footer: string): string {
    return html.replace(/<div id="footer-container"><\/div>/, `<div id="footer-container">${footer}</div>`)
}

function injectBeforeFirstScript(html: string, snippet: string): string {
    const idx = html.indexOf('<script')
    if (idx === -1) return html + snippet
    return html.slice(0, idx) + snippet + html.slice(idx)
}

function sessionSnippet(session: SessionInfo): string {
    return `<script>window.__SESSION__=${safeJson(session)};</script>`
}

async function getSessionInfo(c: AppContext): Promise<SessionInfo> {
    try {
        const authenticated = await isAuthenticated(c)
        if (!authenticated) return { authenticated: false, email: null, isAdmin: false }
        const email = getEmailFromCookie(c)
        const db = getDb(c.env)
        return { authenticated: true, email, isAdmin: await isAdmin(db, email, c.env) }
    } catch {
        return { authenticated: false, email: null, isAdmin: false }
    }
}

async function getSponsors(c: AppContext): Promise<any[]> {
    try {
        const raw = await assetText(c, '/data/sponsors.json')
        const data = JSON.parse(raw)
        return Array.isArray(data) ? data : data.sponsors || []
    } catch {
        return []
    }
}

async function getEventsForRequest(c: AppContext): Promise<any[]> {
    const db = getDb(c.env)
    const email = await getAuthenticatedEmail(c)
    let eventsList: EventRow[]
    if (email && (await isAdmin(db, email, c.env))) {
        eventsList = await queries.getAllEvents(db, 500)
    } else if (email) {
        const user = await queries.getUserByEmail(db, email)
        const all = await queries.getAllEvents(db, 500)
        eventsList = user && (user as any).individual ? all.filter((ev) => (ev as any).independentRegistration) : all
    } else {
        eventsList = await queries.getAllEvents(db, 500)
    }
    const regCounts = await queries.getRegistrationCountsByEvent(db).catch(() => new Map<string, number>())
    return eventsList.map((ev) => toPayload(ev, regCounts.get((ev as any).id) ?? 0))
}

async function findEvent(c: AppContext, slugOrId: string): Promise<any | null> {
    const db = getDb(c.env)
    const q = decodeURIComponent(slugOrId || '').trim()
    if (!q) return null
    const direct = await queries.getEventById(db, q).catch(() => null)
    if (direct) return toPayload(direct)
    const all = await queries.getAllEvents(db, 500)
    const found = all.find((ev) => (ev as any).id === q || slugify(String((ev as any).name || '')) === slugify(q))
    return found ? toPayload(found) : null
}

function eventDetailContent(ev: any): { title: string; heading: string; image: string; info: string; desc: string } {
    const name = String(ev.name || 'Event')
    const colon = name.indexOf(':')
    const heading = colon !== -1
        ? `<span class="accent">${esc(name.slice(0, colon + 1))}</span>${esc(name.slice(colon + 1))}`
        : esc(name)
    const isSurprise = /surprise/i.test(String(ev.name || '')) || /surprise/i.test(String(ev.id || ''))
    const participantsValue = isSurprise ? '2 Teams of 1' : String(ev.participants || 'TBA')
    const rows: Array<[string, string, string]> = [
        ['Mode', `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2977f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`, formatEventMode(ev.mode) || 'TBA'],
        ['Participants', `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2977f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, participantsValue],
        ['Eligibility', `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2977f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`, formatEligibilityDetail(ev)],
        ['Points', `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2977f5" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2c.9 6.2 3.8 9.1 10 10-6.2.9-9.1 3.8-10 10-.9-6.2-3.8-9.1-10-10 6.2-.9 9.1-3.8 10-10z"/></svg>`, String(ev.points || 0)],
        ['Dates', `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 9H21M7 3V5M17 3V5M6 12H8M11 12H13M16 12H18M6 15H8M11 15H13M16 15H18M6 18H8M11 18H13M16 18H18M6.2 21H17.8C18.9201 21 19.4802 21 19.908 20.782C20.2843 20.5903 20.5903 20.2843 20.782 19.908C21 19.4802 21 18.9201 21 17.8V8.2C21 7.07989 21 6.51984 20.782 6.09202C20.5903 5.71569 20.2843 5.40973 19.908 5.21799C19.4802 5 18.9201 5 17.8 5H6.2C5.0799 5 4.51984 5 4.09202 5.21799C3.71569 5.40973 3.40973 5.71569 3.21799 6.09202C3 6.51984 3 7.07989 3 8.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21Z" stroke="#2977f5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`, String(ev.dates || 'TBA')],
    ]
    const info = rows.map(([label, icon, value]) => `<div class="event-info-item"><span class="event-info-label">${icon}<span>${esc(label)}</span></span><span class="event-info-value">${esc(value)}</span></div>`).join('')
    const shortDesc = String(ev.description_short || ev.descriptionShort || '')
    const longDesc = String(ev.description_long || ev.descriptionLong || '')
    let desc = ''
    if (shortDesc) desc += `<p>${esc(shortDesc)}</p>`
    if (longDesc) desc += longDesc.split('\n').filter((p) => p.trim()).map((p) => `<p>${esc(p.trim())}</p>`).join('')
    if (!desc) desc = '<p>Details coming soon.</p>'
    return { title: `${name} | Exun 2026`, heading, image: imageFor(ev), info, desc }
}

const FILTERS: Array<[string, string]> = [['all', 'All Events'], ['build', 'Build'], ['gaming', 'Gaming'], ['cubing', 'Cubing'], ['robotics', 'Robotics']]

function filtersHtml(): string {
    return FILTERS.map(([key, name], i) => `<button class="filter-btn${i === 0 ? ' filter-btn--active' : ''}" data-filter="${esc(key)}">${esc(name)}</button>`).join('')
}

export async function serveHome(c: AppContext): Promise<Response> {
    const [raw, navbar, footer, session, sponsors, events] = await Promise.all([
        assetText(c, '/index.html'),
        assetText(c, '/components/navbar.html'),
        assetText(c, '/components/footer.html'),
        getSessionInfo(c),
        getSponsors(c),
        getEventsForRequest(c),
    ])
    let html = raw
    html = inlineNavbar(html, navbar, session, '/')
    html = inlineFooter(html, footer)
    const cards = events.length ? events.map(eventCardHtml).join('') : '<div class="no-events">No events published yet.</div>'
    html = html.replace(/<div class="loading-placeholder">Loading events\.\.\.<\/div>/, cards)
    html = html.replace(/<div class="sponsors-row" id="sponsors-row"><\/div>/, `<div class="sponsors-row" id="sponsors-row">${sponsorRowHtml(sponsors)}</div>`)
    html = injectBeforeFirstScript(html, `<script>window.__SESSION__=${safeJson(session)};window.__EVENTS__=${safeJson(events)};window.__SPONSORS__=${safeJson(sponsors)};</script>`)
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, max-age=30, must-revalidate', Vary: 'Cookie' } })
}

export async function serveEvents(c: AppContext): Promise<Response> {
    const [raw, navbar, footer, session, sponsors, events] = await Promise.all([
        assetText(c, '/events.html'),
        assetText(c, '/components/navbar.html'),
        assetText(c, '/components/footer.html'),
        getSessionInfo(c),
        getSponsors(c),
        getEventsForRequest(c),
    ])
    let html = raw
    html = inlineNavbar(html, navbar, session, '/events')
    html = inlineFooter(html, footer)
    const cards = events.length ? events.map(eventCardHtml).join('') : '<div class="no-events">No events found for the selected filter.</div>'
    html = html.replace(/<div class="events-page__filters" id="event-filters"><\/div>/, `<div class="events-page__filters" id="event-filters">${filtersHtml()}</div>`)
    html = html.replace(/<div class="loading-placeholder">Loading events\.\.\.<\/div>/, cards)
    html = html.replace(/<div class="sponsors-row" id="sponsors-row"><\/div>/, `<div class="sponsors-row" id="sponsors-row">${sponsorRowHtml(sponsors)}</div>`)
    if (session.authenticated) {
        html = html.replace('id="summary-btn-wrapper" style="display: none;', 'id="summary-btn-wrapper" style="display:;')
    }
    html = injectBeforeFirstScript(html, `<script>window.__SESSION__=${safeJson(session)};window.__EVENTS__=${safeJson(events)};window.__SPONSORS__=${safeJson(sponsors)};</script>`)
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, max-age=30, must-revalidate', Vary: 'Cookie' } })
}

export async function serveEventDetail(c: AppContext, slugOrId: string): Promise<Response> {
    const [raw, navbar, footer, session, ev] = await Promise.all([
        assetText(c, '/event-detail.html'),
        assetText(c, '/components/navbar.html'),
        assetText(c, '/components/footer.html'),
        getSessionInfo(c),
        findEvent(c, slugOrId),
    ])
    let html = raw
    html = inlineNavbar(html, navbar, session, '/events')
    html = inlineFooter(html, footer)
    if (ev) {
        const content = eventDetailContent(ev)
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(content.title)}</title>`)
        html = html.replace(/<h1 class="event-detail-heading" id="event-heading">[\s\S]*?<\/h1>/, `<h1 class="event-detail-heading" id="event-heading">${content.heading}</h1>`)
        html = html.replace(/<img[\s\S]*?id="event-image"[\s\S]*?\/>/, `<img src="${esc(content.image)}" alt="${esc(String(ev.name || 'Event'))}" class="event-detail__image" id="event-image" />`)
        html = html.replace(/<div class="event-description" id="event-description">[\s\S]*?<\/div>/, `<div class="event-description" id="event-description">${content.desc}</div>`)
        html = html.replace(/<div class="event-info" id="event-info">[\s\S]*?<\/div>/, `<div class="event-info" id="event-info">${content.info}</div>`)
    }
    html = injectBeforeFirstScript(html, `<script>window.__SESSION__=${safeJson(session)};window.__EVENT__=${safeJson(ev)};</script>`)
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, max-age=30, must-revalidate', Vary: 'Cookie' } })
}

export async function serveShell(c: AppContext, assetPath: string, activePath: string): Promise<Response> {
    const [raw, navbar, footer, session] = await Promise.all([
        assetText(c, assetPath),
        assetText(c, '/components/navbar.html'),
        assetText(c, '/components/footer.html'),
        getSessionInfo(c),
    ])
    let html = raw
    if (html.includes('id="navbar-container"')) html = inlineNavbar(html, navbar, session, activePath)
    if (html.includes('id="footer-container"')) html = inlineFooter(html, footer)
    html = injectBeforeFirstScript(html, sessionSnippet(session))
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, max-age=30, must-revalidate', Vary: 'Cookie' } })
}
