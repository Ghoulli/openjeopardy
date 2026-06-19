export default function BuzzerDisplay({ buzzOrder, floating = false }) {
  if (!buzzOrder || buzzOrder.length === 0) return null

  const [first, ...rest] = buzzOrder

  return (
    <div className={`buzzer-display ${floating ? 'floating' : ''}`}>
      <div className="buzzer-first">
        <span className="buzzer-trophy">🏆</span>
        {first.playerName} — FIRST!
      </div>
      {rest.length > 0 && (
        <div className="buzzer-others">
          {rest.map((b, i) => (
            <div key={b.playerId + i} className="buzzer-other-row">
              <span>{b.playerName}</span>
              <span className="buzzer-delta">+{b.delta.toLocaleString()}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
