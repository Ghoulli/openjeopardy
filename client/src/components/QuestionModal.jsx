import { useState, useRef } from 'react'
import BuzzerDisplay from './BuzzerDisplay'

export default function QuestionModal({
  cell, pointValue, category, isAdmin,
  buzzOrder, buzzerActive,
  onClose, onActivateBuzzer, onResetBuzzers, onStopBuzzer, onMarkAnswered,
  isDailyDouble, dailyDoubleWager, activePlayerName, isActivePlayer,
  onSetWager, onWrongAnswer,
  drawingCarousel, onUploadDrawing, onSetCarouselIndex,
}) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [wagerInput, setWagerInput] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const drawingFileRef = useRef(null)

  if (!cell) return null

  const hasImage = !!cell.image
  const ddWagerPhase = isDailyDouble && dailyDoubleWager == null
  const ddQuestionPhase = isDailyDouble && dailyDoubleWager != null
  const isDrawing = cell.type === 'drawing'

  function submitWager() {
    const w = parseInt(wagerInput)
    if (!isFinite(w) || w < 1) return
    onSetWager(w)
    setWagerInput('')
  }

  function handleDrawingUpload(e) {
    const file = e.target.files[0]
    if (!file || !onUploadDrawing) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target.result
      const comma = dataUrl.indexOf(',')
      const base64 = dataUrl.slice(comma + 1)
      const mimeType = dataUrl.slice(0, comma).match(/:(.*?);/)[1]
      onUploadDrawing(base64, mimeType)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Daily Double: wager phase ──────────────────────────────────────────────
  if (ddWagerPhase) {
    return (
      <div className="modal-overlay">
        <div className="modal dd-modal">
          <div className="dd-splash">DAILY DOUBLE!</div>
          <div className="dd-category">{category}</div>

          {activePlayerName && (
            <div className="dd-wagering-line">
              {isActivePlayer
                ? 'Enter your wager:'
                : isAdmin
                  ? `${activePlayerName} is wagering…`
                  : `${activePlayerName} is wagering…`
              }
            </div>
          )}

          {(isActivePlayer || isAdmin) && (
            <div className="dd-wager-row">
              <input
                className="dd-wager-input"
                type="number"
                min={1}
                value={wagerInput}
                onChange={e => setWagerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitWager()}
                placeholder="Wager amount"
                autoFocus={isActivePlayer}
              />
              <button className="admin-btn green" onClick={submitWager}>Set Wager</button>
            </div>
          )}

          {isAdmin && (
            <div className="modal-controls" style={{ marginTop: '0.5rem' }}>
              <button className="btn-ctrl white" onClick={onClose}>✗ Close</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Drawing question type ──────────────────────────────────────────────────
  if (isDrawing) {
    const carousel = drawingCarousel || { images: [], currentIndex: -1 }
    const { images, currentIndex } = carousel
    const inCarousel = currentIndex >= 0 && images.length > 0
    const currentImage = inCarousel ? images[currentIndex] : null

    if (inCarousel && currentImage) {
      // Synchronized carousel mode — all viewers see the same image
      return (
        <>
          <div className="modal-overlay">
            <div className="modal drawing-carousel-modal">
              <div className="modal-meta">{category}</div>
              <div className="modal-points">${pointValue}</div>

              <div className="carousel-image-wrap" onClick={() => setLightbox(currentImage.url)}>
                <img src={currentImage.url} alt={currentImage.playerName} className="carousel-image" />
              </div>
              <div className="carousel-player-name">{currentImage.playerName}</div>
              <div className="carousel-counter">{currentIndex + 1} / {images.length}</div>

              {isAdmin && (
                <div className="modal-controls">
                  {currentIndex > 0 && (
                    <button className="btn-ctrl white" onClick={() => onSetCarouselIndex(currentIndex - 1)}>
                      ← Prev
                    </button>
                  )}
                  <button
                    className="btn-ctrl green"
                    onClick={() => onSetCarouselIndex(currentIndex < images.length - 1 ? currentIndex + 1 : -1)}
                  >
                    {currentIndex < images.length - 1 ? 'Next →' : '✓ Done'}
                  </button>
                  <button className="btn-ctrl yellow" onClick={() => onSetCarouselIndex(-1)}>
                    ☰ Gallery
                  </button>
                  <button className="btn-ctrl green" onClick={onMarkAnswered}>✓ Mark Answered</button>
                  <button className="btn-ctrl white" onClick={onClose}>✗ Close</button>
                </div>
              )}
            </div>
          </div>

          {lightbox && (
            <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
              <img src={lightbox} alt="" className="lightbox-image" />
            </div>
          )}
        </>
      )
    }

    // Gallery / upload mode
    return (
      <>
        <div className="modal-overlay">
          <div className="modal drawing-gallery-modal">
            <div className="modal-meta">{category}</div>
            <div className="modal-points">${pointValue}</div>

            <div className="modal-question">
              {cell.question || <em style={{ opacity: 0.5 }}>No question set</em>}
            </div>

            {!isAdmin && onUploadDrawing && (
              <div className="drawing-upload-section">
                <button
                  className="drawing-upload-btn"
                  onClick={() => drawingFileRef.current?.click()}
                >
                  + Upload your drawing
                </button>
                <input
                  ref={drawingFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleDrawingUpload}
                />
              </div>
            )}

            {images.length > 0 ? (
              <div className="drawing-gallery">
                {images.map((img, i) => (
                  <div key={i} className="drawing-gallery-item" onClick={() => setLightbox(img.url)}>
                    <img src={img.url} alt={img.playerName} className="drawing-gallery-thumb" />
                    <div className="drawing-gallery-name">{img.playerName}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="drawing-waiting">Waiting for drawings…</div>
            )}

            {isAdmin && (
              <div className="modal-controls">
                {images.length > 0 && (
                  <button className="btn-ctrl green" onClick={() => onSetCarouselIndex(0)}>
                    ▶ Slideshow ({images.length})
                  </button>
                )}
                <button className="btn-ctrl green" onClick={onMarkAnswered}>✓ Mark Answered</button>
                <button className="btn-ctrl white" onClick={onClose}>✗ Close</button>
              </div>
            )}
          </div>
        </div>

        {lightbox && (
          <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
            <img src={lightbox} alt="" className="lightbox-image" />
          </div>
        )}
      </>
    )
  }

  // ── Normal or Daily Double question phase ─────────────────────────────────
  return (
    <>
    <div className="modal-overlay">
      <div className="modal">
        {ddQuestionPhase ? (
          <div className="dd-header-bar">
            <span className="dd-tag">DAILY DOUBLE</span>
            <span className="dd-wager-display">Wager: ${dailyDoubleWager?.toLocaleString()}</span>
          </div>
        ) : (
          <>
            <div className="modal-meta">{category}</div>
            <div className="modal-points">${pointValue}</div>
          </>
        )}

        {hasImage ? (
          <div className="modal-content-row">
            <div className="modal-question modal-question-left">
              {cell.question || <em style={{ opacity: 0.5 }}>No question set</em>}
            </div>
            <div className="modal-image-wrap">
              <img src={cell.image} alt="" className="modal-image modal-image-clickable" onClick={() => setLightbox(cell.image)} />
            </div>
          </div>
        ) : (
          <div className="modal-question">
            {cell.question || <em style={{ opacity: 0.5 }}>No question set</em>}
          </div>
        )}

        {isAdmin && showAnswer && (
          <div className="modal-answer">
            <strong>Answer:</strong> {cell.answer || <em>No answer set</em>}
          </div>
        )}

        {!ddQuestionPhase && (
          <div className="modal-buzzer-section">
            {buzzerActive && (!buzzOrder || buzzOrder.length === 0) && (
              <div className="modal-buzzer-active">
                BUZZER ACTIVE — Players can buzz in!
              </div>
            )}
            {buzzOrder && buzzOrder.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <BuzzerDisplay buzzOrder={buzzOrder} />
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="modal-controls">
            <button className="btn-ctrl yellow" onClick={() => setShowAnswer(v => !v)}>
              {showAnswer ? 'Hide Answer' : 'Show Answer'}
            </button>
            {!ddQuestionPhase && (
              <>
                <button className="btn-ctrl green" onClick={onActivateBuzzer}>
                  ✓ Activate Buzzer
                </button>
                {buzzerActive && (
                  <button className="btn-ctrl red" onClick={onStopBuzzer}>
                    ■ Stop Buzzer
                  </button>
                )}
                <button className="btn-ctrl orange" onClick={onResetBuzzers}>
                  ↺ Reset Buzzers
                </button>
              </>
            )}
            <button className="btn-ctrl green" onClick={onMarkAnswered}>
              {ddQuestionPhase
                ? `✓ Correct (+$${dailyDoubleWager?.toLocaleString()})`
                : '✓ Mark Answered'}
            </button>
            {onWrongAnswer && (
              <button className="btn-ctrl red" onClick={onWrongAnswer}>
                {ddQuestionPhase
                  ? `✗ Wrong (−$${dailyDoubleWager?.toLocaleString()})`
                  : buzzOrder?.length > 0
                    ? `✗ Wrong (−$${pointValue?.toLocaleString()})`
                    : '✗ Wrong Answer'}
              </button>
            )}
            <button className="btn-ctrl white" onClick={onClose}>
              ✗ Close
            </button>
          </div>
        )}
      </div>
    </div>

    {lightbox && (
      <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
        <img src={lightbox} alt="" className="lightbox-image" />
      </div>
    )}
  </>
  )
}
