import { afterEach, describe, expect, it } from 'vitest'
import { showJourneyExportPreview } from './showJourneyExportPreview'
import type { JourneyBookDocument } from '../render/buildJourneyBookDocument'

function makeDocument(): JourneyBookDocument {
  return {
    html: '<!DOCTYPE html><html><body class="continuous"><h1>Preview</h1></body></html>',
    estimatedPageCount: 3,
  }
}

function open(overrides: Partial<Parameters<typeof showJourneyExportPreview>[0]> = {}) {
  showJourneyExportPreview({ title: 'Iceland Ring Road', document: makeDocument(), ...overrides })
  return document.getElementById('journey-pdf-overlay')!
}

afterEach(() => {
  document.getElementById('journey-pdf-overlay')?.remove()
  document.getElementById('journey-pdf-ui-style')?.remove()
})

describe('showJourneyExportPreview', () => {
  it('renders the overlay with Save, Close and Options actions', () => {
    const overlay = open({ saveLabel: 'Save as PDF', closeLabel: 'Close' })

    expect(overlay.querySelector('#journey-pdf-save')!.textContent).toBe('Save as PDF')
    expect(overlay.querySelector('#journey-pdf-close')!.textContent).toBe('Close')
    expect(overlay.querySelector('#journey-pdf-options')).not.toBeNull()
    expect(overlay.querySelector<HTMLElement>('.jpdf-title')!.textContent).toContain('3 pages')
  })

  it('keeps the Options popover collapsed until the button is clicked', () => {
    const overlay = open()
    const panel = overlay.querySelector<HTMLElement>('#journey-pdf-panel')!
    const optionsBtn = overlay.querySelector<HTMLButtonElement>('#journey-pdf-options')!

    expect(panel.hidden).toBe(true)

    optionsBtn.click()
    expect(panel.hidden).toBe(false)
    expect(optionsBtn.getAttribute('aria-expanded')).toBe('true')

    optionsBtn.click()
    expect(panel.hidden).toBe(true)
  })

  it('groups every export toggle inside the popover with iOS-style switches', () => {
    const overlay = open()
    const panel = overlay.querySelector<HTMLElement>('#journey-pdf-panel')!

    for (const id of [
      'journey-pdf-continuous',
      'journey-pdf-coverinfo',
      'journey-pdf-branding',
      'journey-pdf-dim',
      'journey-pdf-proscons',
      'journey-pdf-moodweather',
    ]) {
      expect(panel.querySelector(`#${id}`)).not.toBeNull()
    }

    // Grouped under Layout / Cover / Content headings and rendered as switches.
    expect(panel.querySelectorAll('.jpdf-group').length).toBe(3)
    expect(panel.querySelectorAll('.jpdf-switch').length).toBe(6)
  })

  it('uses the supplied translated button and page labels', () => {
    const overlay = open({ saveLabel: 'PDF speichern', closeLabel: 'Schließen', pagesLabel: 'Seiten' })

    expect(overlay.querySelector('#journey-pdf-save')!.textContent).toBe('PDF speichern')
    expect(overlay.querySelector('#journey-pdf-close')!.textContent).toBe('Schließen')
    expect(overlay.querySelector<HTMLElement>('.jpdf-title')!.textContent).toContain('Seiten')
  })
})
