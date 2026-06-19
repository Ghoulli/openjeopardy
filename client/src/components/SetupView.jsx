import { useState } from 'react'

export default function SetupView({ onPlayerLogin, onPlayerRegister, onAdminLogin, authError, adminError, wsStatus }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [adminPw, setAdminPw] = useState('')
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'admin'

  const handlePlayerSubmit = () => {
    if (!username.trim() || !password) return
    if (mode === 'login') onPlayerLogin(username.trim(), password)
    else onPlayerRegister(username.trim(), password)
  }

  const handlePlayerKey = e => { if (e.key === 'Enter') handlePlayerSubmit() }

  const switchMode = next => {
    setMode(next)
    setUsername('')
    setPassword('')
    setAdminPw('')
  }

  return (
    <div className="setup-view">
      <h1 className="jeopardy-title">JEOPARDY!</h1>

      {mode === 'admin' ? (
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
          <button className="btn-primary" onClick={() => onAdminLogin(adminPw)}>Login</button>
          <button className="btn-secondary" onClick={() => switchMode('login')}>Back</button>
        </div>
      ) : (
        <div className="setup-form">
          <h2>{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>
          <input
            type="text"
            className="setup-input"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={handlePlayerKey}
            autoFocus
          />
          <input
            type="password"
            className="setup-input"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={handlePlayerKey}
          />
          {authError && <p className="error-text">{authError}</p>}
          <button
            className="btn-primary"
            onClick={handlePlayerSubmit}
            disabled={!username.trim() || !password}
          >
            {mode === 'login' ? 'Join Game' : 'Create Account & Join'}
          </button>
          <button className="btn-secondary" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'New here? Create an account' : 'Already have an account?'}
          </button>
          <button className="btn-secondary" onClick={() => switchMode('admin')}>Admin Panel</button>
        </div>
      )}

      <span className={`ws-badge ${wsStatus}`}>{wsStatus}</span>
    </div>
  )
}
