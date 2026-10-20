import { Hono } from 'hono'
import type { Bindings, AppContext } from '../types'
import { jsonError } from '../lib/response'
import { adminRequired, authRequired, getEmailFromCookie, isAuthenticated } from '../middleware/auth'
import { adminRateLimiter, apiRateLimiter, authRateLimiter, chatRateLimiter } from '../middleware/rateLimit'
import { cacheMiddleware } from '../middleware/cache'
import { getDb } from '../db/client'
import { isAdmin } from '../lib/admin'
import * as handlers from '../handlers/handlers'
import * as authHandlers from '../handlers/auth'
import * as profileHandlers from '../handlers/profile'
import * as queryHandlers from '../handlers/query'
import * as regHandlers from '../handlers/reg'
import * as summaryHandlers from '../handlers/summary'
import * as adminHandlers from '../handlers/admin'
import * as exportHandlers from '../handlers/export'
import * as backupHandlers from '../handlers/backup'
import * as chatHandlers from '../handlers/chat'
import * as adminTicketHandlers from '../handlers/adminTickets'
import * as adminKbHandlers from '../handlers/adminKb'
import * as ticketHandlers from '../handlers/tickets'
import { getRegistrationOverview } from '../handlers/adminRegs'
import { serveEventDetail, serveEvents, serveHome, serveShell } from '../lib/ssr'

export function serveAsset(c: AppContext, path: string) {
    const url = new URL(c.req.url)
    url.pathname = path
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
}

