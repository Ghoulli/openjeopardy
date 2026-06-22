import { useState, useEffect, useCallback, useRef } from 'react'
import Board from './components/Board'
import AdminPanel from './components/AdminPanel'
import QuestionModal from './components/QuestionModal'
import BuzzerDisplay from './components/BuzzerDisplay'
import FinalJeopardyPage from './components/FinalJeopardyPage'
import Scoreboard from './components/Scoreboard'
import SetupView from './components/SetupView'
import ProfileModal from './components/ProfileModal'
import { WS_URL } from './config'
import { useBuzzerSound } from './hooks/useBuzzerSound'

export default function App() {
  const [gameState, setGameState] = useState(null)
  const [view, setView] = useState('setup')
  const [playerId, setPlayerId] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [wsStatus, setWsStatus] = useState('connecting')
  const [adminError, setAdminError] = useState('')
  const [authError, setAuthError] = useState('')
  const [notYourTurn, setNotYourTurn] = useState(false)
  const [playerUsername, setPlayerUsername] = useState(null)
  const [playerStats, setPlayerStats] = useState(null)
  const [playerAchievements, setPlayerAchievements] = useState([])
  const [showProfile, setShowProfile] = useState(false)
  const [newAchievements, setNewAchievements] = useState([])
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState(null)

  const playBuzz = useBuzzerSound()
  const prevBuzzLenRef = useRef(0)

  const notYourTurnTimer = useRef(null)
  const achToastTimer = useRef(null)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const isAdminRef = useRef(false)
  const playerIdRef = useRef(null)

  isAdminRef.current = isAdmin
  playerIdRef.current = playerId

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('connected')
      clearTimeout(reconnectRef.current)

      const savedAdminToken = sessionStorage.getItem('adminToken')
      const savedPlayerToken = localStorage.getItem('playerToken')

      if (sessionStorage.getItem('isAdmin') === 'true' && savedAdminToken) {
        ws.send(JSON.stringify({ type: 'admin_rejoin', token: savedAdminToken }))
      } else if (savedPlayerToken) {
        ws.send(JSON.stringify({ type: 'player_rejoin', token: savedPlayerToken }))
      }
    }

    ws.onmessage = e => {
      const msg = JSON.parse(e.data)
      switch (msg.type) {
        case 'state':
          setGameState(msg.gameState)
          break
        case 'registered':
          setPlayerId(msg.id)
          setView('board')
          break
        case 'admin_registered':
          setPlayerId(msg.id)
          setIsAdmin(true)
          setView('admin')
          if (msg.token) sessionStorage.setItem('adminToken', msg.token)
          break
        case 'player_auth':
          localStorage.setItem('playerToken', msg.token)
          setPlayerUsername(msg.username)
          setPlayerStats(msg.stats)
          setPlayerAchievements(msg.achievements || [])
          setPlayerAvatarUrl(msg.avatarUrl || null)
          setAuthError('')
          break
        case 'avatar_updated':
          setPlayerAvatarUrl(msg.avatarUrl)
          break
        case 'stats_updated':
          setPlayerStats(msg.stats)
          setPlayerAchievements(msg.achievements || [])
          break
        case 'achievements_unlocked':
          setPlayerAchievements(prev => {
            const existingIds = new Set(prev.map(a => a.id))
            return [...prev, ...msg.achievements.filter(a => !existingIds.has(a.id))]
          })
          setNewAchievements(msg.achievements)
          clearTimeout(achToastTimer.current)
          achToastTimer.current = setTimeout(() => setNewAchievements([]), 5000)
          break
        case 'error':
          if (msg.message?.includes('Session expired') || msg.message?.includes('expired')) {
            sessionStorage.removeItem('adminToken')
            sessionStorage.removeItem('isAdmin')
            setIsAdmin(false)
            setView('setup')
          }
          setAdminError(msg.message)
          break
        case 'auth_error':
          if (msg.message?.includes('expired') || msg.message?.includes('not found')) {
            localStorage.removeItem('playerToken')
            setView('setup')
          }
          setAuthError(msg.message)
          break
      }
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
      reconnectRef.current = setTimeout(connect, 1000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      clearTimeout(achToastTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback(msg => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  // Play buzzer sound when first buzz arrives
  useEffect(() => {
    const len = gameState?.buzzOrder?.length ?? 0
    if (len > 0 && prevBuzzLenRef.current === 0) playBuzz()
    prevBuzzLenRef.current = len
  }, [gameState?.buzzOrder, playBuzz])

  // Spacebar buzzer — only when: focused window, not typing in an input, not admin, buzzer active
  useEffect(() => {
    const handler = e => {
      if (e.code !== 'Space') return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      if (isAdminRef.current) return
      if (!playerIdRef.current) return
      if (!gameState?.buzzerActive) return
      e.preventDefault()
      send({ type: 'buzz' })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [gameState?.buzzerActive, send])

  const handlePlayerLogin = (username, password) => {
    setAuthError('')
    send({ type: 'login_player', username, password })
  }

  const handlePlayerRegister = (username, password) => {
    setAuthError('')
    send({ type: 'register_player', username, password })
  }

  const handleAdminLogin = password => {
    setAdminError('')
    sessionStorage.setItem('isAdmin', 'true')
    send({ type: 'admin_join', password })
  }

  const handleLeave = () => {
    sessionStorage.clear()
    localStorage.removeItem('playerToken')
    setIsAdmin(false)
    setPlayerId(null)
    setPlayerUsername(null)
    setPlayerStats(null)
    setPlayerAchievements([])
    setPlayerAvatarUrl(null)
    setShowProfile(false)
    setNewAchievements([])
    setView('setup')
  }

  function handlePlayerCellClick(col, row) {
    if (!gameState) return
    const isMyTurn = playerUsername && playerUsername === gameState.activePlayerName
    if (!isMyTurn) {
      clearTimeout(notYourTurnTimer.current)
      setNotYourTurn(true)
      notYourTurnTimer.current = setTimeout(() => setNotYourTurn(false), 2200)
      return
    }
    if (gameState.pendingCellRequest) return
    send({ type: 'request_open_cell', col, row })
  }

  const isFinalPage = window.location.pathname === '/final'

  if (!gameState) {
    return (
      <SetupView
        onPlayerLogin={handlePlayerLogin}
        onPlayerRegister={handlePlayerRegister}
        onAdminLogin={handleAdminLogin}
        authError={authError}
        adminError={adminError}
        wsStatus={wsStatus}
      />
    )
  }

  if (isFinalPage) {
    return <FinalJeopardyPage gameState={gameState} wsStatus={wsStatus} />
  }

  if (view === 'setup') {
    return (
      <SetupView
        onPlayerLogin={handlePlayerLogin}
        onPlayerRegister={handlePlayerRegister}
        onAdminLogin={handleAdminLogin}
        authError={authError}
        adminError={adminError}
        wsStatus={wsStatus}
      />
    )
  }

  if (view === 'admin') {
    return (
      <AdminPanel
        gameState={gameState}
        send={send}
        onLeave={handleLeave}
        wsStatus={wsStatus}
      />
    )
  }

  // ── Player board view ──
  const activeCell = gameState.activeCell
  const activeCellData = activeCell
    ? gameState.cells[`${activeCell.col}-${activeCell.row}`]
    : null

  const pendingReq = gameState.pendingCellRequest
  const isMyTurn = playerUsername && playerUsername === gameState.activePlayerName
  const myPendingRequest = pendingReq && pendingReq.playerName === playerUsername

  return (
    <div className="app">
      <div className="game-wrap">
        <Scoreboard players={gameState.players} activePlayerName={gameState.activePlayerName} />
        <Board
          gameState={gameState}
          isAdmin={false}
          onCellClick={handlePlayerCellClick}
          onFinalClick={null}
          myPlayerName={playerUsername}
        />
      </div>

      {/* Turn indicator */}
      {gameState.activePlayerName && !activeCell && (
        <div className={`turn-indicator ${isMyTurn ? 'turn-mine' : 'turn-other'}`}>
          {isMyTurn
            ? myPendingRequest
              ? '⏳ Waiting for gamemaster approval…'
              : '🎯 Your turn — pick a question!'
            : `It's ${gameState.activePlayerName}'s turn`
          }
          {myPendingRequest && (
            <button
              className="cancel-request-btn"
              onClick={() => send({ type: 'cancel_cell_request' })}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* "Not your turn" toast */}
      {notYourTurn && (
        <div className="not-your-turn-toast">
          It is not your turn
        </div>
      )}

      {gameState.buzzerActive && !activeCell && gameState.buzzOrder.length === 0 && (
        <div className="buzzer-active-banner">
          BUZZER ACTIVE — Press SPACE to buzz in!
        </div>
      )}

      {!activeCell && gameState.buzzOrder.length > 0 && (
        <BuzzerDisplay buzzOrder={gameState.buzzOrder} floating />
      )}

      {activeCell && activeCellData && (
        <QuestionModal
          cell={activeCellData}
          pointValue={gameState.pointValues[activeCell.row]}
          category={gameState.categories[activeCell.col]}
          isAdmin={false}
          buzzOrder={gameState.buzzOrder}
          buzzerActive={gameState.buzzerActive}
          onClose={null}
          onActivateBuzzer={null}
          onResetBuzzers={null}
          onMarkAnswered={null}
        />
      )}

      {/* Achievement unlocked toast */}
      {newAchievements.length > 0 && (
        <div className="ach-toast" onClick={() => setNewAchievements([])}>
          <div className="ach-toast-title">Achievement{newAchievements.length > 1 ? 's' : ''} Unlocked!</div>
          {newAchievements.map(a => (
            <div key={a.id} className="ach-toast-item">
              🏆 <strong>{a.name}</strong> — {a.desc}
            </div>
          ))}
        </div>
      )}

      {/* Profile modal */}
      {showProfile && playerStats && (
        <ProfileModal
          username={playerUsername}
          stats={playerStats}
          achievements={playerAchievements}
          avatarUrl={playerAvatarUrl}
          send={send}
          onClose={() => setShowProfile(false)}
        />
      )}

      <button className="profile-btn" onClick={() => setShowProfile(true)}>
        {playerAvatarUrl && <img src={playerAvatarUrl} className="profile-btn-avatar" alt="" />}
        {playerUsername || 'Profile'}
      </button>
      <button className="leave-btn" onClick={handleLeave}>Leave</button>
      <span className={`ws-badge ${wsStatus}`}>{wsStatus}</span>
    </div>
  )
}
