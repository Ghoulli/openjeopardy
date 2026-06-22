import { useRef, useState } from 'react'

const ALL_ACHIEVEMENTS = [
  { id: 'first_game',  name: 'Showing Up',  desc: 'Play your first game' },
  { id: 'first_win',   name: 'First Blood', desc: 'Win your first game' },
  { id: 'veteran',     name: 'Veteran',     desc: 'Play 5 games' },
  { id: 'champion',    name: 'Champion',    desc: 'Win 3 games' },
  { id: 'legend',      name: 'Legend',      desc: 'Win 10 games' },
  { id: 'rich',        name: 'Getting Paid',desc: 'Score $5,000+ in a single game' },
  { id: 'loaded',      name: 'Loaded',      desc: 'Score $10,000+ in a single game' },
  { id: 'high_roller', name: 'High Roller', desc: 'Score $25,000+ in a single game' },
  { id: 'in_the_red',  name: 'In the Red',  desc: 'Finish a game with a negative score' },
]

function fmt(n) {
  return n < 0
    ? `-$${Math.abs(n).toLocaleString()}`
    : `$${n.toLocaleString()}`
}

export default function ProfileModal({ username, stats, achievements, avatarUrl, send, onClose }) {
  const unlockedIds = new Set(achievements.map(a => a.id))
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file.')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadError('Image must be under 3 MB.')
      return
    }
    setUploadError('')
    setUploading(true)
    const reader = new FileReader()
    reader.onload = ev => {
      const base64 = ev.target.result.split(',')[1]
      send({ type: 'upload_avatar', imageBase64: base64, mimeType: file.type })
      setUploading(false)
    }
    reader.onerror = () => {
      setUploadError('Failed to read file.')
      setUploading(false)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={e => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose}>✕</button>

        <div className="profile-avatar-section">
          <div className="profile-avatar-wrap" onClick={() => fileInputRef.current?.click()}>
            {avatarUrl
              ? <img src={avatarUrl} className="profile-avatar-img" alt="Profile" />
              : <div className="profile-avatar-placeholder">{username?.[0]?.toUpperCase() || '?'}</div>
            }
            <div className="profile-avatar-overlay">
              {uploading ? '...' : 'Change'}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
          />
          {uploadError && <p className="profile-avatar-error">{uploadError}</p>}
        </div>

        <h2 className="profile-username">{username}</h2>

        <div className="profile-stats-grid">
          <div className="profile-stat">
            <span className="profile-stat-val">{stats.gamesPlayed}</span>
            <span className="profile-stat-lbl">Games Played</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-val">{stats.gamesWon}</span>
            <span className="profile-stat-lbl">Games Won</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-val">{fmt(stats.totalEarnings)}</span>
            <span className="profile-stat-lbl">Total Earnings</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-val">{fmt(stats.highScore)}</span>
            <span className="profile-stat-lbl">High Score</span>
          </div>
        </div>

        <h3 className="profile-ach-heading">Achievements</h3>
        <div className="profile-ach-list">
          {ALL_ACHIEVEMENTS.map(ach => {
            const unlocked = unlockedIds.has(ach.id)
            return (
              <div key={ach.id} className={`profile-ach-item ${unlocked ? 'unlocked' : 'locked'}`}>
                <span className="profile-ach-icon">{unlocked ? '🏆' : '🔒'}</span>
                <div className="profile-ach-text">
                  <span className="profile-ach-name">{ach.name}</span>
                  <span className="profile-ach-desc">{ach.desc}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