export async function notFoundHandler(c: AppContext) {
    const pathname = new URL(c.req.url).pathname
    if (pathname.startsWith('/api/')) return jsonError(c, 'Not found', 404)
    const last = pathname.split('/').pop() ?? ''
    if (last.includes('.')) return serveAsset(c, pathname)
    try {
        const res = await serveShell(c, '/404.html', pathname)
        return new Response(await res.text(), { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, max-age=30, must-revalidate', Vary: 'Cookie' } })
    } catch {
        const url = new URL(c.req.url)
        url.pathname = '/404.html'
        return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw)).then(
            async (res: Response) => new Response(await res.text(), { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
        )
    }
}

export function setupRoutes() {
    const app = new Hono<{ Bindings: Bindings }>()

    app.use('/api/*', apiRateLimiter)
    app.use('/api/chat/*', chatRateLimiter)

    app.get('/api/health', handlers.healthCheck)
    app.get('/api/auth/session', authHandlers.getSession)

    app.get('/api/admin/oauth2/start', adminRequired, backupHandlers.startOAuth2)
    app.get('/oauth2callback', adminRequired, backupHandlers.handleOAuth2Callback)

    app.post('/api/auth/send-otp', authRateLimiter, authHandlers.sendOTP)
    app.post('/api/auth/login', authRateLimiter, handlers.login)
    app.post('/api/auth/signup', authRateLimiter, handlers.signup)
    app.post('/api/auth/verify-otp', authRateLimiter, authHandlers.verifyOTP)

    app.post('/api/auth/logout', authHandlers.logout)
    app.post('/api/auth/logout-all', authRequired, authHandlers.logoutAll)

    app.get('/api/profile', authRequired, handlers.getProfile)
    app.patch('/api/profile', authRequired, profileHandlers.updateProfile)

    app.get('/api/events', cacheMiddleware(60), handlers.getAllEvents)
    app.get('/api/events/detail', cacheMiddleware(60), handlers.getEvent)
    app.get('/api/events/:id', cacheMiddleware(60), handlers.getEvent)
    app.get('/api/events/*', cacheMiddleware(60), handlers.getEvent)

    app.post('/api/query', authRequired, queryHandlers.queryHandler)
    app.get('/api/tickets/mine', authRequired, queryHandlers.listMyTickets)
    app.post('/api/tickets', authRequired, ticketHandlers.createTicket)
    app.get('/ticket', (c) => serveShell(c as AppContext, '/ticket.html', '/ticket'))

    app.post('/api/chat/conversations', authRequired, chatHandlers.createConversation)
    app.get('/api/chat/conversations', authRequired, chatHandlers.listConversations)
    app.get('/api/chat/conversations/:id', authRequired, chatHandlers.getConversation)
    app.delete('/api/chat/conversations/:id', authRequired, chatHandlers.deleteConversation)
    app.post('/api/chat/conversations/:id/messages', authRequired, chatHandlers.sendMessage)
    app.patch('/api/chat/conversations/:cid/messages/:mid', authRequired, chatHandlers.updateMessage)
    app.post('/api/chat/conversations/:id/escalate', authRequired, chatHandlers.escalateConversation)

    app.post('/api/submit_registrations', authRequired, regHandlers.submitRegistrations)
    app.put('/api/submit_registrations', authRequired, regHandlers.updateRegistration)
    app.delete('/api/submit_registrations', authRequired, regHandlers.deleteRegistration)
    app.get('/api/summary', authRequired, summaryHandlers.getUserSummary)

    app.get('/api/admin/stats', adminRequired, adminHandlers.getAdminStats)
    app.get('/api/admin/config', adminRequired, adminHandlers.getAdminConfig)
    app.get('/api/admin/regs', adminRequired, getRegistrationOverview)

    app.post('/api/admin/events', adminRequired, adminHandlers.createEvent)
    app.get('/api/admin/events/:id', adminRequired, adminHandlers.getAdminEvent)

    app.put('/api/admin/events/:id', adminRequired, adminHandlers.updateEvent)
    app.delete('/api/admin/events/:id', adminRequired, adminHandlers.deleteEvent)

    app.get('/api/admin/users/:id', adminRequired, adminHandlers.getUserDetails)

    app.get('/api/admin/events/:id/registrations', adminRequired, adminHandlers.getEventRegistrations)
    app.get('/api/admin/export', adminRequired, adminHandlers.exportData)
    app.post('/api/admin/send-invite', adminRequired, adminHandlers.sendInvite)
    app.post('/api/admin/import_events', adminRequired, adminHandlers.importEvents)

    app.post('/api/admin/export-sheets', adminRequired, adminRateLimiter, exportHandlers.exportSheets)
    app.post('/api/admin/backup-now', adminRequired, adminRateLimiter, exportHandlers.backupNow)

    app.get('/api/admin/tickets', adminRequired, adminTicketHandlers.listTickets)
    app.get('/api/admin/tickets/:id', adminRequired, adminTicketHandlers.getTicket)
    app.post('/api/admin/tickets/:id/reply', adminRequired, adminTicketHandlers.replyTicket)
    app.patch('/api/admin/tickets/:id', adminRequired, adminTicketHandlers.updateTicketStatus)

    app.get('/api/admin/kb/sources', adminRequired, adminKbHandlers.listSources)
    app.post('/api/admin/kb/sources', adminRequired, adminKbHandlers.addSources)
    app.post('/api/admin/kb/sources/seed', adminRequired, adminKbHandlers.seedFromEnv)
    app.delete('/api/admin/kb/sources/:id', adminRequired, adminKbHandlers.deleteSource)
    app.post('/api/admin/kb/sources/:id/toggle', adminRequired, adminKbHandlers.toggleSource)
    app.get('/api/admin/kb/sources/:id/chunks', adminRequired, adminKbHandlers.getSourceChunks)
    app.post('/api/admin/kb/sync', adminRequired, adminKbHandlers.syncSources)

    app.get('/', (c) => serveHome(c as AppContext))
    app.get('/events', (c) => serveEvents(c as AppContext))
    app.get('/login', (c) => serveShell(c as AppContext, '/login.html', '/login'))
    app.get('/summary', (c) => serveShell(c as AppContext, '/summary.html', '/summary'))
    app.get('/complete', (c) => serveShell(c as AppContext, '/complete.html', '/complete'))
    app.get('/admin', (c) => serveShell(c as AppContext, '/admin.html', '/admin'))
    app.get('/admin/regs', async (c) => {
        const ctx = c as AppContext
        if (!(await isAuthenticated(ctx))) return c.redirect('/login')
        const email = getEmailFromCookie(ctx)
        const db = getDb(ctx.env)
        if (!(await isAdmin(db, email, ctx.env))) return c.redirect('/login')
        return serveShell(ctx, '/admin-regs.html', '/admin/regs')
    })
    app.get('/brochure', (c) => serveShell(c as AppContext, '/brochure.html', '/brochure'))
    app.get('/query', (c) => serveShell(c as AppContext, '/query.html', '/query'))
    app.get('/query/tickets', (c) => serveShell(c as AppContext, '/query.html', '/query'))
    app.get('/event-detail', (c) => {
        const id = c.req.query('id') || c.req.query('eventId') || ''
        return serveEventDetail(c as AppContext, id)
    })
    app.get('/event/:slug', (c) => serveEventDetail(c as AppContext, c.req.param('slug') || ''))

    return app
}
