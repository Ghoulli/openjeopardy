export default function Scoreboard({ players, activePlayerName }) {
  if (!players || players.length === 0) return null
  return (
    <div className="scoreboard">
      {players.map(p => (
        <div key={p.name} className={`player-score${p.name === activePlayerName ? ' active-player' : ''}`}>
          {p.avatarUrl && (
            <img src={p.avatarUrl} className="player-score-avatar" alt="" />
          )}
          <div className="player-score-name">{p.name}</div>
          <div className="player-score-value">
            {p.score < 0 ? '-' : ''}${Math.abs(p.score).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  )
}
