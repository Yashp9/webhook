import { useState, useEffect } from 'react'
import { deliveriesAPI } from '../api'

export default function DeadLetter() {
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [retrying, setRetrying] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const r = await deliveriesAPI.deadLetter({ limit: 50 })
      setItems(r.data.dead_letters || [])
    } catch { }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function retry(id) {
    setRetrying(id)
    try {
      await deliveriesAPI.retry(id)
      load()
    } catch (e) {
      alert(e.response?.data?.error || 'Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">☠ Dead Letter Queue</div>
          <div className="page-sub">
            Permanently failed deliveries — max retries exceeded
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty">Loading...</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">✅</div>
            <strong style={{ color: 'var(--green)' }}>All clear!</strong>
            <p>No permanently failed deliveries</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Event</th>
                <th>Attempts</th>
                <th>Error</th>
                <th>Failed At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600 }}>{item.endpoint_name}</td>
                  <td><span className="tag">{item.event_type}</span></td>
                  <td style={{ textAlign: 'center', color: 'var(--red)', fontWeight: 700 }}>
                    {item.attempt_number}
                  </td>
                  <td style={{
                    color: 'var(--red)', fontSize: 12,
                    maxWidth: 220, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {item.error_message || '—'}
                  </td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {new Date(item.updated_at).toLocaleString()}
                  </td>
                  <td>
                    <button className="btn-secondary btn-sm"
                      disabled={retrying === item.id}
                      onClick={() => retry(item.id)}>
                      {retrying === item.id ? '...' : '↺ Retry'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}