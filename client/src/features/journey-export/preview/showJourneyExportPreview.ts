import type { JourneyBookDocument } from '../render/buildJourneyBookDocument'

interface JourneyExportPreviewOptions {
  title: string
  document: JourneyBookDocument
  saveLabel?: string
  closeLabel?: string
  pagesLabel?: string
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Shows a print-safe, script-free iframe preview for a prepared export
 * document, with an "Options" popover that toggles layout/cover/content
 * visibility live (driven by body-class hooks in the rendered document) and a
 * Save action that sizes the print @page to the content in continuous mode.
 */
export function showJourneyExportPreview({
  title,
  document: exportDocument,
  saveLabel = 'Save as PDF',
  closeLabel = 'Close',
  pagesLabel = 'pages',
}: JourneyExportPreviewOptions) {
  // Render in a fixed overlay + srcdoc iframe — same pattern as TripPDF.
  // This avoids window.open() which Safari iOS blocks in async callbacks
  // and window.close() which doesn't work reliably in standalone PWA mode.
  const overlay = document.createElement('div')
  overlay.id = 'journey-pdf-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:8px;'

  // Print-bar UI styles, injected into the parent document (removed on close).
  // The export options live in a grouped popover behind an "Options" button so
  // the bar stays clean and works on phones; iOS-style switches replace a
  // plain inline checkbox row.
  const uiStyle = document.createElement('style')
  uiStyle.id = 'journey-pdf-ui-style'
  uiStyle.textContent = `
    #journey-pdf-overlay .jpdf-card { width:100%; max-width:1100px; height:95vh; background:#fff; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.35); position:relative; }
    #journey-pdf-overlay .jpdf-header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; border-bottom:1px solid #1e293b; flex-shrink:0; background:#0f172a; }
    #journey-pdf-overlay .jpdf-title { font-size:12px; color:rgba(255,255,255,0.45); font-weight:500; letter-spacing:0.03em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
    #journey-pdf-overlay .jpdf-actions { display:flex; align-items:center; gap:8px; flex:none; }
    #journey-pdf-overlay .jpdf-btn { min-height:40px; padding:9px 16px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; white-space:nowrap; }
    #journey-pdf-overlay .jpdf-btn-primary { border:none; background:#fff; color:#0f172a; }
    #journey-pdf-overlay .jpdf-btn-ghost { border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.75); }
    #journey-pdf-overlay .jpdf-btn-ghost.is-open { background:rgba(255,255,255,0.22); }
    #journey-pdf-overlay .jpdf-pop { position:absolute; top:54px; right:8px; width:min(320px, calc(100% - 16px)); max-height:calc(100% - 66px); overflow:auto; background:#fff; border:1px solid #e4e4e7; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.28); padding:6px; z-index:5; }
    #journey-pdf-overlay .jpdf-pop[hidden] { display:none; }
    #journey-pdf-overlay .jpdf-group + .jpdf-group { border-top:1px solid #f1f5f9; margin-top:4px; padding-top:4px; }
    #journey-pdf-overlay .jpdf-group-label { font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#94a3b8; padding:8px 8px 4px; }
    #journey-pdf-overlay .jpdf-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 8px; border-radius:8px; font-size:14px; color:#0f172a; cursor:pointer; user-select:none; }
    #journey-pdf-overlay .jpdf-row:hover { background:#f8fafc; }
    #journey-pdf-overlay .jpdf-switch { position:relative; display:inline-block; width:38px; height:22px; flex:none; }
    #journey-pdf-overlay .jpdf-switch input { position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer; }
    #journey-pdf-overlay .jpdf-slider { position:absolute; inset:0; background:#cbd5e1; border-radius:999px; transition:background 0.15s; }
    #journey-pdf-overlay .jpdf-slider::before { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; background:#fff; border-radius:50%; transition:transform 0.15s; box-shadow:0 1px 2px rgba(0,0,0,0.25); }
    #journey-pdf-overlay .jpdf-switch input:checked + .jpdf-slider { background:#22c55e; }
    #journey-pdf-overlay .jpdf-switch input:checked + .jpdf-slider::before { transform:translateX(16px); }
    @media (max-width:560px) {
      #journey-pdf-overlay { padding:0 !important; }
      #journey-pdf-overlay .jpdf-card { height:100vh; height:100dvh; max-width:100%; border-radius:0; }
      #journey-pdf-overlay .jpdf-title { display:none; }
      #journey-pdf-overlay .jpdf-header { justify-content:flex-end; }
      #journey-pdf-overlay .jpdf-btn { min-height:44px; padding:10px 14px; }
      #journey-pdf-overlay .jpdf-pop { top:auto; bottom:0; left:0; right:0; width:100%; max-height:72%; border-radius:16px 16px 0 0; padding:8px 8px calc(8px + env(safe-area-inset-bottom)); }
      #journey-pdf-overlay .jpdf-row { padding:12px 10px; font-size:15px; }
    }
  `
  document.head.appendChild(uiStyle)

  const card = document.createElement('div')
  card.className = 'jpdf-card'

  const optionRow = (id: string, label: string, tip: string, checked = true) => `
      <label class="jpdf-row" title="${tip}">
        <span>${label}</span>
        <span class="jpdf-switch"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} /><span class="jpdf-slider"></span></span>
      </label>`

  const header = document.createElement('div')
  header.className = 'jpdf-header'
  header.innerHTML = `
    <span class="jpdf-title">${esc(title)} &middot; ${exportDocument.estimatedPageCount} ${esc(pagesLabel)}</span>
    <div class="jpdf-actions">
      <button id="journey-pdf-options" class="jpdf-btn jpdf-btn-ghost" aria-haspopup="true" aria-expanded="false">&#9881;&#65039; Options</button>
      <button id="journey-pdf-save" class="jpdf-btn jpdf-btn-primary">${esc(saveLabel)}</button>
      <button id="journey-pdf-close" class="jpdf-btn jpdf-btn-ghost">${esc(closeLabel)}</button>
    </div>
  `

  const panel = document.createElement('div')
  panel.id = 'journey-pdf-panel'
  panel.className = 'jpdf-pop'
  panel.hidden = true
  panel.innerHTML = `
    <div class="jpdf-group">
      <div class="jpdf-group-label">Layout</div>
      ${optionRow('journey-pdf-continuous', 'Continuous page', 'On: one long continuous page, ideal for viewing on screen. Off: separate A4 pages, ideal for printing.')}
    </div>
    <div class="jpdf-group">
      <div class="jpdf-group-label">Cover</div>
      ${optionRow('journey-pdf-coverinfo', 'Title &amp; stats', 'Show or hide the title, subtitle and the Days / Entries / Photos stat tiles on the cover.')}
      ${optionRow('journey-pdf-branding', 'Branding', 'Show or hide the &#39;Journey Book&#39; label and the &#39;Made with TREK&#39; footer.')}
      ${optionRow('journey-pdf-dim', 'Dim cover photo', 'Dim the cover photo so the text stays readable. Off = a lighter overlay so the hero photo shows through more.')}
    </div>
    <div class="jpdf-group">
      <div class="jpdf-group-label">Content</div>
      ${optionRow('journey-pdf-proscons', 'Pros / cons', 'Show or hide the pros/cons (Loved it / Could be better) cards.')}
      ${optionRow('journey-pdf-moodweather', 'Mood &amp; weather', 'Show or hide the mood and weather chips.')}
    </div>
  `

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'flex:1;width:100%;border:none;'
  // No script runs inside the document (print is triggered from the parent via
  // contentWindow.print()), so withhold allow-scripts to keep the sandbox tight.
  iframe.sandbox = 'allow-same-origin allow-modals'
  iframe.srcdoc = exportDocument.html

  card.appendChild(header)
  card.appendChild(iframe)
  card.appendChild(panel)
  overlay.appendChild(card)
  document.body.appendChild(overlay)

  // Tear down the overlay and the injected UI styles together.
  const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup() }
  const cleanup = () => {
    overlay.remove()
    uiStyle.remove()
    document.removeEventListener('keydown', onKeydown)
  }
  document.addEventListener('keydown', onKeydown)
  overlay.onclick = (e) => { if (e.target === overlay) cleanup() }
  header.querySelector<HTMLButtonElement>('#journey-pdf-close')!.onclick = cleanup

