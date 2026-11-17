import { useState } from 'react'
import { useTables, TABLE_STATUS_COLORS } from './TablesContext'
import TableCard from './TableCard'
import Badge from '@/components/Badge'
import { Skeleton } from '@/components/Loader'

const STATUS_FILTERS = ['all', 'available', 'occupied', 'reserved', 'cleaning']

export default function TableMap({ onSelectTable, selectedId, actionLabel = 'Seleccionar', compact }) {
  const { tables, loading, available, occupied, reserved, cleaning, updateTable } = useTables()
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all' ? tables : tables.filter(t => t.status === filter)

  const stats = [
    { label: 'Disponibles', val: available.length, color: '#16A34A' },
    { label: 'Ocupadas',    val: occupied.length,  color: '#DC2626' },
    { label: 'Reservadas',  val: reserved.length,  color: '#2563EB' },
    { label: 'Por Limpiar', val: cleaning.length,  color: '#D97706' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Stats */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {stats.map(s => (
          <div key={s.label} style={{
            flex: '1 1 70px', background: 'var(--ink3)', border: '1px solid var(--line)',
            borderRadius: 'var(--r2)', padding: '7px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 1, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex', gap: 5, padding: '8px 14px',
        borderBottom: '1px solid var(--line)', overflowX: 'auto', flexShrink: 0,
      }}>
        {STATUS_FILTERS.map(f => {
          const c = TABLE_STATUS_COLORS[f]
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', borderRadius: 20, border: 'none',
                fontWeight: 700, fontSize: 10, letterSpacing: .5, whiteSpace: 'nowrap',
                cursor: 'pointer', transition: 'all .15s',
                background: filter === f ? 'var(--amber)' : 'var(--ink3)',
                color: filter === f ? '#FFFFFF' : 'var(--mist)',
              }}
            >
              {f === 'all' ? 'Todas' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          )
        })}
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 12,
        display: 'grid',
        gridTemplateColumns: compact
          ? 'repeat(auto-fill, minmax(100px, 1fr))'
          : 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10, alignContent: 'start',
      }}>
        {loading ? (
          Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={compact ? 90 : 120} />
          ))
        ) : filtered.map(table => (
          <TableCard
            key={table.id}
            table={table}
            compact={compact}
            selected={selectedId === table.id}
            onClick={table => onSelectTable?.(table)}
          />
        ))}
      </div>

      {/* Admin status changer legend */}
      {!compact && (
        <div style={{
          padding: '10px 14px', borderTop: '1px solid var(--line)',
          display: 'flex', gap: 10, flexWrap: 'wrap', flexShrink: 0,
        }}>
          {Object.entries(TABLE_STATUS_COLORS).map(([s, c]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.text }} />
              <span style={{ fontSize: 10, color: 'var(--fog)' }}>
                {s === 'available' ? 'Disponible' : s === 'occupied' ? 'Ocupada' : s === 'reserved' ? 'Reservada' : 'Por Limpiar'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
