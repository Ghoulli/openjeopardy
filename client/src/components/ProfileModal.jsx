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

export default function ProfileModal({ username, stats, achievements, onClose }) {
  const unlockedIds = new Set(achievements.map(a => a.id))

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={e => e.stopPropagation()}>
        <button className="profile-close" onClick={onClose}>✕</button>

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
