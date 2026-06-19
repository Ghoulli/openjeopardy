import { useState, useEffect, useCallback, useRef } from 'react'
import Board from './components/Board'
import AdminPanel from './components/AdminPanel'
import QuestionModal from './components/QuestionModal'
import BuzzerDisplay from './components/BuzzerDisplay'
import FinalJeopardyPage from './components/FinalJeopardyPage'
import Scoreboard from './components/Scoreboard'
import SetupView from './components/SetupView'
import { WS_URL } from './config'

export default function App() {
  const [gameState, setGameState] = useState(null)
  const [view, setView] = useState('setup')
  const [playerId, setPlayerId] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [wsStatus, setWsStatus] = useState('connecting')
  const [adminError, setAdminError] = useState('')
  const [notYourTurn, setNotYourTurn] = useState(false)
  const notYourTurnTimer = useRef(null)

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

      const savedToken = sessionStorage.getItem('adminToken')
      const savedName = sessionStorage.getItem('playerName')

      if (sessionStorage.getItem('isAdmin') === 'true' && savedToken) {
        ws.send(JSON.stringify({ type: 'admin_rejoin', token: savedToken }))
      } else if (savedName) {
        ws.send(JSON.stringify({ type: 'join', name: savedName }))
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
        case 'error':
          // If the admin token expired, clear stale session and go back to login
          if (msg.message?.includes('Session expired') || msg.message?.includes('expired')) {
            sessionStorage.removeItem('adminToken')
            sessionStorage.removeItem('isAdmin')
            setIsAdmin(false)
            setView('setup')
          }
          setAdminError(msg.message)
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
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback(msg => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

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

  const handlePlayerJoin = name => {
    sessionStorage.setItem('playerName', name)
    sessionStorage.removeItem('isAdmin')
    send({ type: 'join', name })
  }

  const handleAdminLogin = password => {
    setAdminError('')
    sessionStorage.setItem('isAdmin', 'true')
    // Do NOT store the password — a token is returned on success and stored instead
    send({ type: 'admin_join', password })
  }

  const handleLeave = () => {
    sessionStorage.clear()
    setIsAdmin(false)
    setPlayerId(null)
    setView('setup')
  }

  const myPlayerName = sessionStorage.getItem('playerName') || null

  function handlePlayerCellClick(col, row) {
    if (!gameState) return
    const isMyTurn = myPlayerName && myPlayerName === gameState.activePlayerName
    if (!isMyTurn) {
      // Show "not your turn" toast
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
        onPlayerJoin={handlePlayerJoin}
        onAdminLogin={handleAdminLogin}
        adminError={adminError}
        wsStatus={wsStatus}
        sessionActive={false}
      />
    )
  }

  if (isFinalPage) {
    return <FinalJeopardyPage gameState={gameState} wsStatus={wsStatus} />
  }

  if (view === 'setup') {
    return (
      <SetupView
        onPlayerJoin={handlePlayerJoin}
        onAdminLogin={handleAdminLogin}
        adminError={adminError}
        wsStatus={wsStatus}
        sessionActive={!!gameState.currentSessionId}
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
  const isMyTurn = myPlayerName && myPlayerName === gameState.activePlayerName
  const myPendingRequest = pendingReq && pendingReq.playerName === myPlayerName

  return (
    <div className="app">
      <div className="game-wrap">
        <Scoreboard players={gameState.players} activePlayerName={gameState.activePlayerName} />
        <Board
          gameState={gameState}
          isAdmin={false}
          onCellClick={handlePlayerCellClick}
          onFinalClick={null}
          myPlayerName={myPlayerName}
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

      <button className="leave-btn" onClick={handleLeave}>Leave</button>
      <span className={`ws-badge ${wsStatus}`}>{wsStatus}</span>
    </div>
  )
}
