import { describe, expect, it, vi } from 'vitest'

vi.mock('marked', () => ({
  marked: {
    parse: (str: string) => `<p>${str}</p>`,
  },
}))

import { buildJourneyBookDocument } from './buildJourneyBookDocument'
import type { JourneyDetail } from '../../../store/journeyStore'

function buildJourney(overrides: Partial<JourneyDetail> = {}): JourneyDetail {
  return {
    id: 1,
    user_id: 1,
    title: 'Iceland Ring Road',
    subtitle: null,
    status: 'active',
    cover_image: null,
    cover_gradient: null,
    created_at: 1,
    updated_at: 1,
    entries: [
      {
        id: 10,
        journey_id: 1,
        author_id: 1,
        type: 'entry',
        title: 'Golden Circle',
        story: 'An incredible day.',
        entry_date: '2026-07-01',
        visibility: 'private',
        sort_order: 0,
        photos: [{ id: 100, entry_id: 10, photo_id: 42, shared: 0, sort_order: 0, created_at: 1 }],
        created_at: 1,
        updated_at: 1,
      },
    ],
    gallery: [],
    trips: [],
    contributors: [],
    stats: { entries: 1, photos: 1, places: 1 },
    ...overrides,
  } as JourneyDetail
}

describe('buildJourneyBookDocument', () => {
  it('builds a complete document and estimates cover, entry, and closing pages', () => {
    const result = buildJourneyBookDocument(buildJourney())

    expect(result.html).toContain('<!DOCTYPE html>')
    expect(result.html).toContain('Iceland Ring Road')
    expect(result.html).toContain('Golden Circle')
    expect(result.html).toContain('/api/photos/42/original')
    expect(result.estimatedPageCount).toBe(3)
  })

  it('does not render skeleton entries', () => {
    const journey = buildJourney({
      entries: [
        ...buildJourney().entries,
        {
          id: 11,
          journey_id: 1,
          author_id: 1,
          type: 'skeleton',
          title: 'Not published',
          entry_date: '2026-07-02',
          visibility: 'private',
          sort_order: 1,
          photos: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    })

    const result = buildJourneyBookDocument(journey)

    expect(result.html).not.toContain('Not published')
    expect(result.estimatedPageCount).toBe(3)
  })

  it('uses supplied translations and does not require an external font', () => {
    const result = buildJourneyBookDocument(buildJourney(), {
      locale: 'de-DE',
      t: (key) => ({
        'journey.pdf.journeyBook': 'Reisebuch',
        'journey.pdf.madeWith': 'Erstellt mit TREK',
        'journey.pdf.day': 'Tag',
        'journey.pdf.theEnd': 'Ende',
        'journey.stats.days': 'Tage',
        'journey.stats.entries': 'Einträge',
        'journey.stats.photos': 'Fotos',
      })[key] || key,
    })

    expect(result.html).toContain('Reisebuch')
    expect(result.html).toContain('Tag 1')
    expect(result.html).toContain('Erstellt mit TREK')
    expect(result.html).not.toContain('fonts.googleapis.com')
  })

  it('lays multiple photos out in justified rows (no fixed-crop grid)', () => {
    const journey = buildJourney()
    journey.entries[0].photos = [
      { id: 100, entry_id: 10, photo_id: 1, shared: 0, sort_order: 0, created_at: 1, width: 1600, height: 900 },
      { id: 101, entry_id: 10, photo_id: 2, shared: 0, sort_order: 1, created_at: 1, width: 900, height: 1600 },
      { id: 102, entry_id: 10, photo_id: 3, shared: 0, sort_order: 2, created_at: 1, width: 1200, height: 1200 },
    ] as JourneyDetail['entries'][number]['photos']

    const html = buildJourneyBookDocument(journey).html

    expect(html).toContain('class="pg-row"')
    expect(html).toContain('pg-cell')
    // Each cell's flex-basis equals the photo's own aspect ratio, so the cell
    // box matches the image and object-fit:cover never has to crop.
    expect(html).toContain('style="flex:')
    expect(html).toContain(' 1 0"')
  })

  it('renders videos from a lightweight thumbnail poster with a play badge', () => {
    const journey = buildJourney()
    journey.entries[0].photos = [
      { id: 200, entry_id: 10, photo_id: 7, shared: 0, sort_order: 0, created_at: 1, width: 1600, height: 900, media_type: 'video' },
    ] as JourneyDetail['entries'][number]['photos']

    const html = buildJourneyBookDocument(journey).html

    expect(html).toContain('/api/photos/7/thumbnail')
    expect(html).not.toContain('/api/photos/7/original')
    expect(html).toContain('pg-play')
  })

  it('shows a single photo whole (contained, never cropped)', () => {
    const html = buildJourneyBookDocument(buildJourney()).html
    expect(html).toContain('pg-single')
  })

  it('renders mood and weather chips with emoji + readable labels', () => {
    const journey = buildJourney()
    journey.entries[0].mood = 'amazing'
    journey.entries[0].weather = 'sunny'

    const html = buildJourneyBookDocument(journey).html

    expect(html).toContain('entry-chips')
    expect(html).toContain('Amazing')
    expect(html).toContain('Sunny')
  })

  it('renders pros/cons verdict cards when present', () => {
    const journey = buildJourney()
    journey.entries[0].pros_cons = { pros: ['Amazing views'], cons: ['Crowded'] }

    const html = buildJourneyBookDocument(journey).html

    expect(html).toContain('verdict-wrap')
    expect(html).toContain('Amazing views')
    expect(html).toContain('Crowded')
  })

  it('gives photo-less entries a text-focus layout', () => {
    const journey = buildJourney()
    journey.entries[0].photos = []

    const html = buildJourneyBookDocument(journey).html

    expect(html).toContain('entry-page--text-focus')
  })

  it('scales the cover title down for long titles so it fits the cover', () => {
    const short = buildJourneyBookDocument(buildJourney({ title: 'Iceland' })).html
    const long = buildJourneyBookDocument(
      buildJourney({ title: 'A Very Long Journey Across the Whole of Northern Europe' }),
    ).html

    expect(short).toContain('font-size:56pt')
    expect(long).toContain('font-size:24pt')
  })

  it('defaults to A4 paged mode and exposes toggle body-class hooks', () => {
    const result = buildJourneyBookDocument(buildJourney())

    // Paged A4 is the reliable default; continuous is opt-in.
    expect(result.settings.continuous).toBe(false)
    expect(result.html).not.toContain('class="continuous"')
    // Body-class hooks the preview toggles flip live.
    expect(result.html).toContain('body.hide-cover-title')
    expect(result.html).toContain('body.hide-cover-stats')
    expect(result.html).toContain('body.hide-cover-branding')
    expect(result.html).toContain('body.light-cover-dim')
    expect(result.html).toContain('body.hide-proscons')
    expect(result.html).toContain('body.hide-moodweather')
  })

  it('enables continuous mode only when requested via settings', () => {
    const result = buildJourneyBookDocument(buildJourney(), { settings: { continuous: true } })

    expect(result.settings.continuous).toBe(true)
    expect(result.html).toContain('class="continuous"')
  })

  it('maps hide settings onto body classes the export config controls', () => {
    const result = buildJourneyBookDocument(buildJourney(), {
      settings: { showBranding: false, showProsCons: false, showMoodWeather: false },
    })

    expect(result.html).toContain('hide-cover-branding')
    expect(result.html).toContain('hide-proscons')
    expect(result.html).toContain('hide-moodweather')
  })
})
