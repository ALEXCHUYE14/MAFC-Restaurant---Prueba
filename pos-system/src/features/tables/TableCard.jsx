import Badge from '@/components/Badge'
import { TABLE_STATUS_COLORS } from './TablesContext'
import { formatTime } from '@/utils/dates'
import { Users, User } from 'lucide-react'

export default function TableCard({ table, onClick, selected, compact }) {
  const c = TABLE_STATUS_COLORS[table.status] || TABLE_STATUS_COLORS.available
  const isOccupied = table.status === 'occupied'

  return (
    <button
      onClick={() => onClick?.(table)}
      style={{
        background: selected ? 'rgba(37,99,235,.08)' : c.bg,
        border: `2px solid ${selected ? 'var(--amber)' : c.border}`,
        borderRadius: 'var(--r)', padding: compact ? '10px 12px' : '14px 16px',
        cursor: 'pointer', textAlign: 'left', transition: 'all .18s',
        boxShadow: selected ? '0 0 12px rgba(37,99,235,.15)' : isOccupied ? '0 0 10px rgba(220,38,38,.08)' : 'none',
        width: '100%',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {/* Table number */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{
            fontFamily: 'var(--display)', fontSize: compact ? 28 : 36,
            color: c.text, lineHeight: 1, letterSpacing: 1,
          }}>
            {table.number < 10 ? `0${table.number}` : table.number}
          </div>
          <div style={{ fontSize: 9, color: 'var(--fog)', letterSpacing: 1, marginTop: 1 }}>
            MESA
          </div>
        </div>
        <Badge status={table.status} small />
      </div>

      {/* Capacity */}
      <div style={{ fontSize: 10, color: 'var(--fog)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Users size={11}/> {table.capacity} personas
      </div>

      {/* Waiter info when occupied */}
      {isOccupied && table.waiterName && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          borderTop: `1px solid ${c.border}`, paddingTop: 7,
        }}>
          <User size={12}/>
          <span style={{ fontSize: 10, color: 'var(--mist)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {table.waiterName}
          </span>
          {table.openedAt && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)' }}>
              {formatTime(table.openedAt)}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
