export default function EndScreen({ endScreen }) {
  if (!endScreen) return null

  const { sortedPlayers, awards, playerStats } = endScreen

  const medal = ['🥇', '🥈', '🥉']

  return (
    <div className="end-screen">
      <div className="end-screen-title">Game Over!</div>

      {/* Podium */}
      <div className="end-podium">
        {sortedPlayers.slice(0, 3).map((p, i) => (
          <div key={p.name} className={`end-podium-place end-podium-place-${i + 1}`}>
            <div className="end-podium-medal">{medal[i] || ''}</div>
            {p.avatarUrl && (
              <img src={p.avatarUrl} alt="" className="end-podium-avatar" />
            )}
            <div className="end-podium-name">{p.name}</div>
            <div className="end-podium-score">
              {p.score < 0 ? '-' : ''}${Math.abs(p.score).toLocaleString()}
            </div>
            <div className="end-podium-block" />
          </div>
        ))}
      </div>

      {/* Full standings if more than 3 players */}
      {sortedPlayers.length > 3 && (
        <div className="end-standings">
          {sortedPlayers.slice(3).map((p, i) => (
            <div key={p.name} className="end-standings-row">
              <span className="end-standings-rank">#{i + 4}</span>
              {p.avatarUrl && <img src={p.avatarUrl} alt="" className="end-standings-avatar" />}
              <span className="end-standings-name">{p.name}</span>
              <span className="end-standings-score">
                {p.score < 0 ? '-' : ''}${Math.abs(p.score).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Awards */}
      {awards.length > 0 && (
        <div className="end-awards">
          <div className="end-awards-title">Awards</div>
          <div className="end-awards-grid">
            {awards.map((a, i) => (
              <div key={i} className="end-award-card">
                <div className="end-award-icon">{a.icon}</div>
                <div className="end-award-title">{a.title}</div>
                <div className="end-award-player">{a.player}</div>
                <div className="end-award-detail">{a.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-player stat table */}
      {playerStats.length > 0 && (
        <div className="end-stat-table-wrap">
          <div className="end-awards-title">Stats</div>
          <table className="end-stat-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Score</th>
                <th>Peak</th>
                <th>Low</th>
                <th>Swing</th>
                <th>Best Streak</th>
                <th>Buzzer #1s</th>
                <th>Avg Reaction</th>
              </tr>
            </thead>
            <tbody>
              {[...playerStats].sort((a, b) => b.score - a.score).map(s => (
                <tr key={s.name}>
                  <td className="end-stat-name">{s.name}</td>
                  <td className={s.score < 0 ? 'end-stat-neg' : ''}>{s.score < 0 ? '-' : ''}${Math.abs(s.score).toLocaleString()}</td>
                  <td>${s.maxScore.toLocaleString()}</td>
                  <td className={s.minScore < 0 ? 'end-stat-neg' : ''}>{s.minScore < 0 ? '-' : ''}${Math.abs(s.minScore).toLocaleString()}</td>
                  <td>${s.swing.toLocaleString()}</td>
                  <td>{s.maxStreak}</td>
                  <td>{s.firstBuzzCount}</td>
                  <td>{s.avgReaction != null ? `${(s.avgReaction / 1000).toFixed(2)}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
