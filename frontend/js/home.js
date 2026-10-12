class HomePage {
    constructor() {
        this.events = [];
        this.init();
    }

    async init() {
        if (Array.isArray(window.__EVENTS__)) {
            this.events = window.__EVENTS__;
            this.hydrateEvents();
            this.setupEventListeners();
            this.refreshEvents();
            const focusId = new URLSearchParams(window.location.search).get('focus');
            if (focusId) Utils.focusEventCard(focusId);
            return;
        }
        await this.loadEvents();
        this.renderEvents();
        this.setupEventListeners();
        const focusId = new URLSearchParams(window.location.search).get('focus');
        if (focusId) Utils.focusEventCard(focusId);
    }

    hydrateEvents() {
        const grid = document.querySelector('.events-grid');
        if (!grid) return;
        if (grid.querySelector('.event-card')) {
            this.attachCardHandlers(grid);
            return;
        }
        this.renderEvents();
    }

    attachCardHandlers(scope) {
        const cards = (scope || document).querySelectorAll('.event-card[data-event-id]');
        cards.forEach((card) => {
            if (card.dataset.hydrated) return;
            card.dataset.hydrated = '1';
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const id = card.dataset.eventId;
                const name = (this.events.find((v) => String(v.id) === String(id)) || {}).name || id;
                Utils.rememberEventBack(`/?focus=${encodeURIComponent(id)}`);
                window.location.href = `/event/${Utils.slugify(name || id)}`;
            });
        });
    }

    async refreshEvents() {
        try {
            const response = await window.ExunServices.events.getAllEvents();
            const fresh = (response && response.data) || [];
            if (JSON.stringify(fresh.map((v) => v.id)) !== JSON.stringify(this.events.map((v) => v.id))) {
                this.events = fresh;
                this.renderEvents();
            }
        } catch (e) {}
    }

    async loadEvents() {
        try {
            const response = await window.ExunServices.events.getAllEvents();
            this.events = (response && response.data) || [];
        } catch (error) {
            console.error('Failed to load events from API:', error);
            Utils.showToast('Failed to load events', 'error');
        }
    }

    renderEvents() {
        const eventsGrid = document.querySelector('.events-grid');
        if (!eventsGrid) return;
        eventsGrid.innerHTML = '';
        if (this.events.length === 0) {
            eventsGrid.innerHTML = '<div class="no-events">No events published yet.</div>';
            return;
        }
        this.events.forEach(event => {
            eventsGrid.appendChild(this.createEventCard(event));
        });
    }

    createEventCard(event) {
        const card = document.createElement('a');
        card.href = `/event/${Utils.slugify(event.name || event.id)}`;
        card.className = 'event-card';
        card.dataset.eventId = event.id;
        card.addEventListener('click', (e) => {
            e.preventDefault();
            Utils.rememberEventBack(`/?focus=${encodeURIComponent(event.id)}`);
            window.location.href = `/event/${Utils.slugify(event.name || event.id)}`;
        });
        const imageUrl = event.image ? (String(event.image).startsWith('/') ? event.image : `/illustrations/${String(event.image).split('/').pop()}`) : '/assets/exun_base.webp';
        const eligibilityText = Utils.formatEligibility(event.eligibility, event.open_to_all || event.openToAll);
        const participantsText = Utils.formatParticipantsDisplay(event);
        const modeText = Utils.formatEventMode(event.mode);
        card.innerHTML = `
            <img src="${Utils.escapeHtml(imageUrl)}" alt="${Utils.escapeHtml(event.name)}" class="event-card__image" loading="lazy" />
            <h3 class="event-card__title">${Utils.escapeHtml(event.name)}</h3>
            <div class="event-card__pills">
                <span class="event-card__mode">${Utils.escapeHtml(modeText)}</span>
                <span class="event-card__eligibility">${Utils.escapeHtml(eligibilityText)}</span>
            </div>
            <div class="event-card__participants">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2977f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>${Utils.escapeHtml(participantsText)}</span>
            </div>
        `;
        return card;
    }

    setupEventListeners() {
        const exploreBtn = document.querySelector('[data-action="explore-events"]');
        const brochureBtn = document.querySelector('[data-action="view-brochure"]');
        if (exploreBtn) {
            exploreBtn.addEventListener('click', () => {
                window.location.href = '/events';
            });
        }
        if (brochureBtn) {
            brochureBtn.addEventListener('click', () => {
                window.location.href = '/brochure';
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'home') {
        new HomePage();
    }
});
