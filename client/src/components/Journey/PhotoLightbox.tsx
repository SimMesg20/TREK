import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import VideoPlayer from './VideoPlayer'

interface LightboxPhoto {
  id: string
  src: string
  caption?: string | null
  provider?: string
  asset_id?: string | null
  owner_id?: number | null
  mediaType?: string | null
  infoUrl?: string
}

interface PhotoMetadata {
  takenAt?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  camera?: string | null
  lens?: string | null
  focalLength?: string | number | null
  aperture?: string | number | null
  shutter?: string | number | null
  iso?: string | number | null
  lat?: number | null
  lng?: number | null
  orientation?: number | null
  description?: string | null
  width?: number | null
  height?: number | null
  fileSize?: number | null
  fileName?: string | null
}

interface Props {
  photos: LightboxPhoto[]
  startIndex?: number
  onClose: () => void
}

export default function PhotoLightbox({ photos, startIndex = 0, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const photo = photos[idx]
  const [metadata, setMetadata] = useState<PhotoMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const hasPrev = idx > 0
  const hasNext = idx < photos.length - 1

  const prev = useCallback(() => { if (hasPrev) setIdx(i => i - 1) }, [hasPrev])
  const next = useCallback(() => { if (hasNext) setIdx(i => i + 1) }, [hasNext])

  useEffect(() => {
    if (!photo?.infoUrl) {
      setMetadata(null)
      setMetadataLoading(false)
      return
    }
    let cancelled = false
    setMetadataLoading(true)
    fetch(photo.infoUrl, { credentials: 'include' })
      .then(response => response.ok ? response.json() as Promise<PhotoMetadata> : Promise.reject(new Error('metadata request failed')))
      .then(data => { if (!cancelled) setMetadata(data) })
      .catch(() => { if (!cancelled) setMetadata(null) })
      .finally(() => { if (!cancelled) setMetadataLoading(false) })
    return () => { cancelled = true }
  }, [photo?.id, photo?.infoUrl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onClose])

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y

    // swipe down to close
    if (dy > 80 && Math.abs(dx) < 60) {
      onClose()
      return
    }
    // horizontal swipe
    if (Math.abs(dx) > 50 && Math.abs(dy) < 80) {
      if (dx < 0) next()
      else prev()
    }
    touchStart.current = null
  }

  if (!photo) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(20px)',
        display: 'flex', flexDirection: 'column',
        paddingBottom: 'var(--bottom-nav-h)',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Photo area — centered with nav overlays */}
      <div
        className="group/lightbox"
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}
      >
        {/* Top bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'calc(13px * var(--fs-scale-body, 1))', fontWeight: 500 }}>
            {idx + 1} / {photos.length}
          </span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Prev button — visible on hover (desktop), always visible (mobile) */}
        {hasPrev && (
          <button onClick={prev} className="flex sm:opacity-0 sm:group-hover/lightbox:opacity-100 transition-opacity" style={{
            position: 'absolute', left: 16, zIndex: 5,
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
          }}>
            <ChevronLeft size={22} />
          </button>
        )}

        {/* Photo or video */}
        {photo.mediaType === 'video' ? (
          <VideoPlayer key={photo.id} src={photo.src} />
        ) : (
          <img
            key={photo.id}
            src={photo.src}
            alt={photo.caption || ''}
            style={{
              maxWidth: '92vw', maxHeight: '92vh',
              objectFit: 'contain', borderRadius: 4,
              animation: 'fadeIn 0.15s ease',
            }}
          />
        )}

        {/* Next button */}
        {hasNext && (
          <button onClick={next} className="flex sm:opacity-0 sm:group-hover/lightbox:opacity-100 transition-opacity" style={{
            position: 'absolute', right: 16, zIndex: 5,
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
          }}>
            <ChevronRight size={22} />
          </button>
        )}

        {/* Caption — bottom center overlay */}
        {photo.caption && (
          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 5, maxWidth: '70%', textAlign: 'center' }}>
            <p style={{
              fontSize: 'calc(14px * var(--fs-scale-body, 1))', fontStyle: 'italic',
              color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.5,
              background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)',
              padding: '6px 14px', borderRadius: 10,
            }}>{photo.caption}</p>
          </div>
        )}

        {(photo.infoUrl || metadata) && (
          <details style={{ position: 'absolute', left: 20, bottom: 20, zIndex: 6, width: 'min(320px, calc(100vw - 40px))', color: '#fff' }}>
            <summary style={{ display: 'inline-block', cursor: 'pointer', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', padding: '7px 11px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
              {metadataLoading ? 'Loading details…' : 'Photo details'}
            </summary>
            {metadata && (
              <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(12px)', fontSize: 11, lineHeight: 1.45, maxHeight: '42vh', overflowY: 'auto' }}>
                {[
                  ['File', metadata.fileName],
                  ['Taken', metadata.takenAt ? new Date(metadata.takenAt).toLocaleString() : null],
                  ['Location', [metadata.city, metadata.state, metadata.country].filter(Boolean).join(', ') || null],
                  ['GPS', Number.isFinite(metadata.lat) && Number.isFinite(metadata.lng) ? `${metadata.lat}, ${metadata.lng}` : null],
                  ['Camera', metadata.camera],
                  ['Lens', metadata.lens],
                  ['Focal length', metadata.focalLength],
                  ['Aperture', metadata.aperture],
                  ['Shutter', metadata.shutter],
                  ['ISO', metadata.iso],
                  ['Dimensions', metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : null],
                  ['File size', metadata.fileSize ? `${Math.round(metadata.fileSize / 1024)} KB` : null],
                  ['Description', metadata.description],
                ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                    <span style={{ color: 'rgba(255,255,255,0.55)', minWidth: 84 }}>{label}</span>
                    <span style={{ color: 'rgba(255,255,255,0.9)', overflowWrap: 'anywhere' }}>{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </details>
        )}
      </div>
    </div>
  )
}
