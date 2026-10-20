import type { AppContext } from '../types'
import { jsonOk } from '../lib/response'
import { getDb } from '../db/client'
import * as queries from '../db/queries'

export interface RegParticipant {
    name: string
    email: string
    phone: string
    class: string
}

export interface RegRow {
    id: number
    eventId: string
    eventName: string
    eventMode: string
    capacity: number
    userId: number
    teamName: string
    status: string
    createdAt: string
    kind: 'school' | 'individual'
    accountName: string
    accountEmail: string
    accountPhone: string
    schoolName: string
    schoolCode: string
    address: string
    principalName: string
    principalEmail: string
    participants: RegParticipant[]
}

export interface RegEvent {
    id: string
    name: string
    mode: string
    capacity: number
    points: number
    eligibility: string
    dates: string
    openToAll: boolean
    independentRegistration: boolean
    registrationCount: number
    participantCount: number
    schoolCount: number
    individualCount: number
}

export interface RegSchool {
    name: string
    code: string
    registrationCount: number
    participantCount: number
    eventCount: number
    eventIds: string[]
}

export interface RegsPayload {
    generatedAt: string
    totals: {
        registrations: number
        participants: number
        schools: number
        individuals: number
        events: number
    }
    events: RegEvent[]
    rows: RegRow[]
    schools: RegSchool[]
}

function groupKey(name: string, code: string): string {
    const c = String(code || '').trim().toLowerCase()
    if (c) return c
    const n = String(name || '').trim().toLowerCase()
    return n || 'unknown'
}

export async function getRegistrationOverview(c: AppContext) {
    const db = getDb(c.env)

    const [userRows, regRows, indivRows, eventRows] = await Promise.all([
        queries.getAllUsers(db, 100000),
        queries.getAllRegistrations(db, 100000),
        queries.getAllIndividualRegistrations(db),
        queries.getAllEvents(db, 1000),
    ])

    const userById = new Map(userRows.map((u) => [u.id, u]))
    const eventById = new Map(eventRows.map((e) => [String(e.id), e]))

    const membersByUserEvent = new Map<string, queries.IndividualRegistrationRow[]>()
    for (const m of indivRows) {
        if (!m.eventId) continue
        const key = `${m.userId}:${m.eventId}`
        const list = membersByUserEvent.get(key) ?? []
        list.push(m)
        membersByUserEvent.set(key, list)
    }

    const rows: RegRow[] = []
    const eventAgg = new Map<string, RegEvent>()
    const schoolAgg = new Map<string, RegSchool>()

    for (const ev of eventRows) {
        eventAgg.set(String(ev.id), {
            id: String(ev.id),
            name: ev.name,
            mode: ev.mode,
            capacity: ev.participants,
            points: ev.points,
            eligibility: ev.eligibility ?? '',
            dates: ev.dates ?? '',
            openToAll: ev.openToAll,
            independentRegistration: ev.independentRegistration,
            registrationCount: 0,
            participantCount: 0,
            schoolCount: 0,
            individualCount: 0,
        })
    }

    for (const r of regRows) {
        const u = userById.get(r.userId)
        const ev = eventById.get(String(r.eventId))
        const isIndividual = !!u?.individual
        const members = membersByUserEvent.get(`${r.userId}:${r.eventId}`) ?? []
        const participants: RegParticipant[] = members.map((m) => ({
            name: String(m.fullname ?? ''),
            email: String(m.userEmail ?? ''),
            phone: String(m.phoneNumber ?? ''),
            class: String(m.className ?? ''),
        }))
        const schoolName = isIndividual ? '' : String(u?.institutionName ?? '').trim()
        const schoolCode = isIndividual ? '' : String(u?.schoolCode ?? '').trim()
        const accountName = isIndividual
            ? String(u?.fullname ?? u?.username ?? u?.email ?? '').trim()
            : schoolName || String(u?.fullname ?? u?.username ?? u?.email ?? '').trim()

        const row: RegRow = {
            id: r.id,
            eventId: String(r.eventId),
            eventName: ev?.name ?? String(r.eventId),
            eventMode: ev?.mode ?? '',
            capacity: ev?.participants ?? 0,
            userId: r.userId,
            teamName: String(r.teamName ?? ''),
            status: r.status,
            createdAt: r.createdAt,
            kind: isIndividual ? 'individual' : 'school',
            accountName,
            accountEmail: String(u?.email ?? ''),
            accountPhone: String(u?.phoneNumber ?? ''),
            schoolName,
            schoolCode,
            address: isIndividual ? String(u?.address ?? '') : String(u?.address ?? ''),
            principalName: isIndividual ? '' : String(u?.principalsName ?? ''),
            principalEmail: isIndividual ? '' : String(u?.principalsEmail ?? ''),
            participants,
        }
        rows.push(row)

        const agg = eventAgg.get(row.eventId)
        if (agg) {
            agg.registrationCount += 1
            agg.participantCount += participants.length
            if (isIndividual) agg.individualCount += 1
            else agg.schoolCount += 1
        }

        if (!isIndividual) {
            const key = groupKey(schoolName, schoolCode)
            const s = schoolAgg.get(key) ?? {
                name: schoolName || 'Unnamed school',
                code: schoolCode,
                registrationCount: 0,
                participantCount: 0,
                eventCount: 0,
                eventIds: [],
            }
            s.registrationCount += 1
            s.participantCount += participants.length
            if (!s.eventIds.includes(row.eventId)) {
                s.eventIds.push(row.eventId)
                s.eventCount += 1
            }
            schoolAgg.set(key, s)
        }
    }

    const events = [...eventAgg.values()].sort((a, b) => b.participantCount - a.participantCount || a.name.localeCompare(b.name))
    const schools = [...schoolAgg.values()].sort((a, b) => b.participantCount - a.participantCount || a.name.localeCompare(b.name))
    const rowsSorted = rows.slice().sort((a, b) => {
        const ea = eventById.get(a.eventId)?.name ?? a.eventId
        const eb = eventById.get(b.eventId)?.name ?? b.eventId
        if (ea !== eb) return ea.localeCompare(eb)
        return (a.schoolName || a.accountName).localeCompare(b.schoolName || b.accountName)
    })

    const payload: RegsPayload = {
        generatedAt: new Date().toISOString(),
        totals: {
            registrations: rows.length,
            participants: rows.reduce((n, r) => n + r.participants.length, 0),
            schools: schools.length,
            individuals: rows.filter((r) => r.kind === 'individual').length,
            events: eventRows.length,
        },
        events,
        rows: rowsSorted,
        schools,
    }

    return jsonOk(c, payload, 'Registration overview')
}
