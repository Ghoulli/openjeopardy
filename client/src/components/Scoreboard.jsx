export default function Scoreboard({ players, activePlayerName, reactions = [] }) {
  if (!players || players.length === 0) return null
  return (
    <div className="scoreboard">
      {players.map(p => {
        const playerReactions = reactions.filter(r => r.playerName === p.name)
        return (
          <div key={p.name} className={`player-score${p.name === activePlayerName ? ' active-player' : ''}`}>
            {/* Floating reaction bubbles */}
            {playerReactions.map((r, i) => (
              <span
                key={r.id}
                className="player-reaction-bubble"
                style={{ left: `${30 + (i % 3) * 22}%` }}
              >
                {r.emoji}
              </span>
            ))}

            {p.avatarUrl && (
              <img src={p.avatarUrl} className="player-score-avatar" alt="" />
            )}
            <div className="player-score-name">
              {p.name}
              {(p.streak || 0) >= 3 && (
                <span className="streak-flame" title={`${p.streak} in a row!`}>
                  🔥{p.streak}
                </span>
              )}
            </div>
            <div className="player-score-value">
              {p.score < 0 ? '-' : ''}${Math.abs(p.score).toLocaleString()}
            </div>
          </div>
        )
      })}
    </div>
  )
}
