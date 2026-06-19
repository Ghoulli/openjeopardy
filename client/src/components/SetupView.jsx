import { useState } from 'react'

export default function SetupView({ onPlayerJoin, onAdminLogin, adminError, wsStatus, sessionActive }) {
  const [name, setName] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [adminPw, setAdminPw] = useState('')

  return (
    <div className="setup-view">
      <h1 className="jeopardy-title">JEOPARDY!</h1>

      {!showAdmin ? (
        <div className="setup-form">
          {sessionActive ? (
            <>
              <input
                type="text"
                className="setup-input"
                placeholder="Enter your name"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && onPlayerJoin(name.trim())}
                autoFocus
              />
              <button
                className="btn-primary"
                onClick={() => name.trim() && onPlayerJoin(name.trim())}
              >
                Join Game
              </button>
            </>
          ) : (
            <div className="working-on-it">
              <div className="working-on-it-icon">🔧</div>
              <p className="working-on-it-text">It&rsquo;s still being worked on!</p>
              <p className="working-on-it-sub">Check back soon — the gamemaster will open the session shortly.</p>
            </div>
          )}
          <button className="btn-secondary" onClick={() => setShowAdmin(true)}>
            Admin Panel
          </button>
        </div>
      ) : (
        <div className="setup-form">
          <h2>Admin Login</h2>
          <input
            type="password"
            className="setup-input"
            placeholder="Password"
            value={adminPw}
            onChange={e => setAdminPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onAdminLogin(adminPw)}
            autoFocus
          />
          {adminError && <p className="error-text">{adminError}</p>}
          <button className="btn-primary" onClick={() => onAdminLogin(adminPw)}>
            Login
          </button>
          <button className="btn-secondary" onClick={() => { setShowAdmin(false); setAdminPw('') }}>
            Back
          </button>
        </div>
      )}

      <span className={`ws-badge ${wsStatus}`}>{wsStatus}</span>
    </div>
  )
}
