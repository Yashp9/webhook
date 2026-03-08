import { useState, useEffect } from 'react'
import { eventsAPI } from '../api'

export default function TriggerModal({ onClose }) {
  const [eventType, setEventType] = useState('')
  const [payload,   setPayload]   = useState('{\n  "test": true\n}')
  const [types,     setTypes]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(null)

  useEffect(() => {
    eventsAPI.types()
      .then(r => setTypes(r.data.event_types || []))
      .catch(() => {})
  }, [])

  async function submit() {
    setError('')
    if (!eventType.trim()) { setError('Event type is required'); return }
    let parsed
    try { parsed = JSON.parse(payload) }
    catch { setError('Payload must be valid JSON'); return }

    setLoading(true)
    try {
      const r = await eventsAPI.trigger({ event_type: eventType, payload: parsed })
      setSuccess(r.data)
    } catch (e) {
      setError(e.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>▶ Trigger Event</h2>

        {success ? (
          <>
            <div className="alert alert-success">
              <strong>✓ Event triggered!</strong><br />
              Queued for {success.deliveries_queued} endpoint(s).
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary"
                onClick={() => { setSuccess(null); setEventType('') }}>
                Trigger Another
              </button>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Event Type</label>
              <input
                value={eventType}
                onChange={e => setEventType(e.target.value)}
                placeholder="payment.created"
                list="evt-types"
              />
              <datalist id="evt-types">
                {types.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>

            <div className="field">
              <label>Payload (JSON)</label>
              <textarea
                value={payload}
                onChange={e => setPayload(e.target.value)}
                rows={5}
                style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={submit} disabled={loading}>
                {loading ? 'Sending...' : '▶ Trigger'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}