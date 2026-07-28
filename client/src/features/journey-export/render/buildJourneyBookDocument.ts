// Journey Book document renderer. Keeping this pure makes layout rules
// independently testable and lets the preview UI evolve without changing print
// output. Photos are laid out in justified rows (no cropping), the cover title
// scales to fit, photo-less entries use a text-focus layout, and mood/weather
// chips mirror the on-screen journal. Toggle-driven visibility is expressed as
// body-class hooks so the preview can flip options live without re-rendering.
import { marked } from 'marked'
import { sanitizeRichTextHtml } from '@trek/shared'
import type { JourneyDetail, JourneyEntry, JourneyPhoto } from '../../../store/journeyStore'

// Typed export configuration. This is the single source of truth for what the
// book shows; the preview toggles and the upcoming Export Designer both drive
// (and can persist) this object, and the renderer turns it into the initial
// document state — options never have to reach in and mutate iframe CSS blind.
export interface JourneyExportSettings {
  /** One long content-sized page (screen scroll) vs. real A4 paged output. */
  continuous: boolean
  /** Cover title, subtitle and the Days / Entries / Photos stat tiles. */
  showCoverInfo: boolean
  /** "Journey Book" label + "Made with TREK" footer. */
  showBranding: boolean
  /** Dark cover overlay (keeps text readable) vs. a lighter overlay. */
  dimCover: boolean
  /** Pros / cons verdict cards. */
  showProsCons: boolean
  /** Mood / weather chips. */
  showMoodWeather: boolean
}

// A4 paged is the default: it is print-ready and stable across print engines.
// Continuous is an explicit opt-in for on-screen reading.
export const DEFAULT_EXPORT_SETTINGS: JourneyExportSettings = {
  continuous: false,
  showCoverInfo: true,
  showBranding: true,
  dimCover: true,
  showProsCons: true,
  showMoodWeather: true,
}

export interface JourneyBookDocument {
  html: string
  estimatedPageCount: number
  /** The resolved settings the document was built with. */
  settings: JourneyExportSettings
}

export interface JourneyBookRenderOptions {
  locale?: string
  t?: (key: string) => string
  /** Partial overrides merged over DEFAULT_EXPORT_SETTINGS. */
  settings?: Partial<JourneyExportSettings>
}

interface JourneyBookLabels {
  journeyBook: string
  madeWith: string
  day: string
  theEnd: string
  days: string
  entries: string
  photos: string
  lovedIt: string
  couldBeBetter: string
}

// Body classes the preview toggles flip live; the renderer sets the initial set
// from the export settings so the first paint already matches the config.
function bodyClassesFor(s: JourneyExportSettings): string {
  const classes: string[] = []
  if (s.continuous) classes.push('continuous')
  if (!s.showCoverInfo) classes.push('hide-cover-title', 'hide-cover-stats')
  if (!s.showBranding) classes.push('hide-cover-branding')
  if (!s.dimCover) classes.push('light-cover-dim')
  if (!s.showProsCons) classes.push('hide-proscons')
  if (!s.showMoodWeather) classes.push('hide-moodweather')
  return classes.join(' ')
}

function translate(t: JourneyBookRenderOptions['t'], key: string, fallback: string): string {
  const translated = t?.(key)
  return translated && translated !== key ? translated : fallback
}

function labelsFor(options: JourneyBookRenderOptions): JourneyBookLabels {
  return {
    journeyBook: translate(options.t, 'journey.pdf.journeyBook', 'Journey Book'),
    madeWith: translate(options.t, 'journey.pdf.madeWith', 'Made with TREK'),
    day: translate(options.t, 'journey.pdf.day', 'Day'),
    theEnd: translate(options.t, 'journey.pdf.theEnd', 'The End'),
    days: translate(options.t, 'journey.stats.days', 'Days'),
    entries: translate(options.t, 'journey.stats.entries', 'Entries'),
    photos: translate(options.t, 'journey.stats.photos', 'Photos'),
    lovedIt: translate(options.t, 'journey.pdf.lovedIt', 'Loved it'),
    couldBeBetter: translate(options.t, 'journey.pdf.couldBeBetter', 'Could be better'),
  }
}