  // Options popover: the "Options" button opens/closes the grouped panel.
  // Clicking the button toggles it; clicking anywhere else in the card (the
  // header or preview chrome) closes it. On phones the panel is a bottom sheet.
  const optionsBtn = header.querySelector<HTMLButtonElement>('#journey-pdf-options')!
  const setPanelOpen = (open: boolean) => {
    panel.hidden = !open
    optionsBtn.classList.toggle('is-open', open)
    optionsBtn.setAttribute('aria-expanded', String(open))
  }
  optionsBtn.onclick = (e) => { e.stopPropagation(); setPanelOpen(panel.hidden) }
  card.addEventListener('click', (e) => {
    if (panel.hidden) return
    const t = e.target as Node
    if (!panel.contains(t) && t !== optionsBtn && !optionsBtn.contains(t)) setPanelOpen(false)
  })

  // Live-update the preview when the mode toggle changes so what the user sees
  // matches what they'll get.
  const modeToggle = card.querySelector<HTMLInputElement>('#journey-pdf-continuous')!
  modeToggle.onchange = () => {
    const doc = iframe.contentDocument
    if (doc) doc.body.classList.toggle('continuous', modeToggle.checked)
  }

  // Cover / content export options. Applied live to the preview and persisted
  // on <body>, so they carry into the export.
  const titleToggle = card.querySelector<HTMLInputElement>('#journey-pdf-coverinfo')!
  const brandingToggle = card.querySelector<HTMLInputElement>('#journey-pdf-branding')!
  const dimToggle = card.querySelector<HTMLInputElement>('#journey-pdf-dim')!
  const prosconsToggle = card.querySelector<HTMLInputElement>('#journey-pdf-proscons')!
  const moodWeatherToggle = card.querySelector<HTMLInputElement>('#journey-pdf-moodweather')!
  const applyCoverOptions = () => {
    const doc = iframe.contentDocument
    if (!doc) return
    // One "Title & stats" toggle drives both the title/subtitle and the stat tiles.
    doc.body.classList.toggle('hide-cover-title', !titleToggle.checked)
    doc.body.classList.toggle('hide-cover-stats', !titleToggle.checked)
    doc.body.classList.toggle('hide-cover-branding', !brandingToggle.checked)
    doc.body.classList.toggle('light-cover-dim', !dimToggle.checked)
    doc.body.classList.toggle('hide-proscons', !prosconsToggle.checked)
    doc.body.classList.toggle('hide-moodweather', !moodWeatherToggle.checked)
  }
  titleToggle.onchange = applyCoverOptions
  brandingToggle.onchange = applyCoverOptions
  dimToggle.onchange = applyCoverOptions
  prosconsToggle.onchange = applyCoverOptions
  moodWeatherToggle.onchange = applyCoverOptions

