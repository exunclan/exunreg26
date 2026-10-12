import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import type { AppContext } from '../types'

const EMAIL_COOKIE = '__Host-email'
const TOKEN_COOKIE = '__Host-auth_token'
const STATE_COOKIE = '__Host-oauth_state'
const LEGACY_EMAIL_COOKIE = 'email'
const LEGACY_TOKEN_COOKIE = 'auth_token'
const LEGACY_STATE_COOKIE = 'oauth_state'

export function cookieSecure(c: AppContext): boolean {
    if (c.env.COOKIE_SECURE === 'true') return true
    try {
        return new URL(c.req.url).protocol === 'https:'
    } catch {
        return false
    }
}

export function authCookieOpts(c: AppContext, maxAge: number) {
    return {
        path: '/',
        httpOnly: true,
        secure: cookieSecure(c),
        sameSite: 'Lax' as const,
        maxAge,
    }
}

export function getEmailCookie(c: AppContext): string | undefined {
    return getCookie(c, EMAIL_COOKIE) ?? getCookie(c, LEGACY_EMAIL_COOKIE)
}

export function getAuthTokenCookie(c: AppContext): string | undefined {
    return getCookie(c, TOKEN_COOKIE) ?? getCookie(c, LEGACY_TOKEN_COOKIE)
}

export function getStateCookie(c: AppContext): string | undefined {
    return getCookie(c, STATE_COOKIE) ?? getCookie(c, LEGACY_STATE_COOKIE)
}

function useHostPrefix(c: AppContext): boolean {
    return cookieSecure(c)
}

export function setAuthCookies(c: AppContext, email: string, token: string, maxAge: number) {
    const opts = authCookieOpts(c, maxAge)
    if (useHostPrefix(c)) {
        setCookie(c, EMAIL_COOKIE, email, opts)
        setCookie(c, TOKEN_COOKIE, token, opts)
        deleteCookie(c, LEGACY_EMAIL_COOKIE, { path: '/' })
        deleteCookie(c, LEGACY_TOKEN_COOKIE, { path: '/' })
    } else {
        setCookie(c, LEGACY_EMAIL_COOKIE, email, opts)
        setCookie(c, LEGACY_TOKEN_COOKIE, token, opts)
    }
}

export function clearAuthCookies(c: AppContext) {
    if (useHostPrefix(c)) {
        const opts = authCookieOpts(c, 0)
        const clear = { path: opts.path, secure: opts.secure, sameSite: opts.sameSite, httpOnly: opts.httpOnly }
        deleteCookie(c, EMAIL_COOKIE, clear)
        deleteCookie(c, TOKEN_COOKIE, clear)
    }
    deleteCookie(c, LEGACY_EMAIL_COOKIE, { path: '/' })
    deleteCookie(c, LEGACY_TOKEN_COOKIE, { path: '/' })
}

export function setStateCookie(c: AppContext, state: string, maxAge: number) {
    if (useHostPrefix(c)) {
        setCookie(c, STATE_COOKIE, state, authCookieOpts(c, maxAge))
        deleteCookie(c, LEGACY_STATE_COOKIE, { path: '/' })
    } else {
        setCookie(c, LEGACY_STATE_COOKIE, state, authCookieOpts(c, maxAge))
    }
}

export function clearStateCookie(c: AppContext) {
    if (useHostPrefix(c)) {
        const opts = authCookieOpts(c, 0)
        deleteCookie(c, STATE_COOKIE, { path: opts.path, secure: opts.secure, sameSite: opts.sameSite, httpOnly: opts.httpOnly })
    }
    deleteCookie(c, LEGACY_STATE_COOKIE, { path: '/' })
}
