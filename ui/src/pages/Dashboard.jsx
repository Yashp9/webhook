import { useState, useEffect, useCallback } from 'react'
import { endpointsAPI, deliveriesAPI } from '../api'
import RegisterModal from '../components/RegisterModal'
import LogsModal     from '../components/LogsModal'

export default function Dashboard() {
  const [endpoints,    setEndpoints]    = useState([])
  const [stats,        setStats]        = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [showRegister, setShowRegister] = useState(false)
  const [logsFor,      setLogsFor]      = useState(null)

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        endpointsAPI.list(),
        deliveriesAPI.stats(),
      ])
      setEndpoints(a.data.endpoints || [])
      setStats(b.data.stats || null)
    } catch (e) {
      console.error('Dashboard load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  async function deleteEndpoint(id) {
    if (!confirm('Delete this endpoint and all its delivery logs?')) return
    try {
      await endpointsAPI.remove(id)
      load()
    } catch (e) {
      alert('Failed to delete endpoint')
    }
  }

  async function toggleActive(id, current) {
    try {
      await endpointsAPI.update(id, { is_active: !current })
      load()
    } catch (e) {
      alert('Failed to update endpoint')
    }
  }

  const n = v => Number(v) || 0

  const rateColor = rate =>
    n(rate) >= 80 ? '#16a34a' :
    n(rate) >= 40 ? '#d97706' : '#dc2626'

  return (
    <div>

      {/* ── Stats row ── */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}>
          {[
            {
              label: 'Total Deliveries',
              value: n(stats.total),
              color: '#111827',
            },
            {
              label: 'Successful',
              value: n(stats.successful),
              color: '#16a34a',
            },
            {
              label: 'Perm. Failed',
              value: n(stats.permanently_failed),
              color: '#dc2626',
            },
            {
              label: 'Success Rate',
              value: `${n(stats.overall_success_rate)}%`,
              color: rateColor(stats.overall_success_rate),
            },
          ].map(s => (
            <div key={s.label} className="stat">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.color }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Endpoints table ── */}
      <div className="card">
        <div className="card-header">
          <h3>Endpoints ({endpoints.length})</h3>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setShowRegister(true)}
          >
            + Register
          </button>
        </div>

        {loading ? (
          <div className="empty">Loading...</div>
        ) : endpoints.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📭</div>
            <strong>No endpoints registered</strong>
            <p>Click Register to add your first webhook endpoint</p>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => setShowRegister(true)}
            >
              + Register Endpoint
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Event Types</th>
                <th>Health</th>
                <th>Rate</th>
                <th>Active</th>
                <th>Logs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map(ep => (
                <tr key={ep.id}>

                  <td style={{ fontWeight: 600 }}>{ep.name}</td>

                  <td>
                    <span
                      className="mono text-muted"
                      style={{
                        maxWidth: 180,
                        display: 'inline-block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'middle',
                      }}
                      title={ep.url}
                    >
                      {ep.url}
                    </span>
                  </td>

                  <td>
                    {(ep.event_types || []).slice(0, 2).map(t => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                    {(ep.event_types || []).length > 2 && (
                      <span className="tag">
                        +{ep.event_types.length - 2}
                      </span>
                    )}
                  </td>

                  <td>
                    <span className={`badge badge-${ep.health_status || 'unknown'}`}>
                      {ep.health_status || 'unknown'}
                    </span>
                  </td>

                  <td style={{
                    fontWeight: 600,
                    color: ep.success_rate != null
                      ? rateColor(ep.success_rate)
                      : '#6b7280'
                  }}>
                    {ep.success_rate != null ? `${ep.success_rate}%` : '—'}
                  </td>

                  <td>
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => toggleActive(ep.id, ep.is_active)}
                      style={{
                        background:  ep.is_active ? '#dcfce7' : '#f3f4f6',
                        color:       ep.is_active ? '#16a34a' : '#6b7280',
                        border:      `1px solid ${ep.is_active ? '#16a34a' : '#e5e7eb'}`,
                        fontWeight:  600,
                      }}
                    >
                      {ep.is_active ? 'ON' : 'OFF'}
                    </button>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setLogsFor(ep)}
                    >
                      View Logs
                    </button>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => deleteEndpoint(ep.id)}
                      style={{
                        color:      '#dc2626',
                        background: 'none',
                        border:     '1px solid #e5e7eb',
                      }}
                    >
                      Delete
                    </button>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modals ── */}
      {showRegister && (
        <RegisterModal
          onDone={() => load()}
          onClose={() => { setShowRegister(false); load() }}
        />
      )}

      {logsFor && (
        <LogsModal
          endpoints={logsFor}
          onClose={() => setLogsFor(null)}
        />
      )}

    </div>
  )
}