  header.querySelector<HTMLButtonElement>('#journey-pdf-save')!.onclick = async () => {
    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc || !win) return
    const continuous = modeToggle.checked
    doc.body.classList.toggle('continuous', continuous)

    // Override the @page size just before printing. In continuous mode the
    // page is sized to the full content height so the whole book prints as one
    // long page (a smooth digital scroll, no page breaks). In paged mode it
    // falls back to A4 landscape.
    let pageStyle = doc.getElementById('page-size-override') as HTMLStyleElement | null
    if (!pageStyle) {
      pageStyle = doc.createElement('style')
      pageStyle.id = 'page-size-override'
      doc.head.appendChild(pageStyle)
    }

    if (continuous) {
      // Wait for images and fonts so the measured height is final.
      await Promise.all(Array.from(doc.images).map(img =>
        img.complete ? null : new Promise<void>(res => {
          img.addEventListener('load', () => res(), { once: true })
          img.addEventListener('error', () => res(), { once: true })
        })
      ))
      try { await (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready } catch { /* ignore */ }

      // A4 landscape width in CSS px (841.89pt). Measure the content height at
      // exactly this width so the on-screen and printed layouts agree.
      const W = 1122.52
      const prevWidth = doc.body.style.width
      doc.body.style.width = `${W}px`
      const H = Math.ceil(doc.body.scrollHeight) + 1
      doc.body.style.width = prevWidth
      pageStyle.textContent = `@page { size: ${W}px ${H}px; margin: 0; }`
    } else {
      pageStyle.textContent = '@page { size: A4 landscape; margin: 0; }'
    }

    win.print()
  }
}
