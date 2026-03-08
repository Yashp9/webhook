import { useState } from 'react'
import Dashboard  from './pages/Dashboard'
import DeadLetter from './pages/DeadLetter'
import TriggerModal from './components/TriggerModal'

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [triggerOpen, setTriggerOpen] = useState(false)

  return (
    <>
      <nav className="nav">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="nav-brand">⚡ Webhook Engine</span>
          <div className="nav-tabs">
            <button
              className={`nav-tab ${tab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setTab('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={`nav-tab ${tab === 'deadletter' ? 'active' : ''}`}
              onClick={() => setTab('deadletter')}
            >
              ☠ Dead Letters
            </button>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={() => setTriggerOpen(true)}
        >
          ▶ Trigger Event
        </button>
      </nav>

      <div className="page">
        {tab === 'dashboard'   && <Dashboard />}
        {tab === 'deadletter'  && <DeadLetter />}
      </div>

      {triggerOpen && (
        <TriggerModal onClose={() => setTriggerOpen(false)} />
      )}
    </>
  )
}