function esc(str: string | null | undefined): string {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function md(str: string | null | undefined): string {
  if (!str) return ''
  // marked passes embedded raw HTML through by default, so sanitise the result
  // before it goes into the srcdoc iframe (keeps prose markup, drops scripts).
  return sanitizeRichTextHtml(marked.parse(str, { async: false, breaks: true }) as string)
}

function abs(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  return window.location.origin + (url.startsWith('/') ? '' : '/') + url
}

function isVideo(p: JourneyPhoto): boolean {
  return p.media_type === 'video'
}

function pSrc(p: JourneyPhoto): string {
  // Videos can't be embedded in a print document, and their originals are huge,
  // so use the lightweight poster/thumbnail. Images keep the full-resolution
  // original so the print stays sharp.
  if (isVideo(p)) return abs(`/api/photos/${p.photo_id}/thumbnail`)
  return abs(`/api/photos/${p.photo_id}/original`)
}

function fmtDate(d: string, locale?: string): string {
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function groupByDate(entries: JourneyEntry[]): Map<string, JourneyEntry[]> {
  const groups = new Map<string, JourneyEntry[]>()
  for (const e of entries) {
    if (!e.entry_date) continue
    if (!groups.has(e.entry_date)) groups.set(e.entry_date, [])
    groups.get(e.entry_date)!.push(e)
  }
  return groups
}

function renderProscons(entry: JourneyEntry, labels: JourneyBookLabels): string {
  const pc = entry.pros_cons
  if (!pc) return ''
  const pros = pc.pros?.filter(p => p.trim()) || []
  const cons = pc.cons?.filter(c => c.trim()) || []
  if (pros.length === 0 && cons.length === 0) return ''

  return `<div class="verdict-wrap"><div class="verdict-row">
    ${pros.length > 0 ? `<div class="verdict-card pros"><div class="verdict-label">${esc(labels.lovedIt)}</div><ul>${pros.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${cons.length > 0 ? `<div class="verdict-card cons"><div class="verdict-label">${esc(labels.couldBeBetter)}</div><ul>${cons.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
  </div></div>`
}

// Mood / weather chip emoji, keyed by the same ids the app uses. The visible
// label is resolved through the translation catalog (journey.mood.* /
// journey.weather.*) so the book follows the reader's language; the emoji keeps
// the PDF self-contained (no icon font needed).
const MOOD_EMOJI: Record<string, string> = { amazing: '😄', good: '🙂', neutral: '😐', rough: '🙁' }
const MOOD_FALLBACK: Record<string, string> = { amazing: 'Amazing', good: 'Good', neutral: 'Neutral', rough: 'Rough' }
const WEATHER_EMOJI: Record<string, string> = { sunny: '☀️', partly: '🌤️', cloudy: '☁️', rainy: '🌧️', stormy: '⛈️', cold: '❄️' }
const WEATHER_FALLBACK: Record<string, string> = { sunny: 'Sunny', partly: 'Partly cloudy', cloudy: 'Cloudy', rainy: 'Rainy', stormy: 'Stormy', cold: 'Cold' }

function renderMoodWeather(entry: JourneyEntry, t: JourneyBookRenderOptions['t']): string {
  const moodId = entry.mood && MOOD_EMOJI[entry.mood] ? entry.mood : null
  const weatherId = entry.weather && WEATHER_EMOJI[entry.weather] ? entry.weather : null
  if (!moodId && !weatherId) return ''
  const chips = [
    moodId ? `<span class="entry-chip entry-chip-mood">${MOOD_EMOJI[moodId]} ${esc(translate(t, `journey.mood.${moodId}`, MOOD_FALLBACK[moodId]))}</span>` : '',
    weatherId ? `<span class="entry-chip entry-chip-weather">${WEATHER_EMOJI[weatherId]} ${esc(translate(t, `journey.weather.${weatherId}`, WEATHER_FALLBACK[weatherId]))}</span>` : '',
  ].join('')
  return `<div class="entry-chips">${chips}</div>`
}

// Scale the cover title down as it gets longer so it always fits on the cover
// and never collides with the edges. Short titles keep the big display size;
// long / multi-word titles step down gracefully instead of overflowing.
function coverTitleSize(title: string): number {
  const len = (title || '').length
  if (len <= 16) return 56
  if (len <= 24) return 46
  if (len <= 34) return 38
  if (len <= 48) return 30
  return 24
}

// Aspect ratio (w/h) of a photo, clamped so a single panorama or a tall strip
// can't dominate a justified row. Falls back to a gentle landscape default when
// the dimensions aren't known.
function photoAR(p: JourneyPhoto): number {
  const w = Number(p.width) || 0
  const h = Number(p.height) || 0
  if (w > 0 && h > 0) return Math.min(2.5, Math.max(0.5, w / h))
  return 1.5
}

// A small play badge overlaid on video posters so a still frame still reads as
// a video in the printed book.
function videoBadge(p: JourneyPhoto): string {
  return isVideo(p) ? '<span class="pg-play" aria-hidden="true"></span>' : ''
}

function renderPhotoBlock(photos: JourneyPhoto[]): string {
  if (photos.length === 0) return ''

  if (photos.length === 1) {
    // A single hero photo is shown whole (never cropped), sized to its own
    // aspect ratio and centred.
    const p = photos[0]
    return `<div class="entry-photos"><figure class="pg-single">${videoBadge(p)}<img src="${pSrc(p)}" /></figure></div>`
  }

  // Geometry-safe justified rows: pick how many photos share a row so the row's
  // natural full-width height lands near a target, then fill the width by
  // aspect ratio. Each cell's box then has exactly its photo's aspect ratio, so
  // object-fit: cover fills it WITHOUT cropping — and a stretched row's height
  // is never clamped (clamping the height while cells still fill the width was
  // what reintroduced cropping for panorama/portrait mixes). The final leftover
  // row that can't reach the target height is shown at the target height with
  // natural (aspect-correct) widths, left-aligned, so it stays crop-free too.
  const CONTENT_W = 745 // A4 landscape width (841.89pt) minus 48pt padding each side
  const GAP = 6
  const TARGET_H = 235

  const rows: { photos: JourneyPhoto[]; filled: boolean }[] = []
  let cur: JourneyPhoto[] = []
  for (const p of photos) {
    cur.push(p)
    const arSum = cur.reduce((s, x) => s + photoAR(x), 0)
    const h = (CONTENT_W - GAP * (cur.length - 1)) / arSum
    if (h <= TARGET_H) { rows.push({ photos: cur, filled: true }); cur = [] }
  }
  if (cur.length) rows.push({ photos: cur, filled: false })

  const rowsHtml = rows.map(({ photos: row, filled }) => {
    const arSum = row.reduce((s, p) => s + photoAR(p), 0)
    if (filled) {
      const h = (CONTENT_W - GAP * (row.length - 1)) / arSum
      const cells = row.map(p =>
        `<div class="pg-cell" style="flex:${photoAR(p).toFixed(4)} 1 0">${videoBadge(p)}<img src="${pSrc(p)}" /></div>`
      ).join('')
      return `<div class="pg-row" style="height:${h.toFixed(1)}pt">${cells}</div>`
    }
    const cells = row.map(p =>
      `<div class="pg-cell" style="flex:none;width:${(TARGET_H * photoAR(p)).toFixed(1)}pt">${videoBadge(p)}<img src="${pSrc(p)}" /></div>`
    ).join('')
    return `<div class="pg-row pg-row-fit" style="height:${TARGET_H}pt">${cells}</div>`
  }).join('')

  return `<div class="entry-photos entry-photos-grid">${rowsHtml}</div>`
}

export function buildJourneyBookDocument(journey: JourneyDetail, options: JourneyBookRenderOptions = {}): JourneyBookDocument {
  const labels = labelsFor(options)
  const settings: JourneyExportSettings = { ...DEFAULT_EXPORT_SETTINGS, ...options.settings }
  const bodyClass = bodyClassesFor(settings)
  const entries = (journey.entries || []).filter(e => e.type !== 'skeleton')
  const allPhotos = entries.flatMap(e => e.photos || [])
  const coverUrl = journey.cover_image ? abs(`/uploads/${journey.cover_image}`) : (allPhotos[0] ? pSrc(allPhotos[0]) : '')

  const grouped = groupByDate(entries)
  const dates = [...grouped.keys()].sort()

  // Build entry pages — one per entry, day header inline on first entry of day
  const entryPages: string[] = []
  let pageNum = 1 // cover=1
  dates.forEach((date, di) => {
    const dayEntries = grouped.get(date)!
    dayEntries.forEach((entry, ei) => {
      pageNum++
      const isFirstOfDay = ei === 0
      const photos = entry.photos || []
      const meta = [entry.entry_time, entry.location_name].filter(Boolean).join(' · ')

      // Day header (inline, only on first entry of day)
      const dayHeaderHtml = isFirstOfDay
        ? `<div class="day-header">${esc(labels.day)} ${di + 1} · ${fmtDate(date, options.locale)}</div>`
        : ''

      const photoHtml = renderPhotoBlock(photos)
      const prosconsHtml = renderProscons(entry, labels)
      const moodWeatherHtml = renderMoodWeather(entry, options.t)
      const storyHtml = entry.story ? `<div class="entry-story">${md(entry.story)}</div>` : ''

      // Photo-less entries use a text-focus layout (larger type, centred
      // readable column) so a text-only page reads as intentional instead of a
      // small block stranded at the top of an otherwise-empty page.
      const textFocus = photos.length === 0 ? ' entry-page--text-focus' : ''

      entryPages.push(`
        <div class="entry-page${textFocus}">
          ${dayHeaderHtml}
          ${photoHtml}
          <div class="entry-content">
            ${meta ? `<div class="entry-meta">${esc(meta)}</div>` : ''}
            ${entry.title ? `<h2 class="entry-title">${esc(entry.title)}</h2>` : ''}
            ${moodWeatherHtml}
            ${storyHtml}
            ${prosconsHtml}
          </div>
        </div>
      `)
    })
  })

  const estimatedPageCount = pageNum + 1 // +1 for closing page

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<base href="${window.location.origin}/">
<title>${esc(journey.title)} — ${esc(labels.journeyBook)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1A1A1A; font-size: 11pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* margin:0 on every printed page: with no page margin the browser's print
     engine has no room to draw its own header/footer (date, document title,
     URL, page numbers), so the exported PDF stays clean. The per-page inset is
     supplied by .entry-page padding instead, and box-decoration-break:clone
     (below) repeats that padding on continuation sheets. */
  @page { size: A4 landscape; margin: 0; }

  /* ── Cover ─── */
  .cover-page {
    width: 100%; height: 210mm; position: relative; overflow: hidden;
    background: #0a0a0f; color: white; display: flex; align-items: center; justify-content: center;
    page-break-after: always;
  }
  .cover-bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .cover-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .cover-mesh { position: absolute; inset: 0; background: radial-gradient(circle at 20% 30%, rgba(99,102,241,0.2), transparent 50%), radial-gradient(circle at 80% 70%, rgba(236,72,153,0.15), transparent 50%); }
  .cover-content { position: relative; z-index: 2; text-align: center; padding: 60pt; }
  .cover-label { font-size: 9pt; font-weight: 700; letter-spacing: 6pt; text-transform: uppercase; opacity: 0.35; margin-bottom: 24pt; }
  .cover-content h1 { font-size: 56pt; font-weight: 800; letter-spacing: -0.03em; line-height: 0.9; margin-bottom: 10pt; overflow-wrap: anywhere; hyphens: auto; max-width: 640pt; margin-left: auto; margin-right: auto; }
  .cover-content .sub { font-size: 14pt; font-weight: 400; opacity: 0.7; margin-bottom: 36pt; }
  .cover-stats { display: flex; gap: 48pt; justify-content: center; }
  .cover-stat-val { font-size: 32pt; font-weight: 800; letter-spacing: -0.02em; }
  .cover-stat-label { font-size: 10pt; text-transform: uppercase; letter-spacing: 2pt; opacity: 0.4; margin-top: 3pt; }
  .cover-footer { position: absolute; bottom: 20pt; left: 0; right: 0; text-align: center; font-size: 9pt; opacity: 0.2; letter-spacing: 3pt; text-transform: uppercase; }

  /* ── TOC ─── */
  .toc-page {
    width: 100%; height: 210mm; padding: 48pt 64pt; display: flex; flex-direction: column;
    background: white; page-break-after: always;
  }
  .toc-top-label { font-size: 9pt; font-weight: 700; letter-spacing: 5pt; text-transform: uppercase; color: #94a3b8; margin-bottom: 16pt; }
  .toc-title-block h2 { font-size: 36pt; font-weight: 800; letter-spacing: -1pt; color: #0a0a0f; margin-bottom: 4pt; }
  .toc-title-block .sub { font-size: 13pt; color: #71717a; margin-bottom: 24pt; }
  .toc-divider { height: 1pt; background: #e4e4e7; margin: 16pt 0; }
  .toc-body { flex: 1; columns: 2; column-gap: 40pt; }
  .toc-day { break-inside: avoid; margin-bottom: 14pt; }
  .toc-day-label { font-size: 9pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #71717a; margin-bottom: 4pt; }
  .toc-entry { display: flex; align-items: baseline; gap: 4pt; font-size: 11pt; color: #3f3f46; margin-bottom: 2pt; }
  .toc-entry .toc-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200pt; }
  .toc-entry .toc-dots { flex: 1; border-bottom: 1pt dotted #d4d4d8; margin: 0 4pt; min-width: 20pt; }
  .toc-entry .toc-page { font-size: 10pt; color: #a1a1aa; font-weight: 500; flex-shrink: 0; }
  .toc-stats { display: flex; gap: 32pt; margin-top: auto; padding-top: 16pt; border-top: 1pt solid #e4e4e7; }
  .toc-stat-val { font-size: 18pt; font-weight: 800; color: #0a0a0f; }
  .toc-stat-label { font-size: 9pt; text-transform: uppercase; letter-spacing: 1pt; color: #94a3b8; }

  /* ── Entry Page ─── */
  /* Sized in physical A4-landscape units (210mm tall) rather than viewport
     units: 100vh depends on the print viewport and is unreliable across print
     engines, whereas mm map directly to the paper. */
  .entry-page {
    width: 100%; min-height: 210mm; padding: 44pt 48pt;
    page-break-after: always;
    /* clone the padding onto every page fragment, so when an entry flows onto a
       second sheet the continuation is inset from the paper edge instead of
       sitting flush at the top. */
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
    display: flex; flex-direction: column;
  }

  /* Day header — inline */
  .day-header {
    font-size: 9pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
    color: #71717a; text-align: center; margin-bottom: 16pt; position: relative;
    display: flex; align-items: center; gap: 12pt;
  }
  .day-header::before, .day-header::after { content: ''; flex: 1; height: 0.5pt; background: #d4d4d8; }

  /* Photos — justified rows. Each row is a flex line whose cells grow in
     proportion to their photo's aspect ratio, so widths fill the page and all
     cells in a row share one height. Cells match their photo's aspect ratio,
     so object-fit: cover fills the cell without cropping — no grey mattes. */
  .entry-photos { flex: 0 0 auto; margin-bottom: 16pt; }
  .entry-photos-grid { display: flex; flex-direction: column; gap: 6pt; }
  .pg-row { display: flex; gap: 6pt; break-inside: avoid; }
  /* Cells are square by default; only the four OUTER corners of the whole
     photo block are rounded (inner corners stay 90deg), matching the TREK
     gallery look. */
  .pg-cell { position: relative; flex-basis: 0; min-width: 0; border-radius: 0; overflow: hidden; background: #f4f4f5; }
  .pg-row-fit { justify-content: flex-start; }
  .entry-photos-grid .pg-row:first-child .pg-cell:first-child { border-top-left-radius: 10pt; }
  .entry-photos-grid .pg-row:first-child .pg-cell:last-child { border-top-right-radius: 10pt; }
  .entry-photos-grid .pg-row:last-child .pg-cell:first-child { border-bottom-left-radius: 10pt; }
  .entry-photos-grid .pg-row:last-child .pg-cell:last-child { border-bottom-right-radius: 10pt; }
  .pg-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pg-single { position: relative; display: flex; justify-content: center; align-items: flex-start; }
  .pg-single img { max-width: 100%; max-height: 320pt; width: auto; height: auto; object-fit: contain; border-radius: 8pt; display: block; }
  /* Play badge for video posters (a still frame stands in for the clip). */
  .pg-play { position: absolute; top: 50%; left: 50%; width: 34pt; height: 34pt; transform: translate(-50%, -50%); border-radius: 50%; background: rgba(0,0,0,0.55); z-index: 1; }
  .pg-play::before { content: ''; position: absolute; top: 50%; left: 54%; transform: translate(-50%, -50%); border-style: solid; border-width: 8pt 0 8pt 13pt; border-color: transparent transparent transparent #fff; }

  /* Entry content */
  .entry-content { flex: 0 0 auto; }
  .entry-meta { font-size: 10pt; letter-spacing: 0.04em; text-transform: uppercase; color: #71717a; font-weight: 500; margin-bottom: 6pt; }
  h2.entry-title { font-size: 28pt; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 10pt; color: #0a0a0f; }
  .entry-story { font-size: 11pt; line-height: 1.65; color: #3f3f46; }
  .entry-story p { margin: 0 0 8pt; }
  .entry-story strong { font-weight: 600; color: #0a0a0f; }
  .entry-story em { font-style: italic; }
  .entry-story blockquote { margin: 12pt 0; padding-left: 12pt; border-left: 2pt solid #d4d4d8; font-style: italic; color: #52525b; }
  .entry-story ul, .entry-story ol { margin: 8pt 0; padding-left: 16pt; }
  .entry-story li { margin-bottom: 4pt; }
  .entry-story a { color: #2563eb; text-decoration: none; }

  /* Text-focus entries (no photos): give the writing a larger, centred,
     comfortable measure so a text-only page reads as intentional instead of a
     small block stranded at the top of an empty page. The auto margins also
     centre the content vertically when the page has room (and collapse safely
     to top-aligned when the text is longer than a page, so nothing is clipped);
     .entry-page--text-focus is given a page-filling height in print below. */
  .entry-page--text-focus .entry-content { max-width: 560pt; margin: auto; }
  .entry-page--text-focus h2.entry-title { font-size: 34pt; }
  .entry-page--text-focus .entry-story { font-size: 13.5pt; line-height: 1.85; }

  /* Export options — hide cover elements on demand (driven by the toggles in
     the preview's Options popover). */
  body.hide-cover-title .cover-content h1,
  body.hide-cover-title .cover-content .sub { display: none; }
  body.hide-cover-stats .cover-stats { display: none; }
  body.hide-cover-branding .cover-label,
  body.hide-cover-branding .cover-footer,
  body.hide-cover-branding .closing-sub { display: none; }
  body.light-cover-dim .cover-dim { background: rgba(0,0,0,0.15); }
  body.hide-proscons .verdict-wrap { display: none; }
  body.hide-moodweather .entry-chips { display: none; }

  /* Mood / weather chips */
  .entry-chips { display: flex; flex-wrap: wrap; gap: 6pt; margin: 0 0 10pt; }
  .entry-chip { display: inline-flex; align-items: center; gap: 4pt; padding: 3pt 8pt; border-radius: 999pt; font-size: 9pt; font-weight: 600; }
  .entry-chip-mood { background: #fdf2f8; color: #be185d; }
  .entry-chip-weather { background: #eff6ff; color: #1d4ed8; }

  /* Verdict */
  .verdict-wrap { break-inside: avoid; padding-top: 14pt; }
  .verdict-row { display: flex; gap: 10pt; }
  .verdict-card { flex: 1; padding: 10pt 12pt; border-radius: 6pt; font-size: 9.5pt; }
  .verdict-card.pros { background: #f0fdf4; border: 0.5pt solid #bbf7d0; }
  .verdict-card.cons { background: #fef2f2; border: 0.5pt solid #fecaca; }
  .verdict-label { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6pt; }
  .verdict-card.pros .verdict-label { color: #15803d; }
  .verdict-card.cons .verdict-label { color: #b91c1c; }
  .verdict-card ul { margin: 0; padding: 0; list-style: none; }
  .verdict-card li { padding: 2pt 0; position: relative; padding-left: 10pt; }
  .verdict-card li::before { content: '•'; position: absolute; left: 0; }
  .verdict-card.pros li { color: #14532d; }
  .verdict-card.pros li::before { color: #22c55e; }
  .verdict-card.cons li { color: #7f1d1d; }
  .verdict-card.cons li::before { color: #ef4444; }

  /* ── Closing ─── */
  .closing-page {
    width: 100%; height: 210mm; display: flex; align-items: center; justify-content: center;
    background: #0a0a0f; color: white; text-align: center; page-break-after: auto;
  }
  .closing-title { font-size: 32pt; font-weight: 300; letter-spacing: -1pt; opacity: 0.6; margin-bottom: 8pt; }
  .closing-sub { font-size: 10pt; opacity: 0.25; letter-spacing: 3pt; text-transform: uppercase; }

  /* ── Continuous mode (default) ───
     The whole book becomes one tall page so the exported PDF reads as a smooth
     digital scroll, exactly like the on-screen preview. The print-time @page
     size is set to the measured content height in the preview's save handler.
     Dropping the full-viewport heights and forced page breaks removes the big
     empty gaps between entries. Unchecking the toggle removes this class and
     the book falls back to real A4 pages. */
  body.continuous .cover-page { height: 520pt; }
  body.continuous .closing-page { height: 300pt; }
  body.continuous .cover-page,
  body.continuous .toc-page,
  body.continuous .entry-page,
  body.continuous .closing-page {
    min-height: 0;
    page-break-after: auto;
    break-after: auto;
  }

  /* ── Print ─── */
  @media print {
    .print-bar { display: none !important; }
    body { margin: 0; }
    /* Drop the fixed screen height so entries flow to their natural height and
       split across sheets cleanly; the .entry-page padding (cloned via
       box-decoration-break) supplies the inset on every sheet. */
    .entry-page { orphans: 3; widows: 3; min-height: 0; }
    h2.entry-title { page-break-after: avoid; }
    .verdict-row { page-break-inside: avoid; }
    .verdict-wrap { break-inside: avoid; page-break-before: avoid; }
    .pg-row, .pg-single { break-inside: avoid; }
    /* In paged (A4) mode only, let a text-only entry fill the page so its
       centred content sits in the middle of the sheet instead of stranded at
       the top. 560pt is just under A4-landscape height so it never spills onto
       a blank trailing page. Continuous mode keeps its collapsed heights. */
    body:not(.continuous) .entry-page--text-focus { min-height: 560pt; }
  }

</style>
</head>
<body class="${bodyClass}">

  <!-- Page 1: Cover -->
  <div class="cover-page">
    ${coverUrl ? `<div class="cover-bg" style="background-image:url('${coverUrl}')"></div>` : ''}
    <div class="cover-dim"></div>
    <div class="cover-mesh"></div>
    <div class="cover-content">
      <div class="cover-label">${esc(labels.journeyBook)}</div>
      <h1 style="font-size:${coverTitleSize(journey.title)}pt">${esc(journey.title)}</h1>
      ${journey.subtitle ? `<div class="sub">${esc(journey.subtitle)}</div>` : ''}
      <div class="cover-stats">
        <div><div class="cover-stat-val">${dates.length}</div><div class="cover-stat-label">${esc(labels.days)}</div></div>
        <div><div class="cover-stat-val">${entries.length}</div><div class="cover-stat-label">${esc(labels.entries)}</div></div>
        <div><div class="cover-stat-val">${allPhotos.length}</div><div class="cover-stat-label">${esc(labels.photos)}</div></div>
      </div>
    </div>
    <div class="cover-footer">${esc(labels.madeWith)}</div>
  </div>

  <!-- Entry Pages -->
  ${entryPages.join('\n')}

  <!-- Closing Page -->
  <div class="closing-page">
    <div>
      <div class="closing-title">${esc(labels.theEnd)}</div>
      <div class="closing-sub">${esc(labels.madeWith)} · ${new Date().getFullYear()}</div>
    </div>
  </div>

</body>
</html>`

  return { html, estimatedPageCount, settings }
}
