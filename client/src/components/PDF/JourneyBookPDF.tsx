import type { JourneyDetail } from '../../store/journeyStore'
import { showJourneyExportPreview } from '../../features/journey-export/preview/showJourneyExportPreview'
import { buildJourneyBookDocument, type JourneyBookRenderOptions } from '../../features/journey-export/render/buildJourneyBookDocument'

/**
 * Compatibility entry point for the existing Journey download action.
 * New export modes should call the feature modules directly rather than adding
 * rendering or preview code here.
 */
export async function downloadJourneyBookPDF(journey: JourneyDetail, options: JourneyBookRenderOptions = {}) {
  const document = buildJourneyBookDocument(journey, options)
  const t = options.t
  showJourneyExportPreview({
    title: journey.title,
    document,
    saveLabel: translate(t, 'journey.pdf.saveAsPdf', 'Save as PDF'),
    closeLabel: translate(t, 'common.close', 'Close'),
    pagesLabel: translate(t, 'journey.pdf.pages', 'pages'),
  })
}

function translate(t: JourneyBookRenderOptions['t'], key: string, fallback: string): string {
  const translated = t?.(key)
  return translated && translated !== key ? translated : fallback
}
