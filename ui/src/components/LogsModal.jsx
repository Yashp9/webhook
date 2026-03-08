import { useState, useEffect, useCallback } from 'react'
import { endpointsAPI, deliveriesAPI } from '../api'

export default function LogsModal({ endpoint, onClose }) {
  const [logs,     setLogs]     = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [filter,   setFilter]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [retrying, setRetrying] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await endpointsAPI.logs(endpoint.id, {
        page,
        limit: 10,
        ...(filter ? { status: filter } : {})
      })
      setLogs(r.data.logs)
      setTotal(r.data.pagination.total)
    } catch { }
    finally { setLoading(false) }
  }, [endpoint.id, page, filter])

  useEffect(() => { load() }, [load])

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

  const pages = Math.ceil(total / 10) || 1

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>{endpoint.name}</h2>
            <div className="text-muted mono">{endpoint.url}</div>
          </div>
          <button className="btn-secondary btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}
            style={{ width: 200 }}>
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="permanently_failed">Permanently Failed</option>
            <option value="delivering">Delivering</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        {loading ? (
          <div className="empty">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📭</div>
            <p>No delivery logs found</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Event</th>
                  <th>Attempt</th>
                  <th>Code</th>
                  <th>Time</th>
                  <th>Error</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>
                      <span className={`badge badge-${log.status}`}>
                        {log.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td><span className="tag">{log.event_type}</span></td>
                    <td style={{ textAlign: 'center', color: 'var(--muted)' }}>
                      {log.attempt_number}/{log.max_attempts}
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 600,
                        color: log.response_code && log.response_code < 300
                          ? 'var(--green)' : 'var(--red)'
                      }}>
                        {log.response_code || '—'}
                      </span>
                    </td>
                    <td className="text-muted">
                      {log.response_time_ms ? `${log.response_time_ms}ms` : '—'}
                    </td>
                    <td style={{
                      color: 'var(--red)', fontSize: 12,
                      maxWidth: 180, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {log.error_message || '—'}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                    <td>
                      {['failed', 'permanently_failed'].includes(log.status) && (
                        <button className="btn-secondary btn-sm"
                          disabled={retrying === log.id}
                          onClick={() => retry(log.id)}>
                          {retrying === log.id ? '...' : '↺ Retry'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
            <button className="btn-secondary btn-sm"
              disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              ← Prev
            </button>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Page {page} of {pages}
            </span>
            <button className="btn-secondary btn-sm"
              disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}