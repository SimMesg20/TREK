// Journey Book document renderer. Keeping this pure makes layout rules
// independently testable and lets the preview UI evolve without changing print
// output. Photos are laid out in justified rows (no cropping), the cover title
// scales to fit, photo-less entries use a text-focus layout, and mood/weather
// chips mirror the on-screen journal. Toggle-driven visibility is expressed as
// body-class hooks so the preview can flip options live without re-rendering.
import { marked } from 'marked'
import { sanitizeRichTextHtml } from '@trek/shared'
import type { JourneyDetail, JourneyEntry, JourneyPhoto } from '../../../store/journeyStore'

export interface JourneyBookDocument {
  html: string
  estimatedPageCount: number
}

export interface JourneyBookRenderOptions {
  locale?: string
  t?: (key: string) => string
}

interface JourneyBookLabels {
  journeyBook: string
  madeWith: string
  day: string
  theEnd: string
  days: string
  entries: string
  photos: string
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

function pSrc(p: JourneyPhoto): string {
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

function renderProscons(entry: JourneyEntry): string {
  const pc = entry.pros_cons
  if (!pc) return ''
  const pros = pc.pros?.filter(p => p.trim()) || []
  const cons = pc.cons?.filter(c => c.trim()) || []
  if (pros.length === 0 && cons.length === 0) return ''

  return `<div class="verdict-wrap"><div class="verdict-row">
    ${pros.length > 0 ? `<div class="verdict-card pros"><div class="verdict-label">Loved it</div><ul>${pros.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${cons.length > 0 ? `<div class="verdict-card cons"><div class="verdict-label">Could be better</div><ul>${cons.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
  </div></div>`
}

// Mood / weather chip metadata (emoji + label), mirroring the app's MoodChip /
// WeatherChip so the book reads the same as the on-screen journal. Emoji are
// used instead of the app's icon font so the PDF stays self-contained.
const MOOD_META: Record<string, { emoji: string; label: string }> = {
  amazing: { emoji: '😄', label: 'Amazing' },
  good: { emoji: '🙂', label: 'Good' },
  neutral: { emoji: '😐', label: 'Neutral' },
  rough: { emoji: '🙁', label: 'Rough' },
}
const WEATHER_META: Record<string, { emoji: string; label: string }> = {
  sunny: { emoji: '☀️', label: 'Sunny' },
  partly: { emoji: '🌤️', label: 'Partly cloudy' },
  cloudy: { emoji: '☁️', label: 'Cloudy' },
  rainy: { emoji: '🌧️', label: 'Rainy' },
  stormy: { emoji: '⛈️', label: 'Stormy' },
  cold: { emoji: '❄️', label: 'Cold' },
}

function renderMoodWeather(entry: JourneyEntry): string {
  const mood = entry.mood ? MOOD_META[entry.mood] : null
  const weather = entry.weather ? WEATHER_META[entry.weather] : null
  if (!mood && !weather) return ''
  const chips = [
    mood ? `<span class="entry-chip entry-chip-mood">${mood.emoji} ${esc(mood.label)}</span>` : '',
    weather ? `<span class="entry-chip entry-chip-weather">${weather.emoji} ${esc(weather.label)}</span>` : '',
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

// Split photos into balanced rows of ~3, keeping row sizes within one of each
// other so there's never a lonely trailing photo stretched across a full row.
function balancedRows(photos: JourneyPhoto[], cols = 3): JourneyPhoto[][] {
  const rowCount = Math.ceil(photos.length / cols)
  const base = Math.floor(photos.length / rowCount)
  let rem = photos.length % rowCount
  const rows: JourneyPhoto[][] = []
  let i = 0
  for (let r = 0; r < rowCount; r++) {
    const size = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem--
    rows.push(photos.slice(i, i + size))
    i += size
  }
  return rows
}

function renderPhotoBlock(photos: JourneyPhoto[]): string {
  if (photos.length === 0) return ''

  if (photos.length === 1) {
    // A single hero photo is shown whole (never cropped), sized to its own
    // aspect ratio and centred.
    return `<div class="entry-photos"><figure class="pg-single"><img src="${pSrc(photos[0])}" /></figure></div>`
  }

  // Justified rows (Flickr / Google-Photos style): each photo keeps its own
  // aspect ratio, widths within a row scale to fill the page width, and every
  // photo in a row shares one height. Nothing is cropped and there are no grey
  // mattes, while many-photo entries stay a comfortable size instead of
  // shrinking into a tiny uniform grid.
  const CONTENT_W = 745 // A4 landscape width (841.89pt) minus 48pt padding each side
  const GAP = 6
  const MAX_H = 300
  const MIN_H = 150

  const rowsHtml = balancedRows(photos).map(row => {
    const arSum = row.reduce((s, p) => s + photoAR(p), 0)
    let h = (CONTENT_W - GAP * (row.length - 1)) / arSum
    h = Math.min(MAX_H, Math.max(MIN_H, h))
    const cells = row.map(p =>
      `<div class="pg-cell" style="flex-grow:${photoAR(p).toFixed(4)}"><img src="${pSrc(p)}" /></div>`
    ).join('')
    return `<div class="pg-row" style="height:${h.toFixed(1)}pt">${cells}</div>`
  }).join('')

  return `<div class="entry-photos entry-photos-grid">${rowsHtml}</div>`
}

export function buildJourneyBookDocument(journey: JourneyDetail, options: JourneyBookRenderOptions = {}): JourneyBookDocument {
  const labels = labelsFor(options)
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
      const prosconsHtml = renderProscons(entry)
      const moodWeatherHtml = renderMoodWeather(entry)
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
    width: 100%; height: 100vh; position: relative; overflow: hidden;
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
    width: 100%; height: 100vh; padding: 48pt 64pt; display: flex; flex-direction: column;
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
  .entry-page {
    width: 100%; min-height: 100vh; padding: 44pt 48pt;
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
  .pg-cell { flex-basis: 0; min-width: 0; border-radius: 0; overflow: hidden; background: #f4f4f5; }
  .entry-photos-grid .pg-row:first-child .pg-cell:first-child { border-top-left-radius: 10pt; }
  .entry-photos-grid .pg-row:first-child .pg-cell:last-child { border-top-right-radius: 10pt; }
  .entry-photos-grid .pg-row:last-child .pg-cell:first-child { border-bottom-left-radius: 10pt; }
  .entry-photos-grid .pg-row:last-child .pg-cell:last-child { border-bottom-right-radius: 10pt; }
  .pg-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pg-single { display: flex; justify-content: center; align-items: flex-start; }
  .pg-single img { max-width: 100%; max-height: 320pt; width: auto; height: auto; object-fit: contain; border-radius: 8pt; display: block; }

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
    width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center;
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
<body class="continuous">

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

  return { html, estimatedPageCount }
}
