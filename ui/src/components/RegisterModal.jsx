import { useState } from 'react'
import { endpointsAPI } from '../api'

const COMMON_EVENTS = [
  'payment.created', 'payment.failed', 'payment.refunded',
  'user.signup', 'user.deleted', 'order.created', 'order.completed',
]

export default function RegisterModal({ onClose, onDone }) {
  const [name,     setName]     = useState('')
  const [url,      setUrl]      = useState('')
  const [desc,     setDesc]     = useState('')
  const [selected, setSelected] = useState([])
  const [custom,   setCustom]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [secret,   setSecret]   = useState(null)

  function toggleEvent(t) {
    setSelected(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    )
  }

  function addCustom() {
    const v = custom.trim()
    if (v && !selected.includes(v)) setSelected(prev => [...prev, v])
    setCustom('')
  }

  async function handleSubmit() {
    setError('')
    if (!name.trim())     { setError('Name is required');               return }
    if (!url.trim())      { setError('URL is required');                return }
    if (!selected.length) { setError('Select at least one event type'); return }

    setLoading(true)
    try {
      const r = await endpointsAPI.create({
        name:        name.trim(),
        url:         url.trim(),
        description: desc.trim(),
        event_types: selected,
      })
      const foundSecret =
        r.data?.endpoint?.secret ||
        r.data?.secret ||
        'Secret not returned — check backend'
      setSecret(foundSecret)
      if (onDone) onDone()
    } catch (err) {
      const data = err.response?.data
      if (data?.details?.length) {
        setError(data.details.map(d => d.msg).join(', '))
      } else {
        setError(data?.error || 'Failed to register endpoint')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Secret screen ──────────────────────────────────────────────────
  if (secret) {
    return (
      <div className="overlay">
        <div className="modal">
          <h2>✓ Endpoint Registered!</h2>

          <div className="alert alert-info">
            Save this secret — it will <strong>not</strong> be shown again.
          </div>

          <div style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: '12px 14px',
            fontFamily: 'monospace',
            fontSize: 12,
            wordBreak: 'break-all',
            margin: '12px 0 16px',
            color: '#111827',
            userSelect: 'all',
          }}>
            {secret}
          </div>

          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 20 }}>
            Add this secret to your receiver server to verify the{' '}
            <code>X-Webhook-Signature</code> header on every incoming request.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Registration form ──────────────────────────────────────────────
  return (
    <div
      className="overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2>Register Endpoint</h2>

        <div className="field">
          <label>Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Payment Service"
          />
        </div>

        <div className="field">
          <label>Webhook URL</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://localhost:4000/webhook"
          />
        </div>

        <div className="field">
          <label>
            Description{' '}
            <span style={{ color: '#6b7280', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="What does this endpoint handle?"
          />
        </div>

        <div className="field">
          <label>Event Types</label>

          <div style={{ marginBottom: 8 }}>
            {COMMON_EVENTS.map(t => (
              <span
                key={t}
                className={`chip ${selected.includes(t) ? 'active' : ''}`}
                onClick={() => toggleEvent(t)}
              >
                {t}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={custom}
              onChange={e => setCustom(e.target.value)}
              placeholder="custom.event.type"
              onKeyDown={e => e.key === 'Enter' && addCustom()}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn-secondary btn-sm"
              style={{ whiteSpace: 'nowrap' }}
              onClick={addCustom}
            >
              + Add
            </button>
          </div>

          {selected.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {selected.map(t => (
                <span
                  key={t}
                  className="chip active"
                  onClick={() => toggleEvent(t)}
                >
                  {t} ×
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Registering...' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  )
}