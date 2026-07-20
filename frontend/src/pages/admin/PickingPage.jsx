/**
 * pages/admin/PickingPage.jsx
 * Lista de picking: ítems de reservas activas ordenados por ubicación física.
 * Permite a los empleados recorrer el almacén de forma eficiente.
 */
import { useState, useEffect, useRef } from 'react'
import { pickingAPI, warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import {
  ClipboardList, MapPin, Package, User, CheckCircle2, Circle,
  Printer, RefreshCw, Filter, X, Loader2, CheckCheck, Warehouse,
  AlertTriangle, ChevronDown, ChevronRight, Clock
} from 'lucide-react'
import ProductImage from '../../components/shared/ProductImage'
import { format, parseISO, differenceInHours } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const STATUS_COLORS = {
  pending:   'badge-orange',
  confirmed: 'badge-green',
}

export default function PickingPage() {
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState(new Set())   // IDs marcados como recogidos localmente
  const [completing, setCompleting] = useState(null) // ID en proceso de completar
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [groupByWarehouse, setGroupByWarehouse] = useState(true)
  const [collapsed, setCollapsed] = useState(new Set())
  const printRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const [pickRes, whRes] = await Promise.all([
        pickingAPI.list({ warehouse_id: warehouseFilter || undefined, status: statusFilter }),
        warehousesAPI.list(),
      ])
      setItems(pickRes.data || [])
      setWarehouses(whRes.data || [])
    } catch {
      toast.error('Error al cargar el picking')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [warehouseFilter, statusFilter])

  // Marcar ítem como recogido (solo visual, sin llamada al backend aún)
  const togglePick = (id) => {
    setPicked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const markAllPicked = () => {
    setPicked(new Set(items.map(i => i.reservation_id)))
  }

  const clearPicks = () => setPicked(new Set())

  // Confirmar un ítem (pending → confirmed)
  const handleConfirm = async (id) => {
    try {
      await pickingAPI.confirmPick(id)
      toast.success('Ítem confirmado')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al confirmar')
    }
  }

  // Completar (confirmed → completed, descuenta stock)
  const handleComplete = async (id) => {
    if (!confirm('¿Marcar como entregado al cliente? Esto descontará el stock.')) return
    setCompleting(id)
    try {
      const res = await pickingAPI.completePick(id)
      toast.success(`✅ Entregado. Stock restante: ${res.data.new_stock}`)
      setPicked(prev => { const n = new Set(prev); n.delete(id); return n })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al completar')
    } finally {
      setCompleting(null) }
  }

  // Print
  const handlePrint = () => window.print()

  // Agrupados por almacén
  const grouped = items.reduce((acc, item) => {
    const key = item.warehouse_name
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  const toggleGroup = (key) => {
    setCollapsed(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  const pendingCount = items.filter(i => i.reservation_status === 'pending').length
  const pickedCount  = picked.size

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ClipboardList size={22} className="text-brand-500" />
            Lista de Picking
          </h1>
          <p className="text-sm text-ink-400 mt-0.5">
            Ítems ordenados por ubicación para recoger eficientemente
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={load} className="btn-secondary min-h-11 min-w-11" title="Actualizar" aria-label="Actualizar lista de picking">
            <RefreshCw size={14} />
          </button>
          <button onClick={handlePrint} className="btn-secondary">
            <Printer size={14} /> Imprimir
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:hidden">
        {[
          { label: 'Total ítems',    value: items.length,                  color: 'text-ink-700'   },
          { label: 'Pendientes',     value: pendingCount,                  color: 'text-orange-600' },
          { label: 'Confirmados',    value: items.length - pendingCount,   color: 'text-green-600'  },
          { label: 'Marcados hoy',   value: pickedCount,                   color: 'text-brand-600'  },
        ].map(s => (
          <div key={s.label} className="card p-4 text-center">
            <p className={clsx('text-2xl font-extrabold', s.color)}>{s.value}</p>
            <p className="text-xs text-ink-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center print:hidden">
        {/* Almacén */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter size={14} className="text-ink-400" />
          <select
            value={warehouseFilter}
            onChange={e => setWarehouseFilter(e.target.value)}
            className="input text-sm min-h-11 flex-1 sm:w-44"
          >
            <option value="">Todos los almacenes</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {/* Estado */}
        <div className="flex gap-1 bg-ink-100 p-1 rounded-xl overflow-x-auto">
          {[
            { key: 'all',       label: 'Todos'      },
            { key: 'pending',   label: 'Pendientes' },
            { key: 'confirmed', label: 'Confirmados'},
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={clsx(
                'min-h-10 px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all',
                statusFilter === s.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Agrupar */}
        <label className="flex items-center gap-2 text-sm text-ink-600 cursor-pointer">
          <input
            type="checkbox"
            checked={groupByWarehouse}
            onChange={e => setGroupByWarehouse(e.target.checked)}
            className="rounded"
          />
          Agrupar por almacén
        </label>

        {/* Acciones masivas */}
        {items.length > 0 && (
          <div className="flex flex-col min-[430px]:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
            <button onClick={markAllPicked} className="btn-secondary min-h-11 text-xs flex-1">
              <CheckCheck size={13} /> Marcar todos
            </button>
            {pickedCount > 0 && (
              <button onClick={clearPicks} className="btn-ghost min-h-11 text-xs text-ink-400 flex-1">
                <X size={13} /> Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 size={28} className="animate-spin mr-3" />
          Cargando lista de picking...
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center text-ink-400">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin ítems pendientes</p>
          <p className="text-xs mt-1">Cuando haya reservas activas aparecerán aquí</p>
        </div>
      ) : groupByWarehouse ? (
        /* Vista agrupada por almacén */
        <div className="space-y-4" ref={printRef}>
          {Object.entries(grouped).map(([whName, whItems]) => {
            const isCollapsed = collapsed.has(whName)
            const whPicked = whItems.filter(i => picked.has(i.reservation_id)).length
            return (
              <div key={whName} className="card overflow-hidden">
                {/* Grupo header */}
                <button
                  onClick={() => toggleGroup(whName)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-ink-50 border-b border-ink-100 hover:bg-ink-100 transition-colors print:cursor-default"
                >
                  {isCollapsed
                    ? <ChevronRight size={16} className="text-ink-400 print:hidden" />
                    : <ChevronDown  size={16} className="text-ink-400 print:hidden" />
                  }
                  <Warehouse size={15} className="text-brand-500" />
                  <span className="font-bold text-ink-800 flex-1 text-left">{whName}</span>
                  <span className="text-xs text-ink-500">{whItems.length} ítem{whItems.length !== 1 ? 's' : ''}</span>
                  {whPicked > 0 && (
                    <span className="text-xs font-semibold text-green-600">
                      {whPicked}/{whItems.length} recogidos
                    </span>
                  )}
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-ink-50">
                    {whItems.map(item => (
                      <PickingRow
                        key={item.reservation_id}
                        item={item}
                        isPicked={picked.has(item.reservation_id)}
                        isCompleting={completing === item.reservation_id}
                        onToggle={() => togglePick(item.reservation_id)}
                        onConfirm={() => handleConfirm(item.reservation_id)}
                        onComplete={() => handleComplete(item.reservation_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* Vista plana ordenada por ubicación */
        <div className="card overflow-hidden" ref={printRef}>
          <div className="divide-y divide-ink-50">
            {items.map(item => (
              <PickingRow
                key={item.reservation_id}
                item={item}
                isPicked={picked.has(item.reservation_id)}
                isCompleting={completing === item.reservation_id}
                onToggle={() => togglePick(item.reservation_id)}
                onConfirm={() => handleConfirm(item.reservation_id)}
                onComplete={() => handleComplete(item.reservation_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print\\:hidden { display: none !important; }
          #root, #root * { visibility: visible; }
          .animate-fade-in { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function PickingRow({ item, isPicked, isCompleting, onToggle, onConfirm, onComplete }) {
  const hoursLeft = differenceInHours(parseISO(item.expires_at), new Date())
  const isUrgent  = hoursLeft <= 4
  const isExpired = hoursLeft <= 0

  return (
    <div className={clsx(
      'grid grid-cols-[auto_auto_minmax(0,1fr)] sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 transition-colors',
      isPicked && 'bg-green-50',
      isExpired && !isPicked && 'bg-red-50',
      isUrgent && !isExpired && !isPicked && 'bg-orange-50',
    )}>
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={clsx(
          'w-11 h-11 -m-2 mt-[-0.375rem] flex items-center justify-center shrink-0 transition-colors print:hidden',
          isPicked ? 'text-green-500' : 'text-ink-300 hover:text-ink-500'
        )}
        title={isPicked ? 'Desmarcar' : 'Marcar como recogido'}
        aria-label={isPicked ? `Desmarcar ${item.product_name}` : `Marcar ${item.product_name} como recogido`}
      >
        {isPicked
          ? <CheckCircle2 size={20} />
          : <Circle size={20} />
        }
      </button>

      {/* Imagen */}
      <ProductImage
        src={item.product_image}
        className={clsx('w-10 h-10 rounded-lg shrink-0', isPicked && 'opacity-50')}
        iconSize={14}
      />

      {/* Info principal */}
      <div className={clsx('min-w-0', isPicked && 'opacity-60')}>
        <div className="flex flex-wrap items-start gap-2">
          <p className={clsx('font-semibold text-ink-900 text-sm', isPicked && 'line-through')}>
            {item.product_name}
          </p>
          {item.product_sku && (
            <span className="text-[10px] font-mono text-ink-400 bg-ink-100 px-1.5 py-0.5 rounded">
              {item.product_sku}
            </span>
          )}
          <span className={clsx('badge text-xs', STATUS_COLORS[item.reservation_status] || 'badge-gray')}>
            {item.reservation_status === 'pending' ? 'Pendiente' : 'Confirmado'}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {/* Ubicación bodega */}
          <div className="flex items-center gap-1">
            <MapPin size={11} className="text-ink-400 shrink-0" />
            <span className={clsx(
              'text-xs font-semibold',
              item.location_label === 'Sin ubicación' ? 'text-ink-300 italic' : 'text-ink-700'
            )}>
              Bodega: {item.location_label}
            </span>
          </div>
          {/* Ubicación tienda */}
          {item.store_location && (
            <div className="flex items-center gap-1">
              <MapPin size={11} className="text-brand-500 shrink-0" />
              <span className="text-xs font-semibold text-brand-700">
                Tienda: {item.store_location}
              </span>
            </div>
          )}

          {/* Cantidad */}
          <div className="flex items-center gap-1">
            <Package size={11} className="text-ink-400 shrink-0" />
            <span className="text-xs text-ink-600 font-medium">
              {item.quantity} {item.product_unit}
              {item.stock_available < item.quantity && (
                <span className="text-red-500 ml-1 font-bold">
                  ⚠ stock: {item.stock_available}
                </span>
              )}
            </span>
          </div>

          {/* Cliente */}
          <div className="flex items-center gap-1">
            <User size={11} className="text-ink-400 shrink-0" />
            <span className="text-xs text-ink-600">{item.client_name}</span>
          </div>

          {/* Código reserva */}
          <span className="text-xs font-mono text-ink-400">#{item.reservation_code}</span>

          {/* Vencimiento */}
          <div className={clsx(
            'flex items-center gap-1 text-xs font-medium',
            isExpired ? 'text-red-600' : isUrgent ? 'text-orange-600' : 'text-ink-400'
          )}>
            <Clock size={11} className="shrink-0" />
            {isExpired
              ? 'Expirada'
              : `Vence en ${hoursLeft}h`
            }
          </div>
        </div>

        {item.notes && (
          <p className="text-xs text-ink-400 mt-1 italic">Nota: {item.notes}</p>
        )}
      </div>

      {/* Acciones */}
      <div className="col-span-3 sm:col-span-1 flex flex-row sm:flex-col gap-2 sm:gap-1 shrink-0 print:hidden">
        {item.reservation_status === 'pending' && (
          <button
            onClick={onConfirm}
            className="btn-secondary min-h-11 sm:min-h-8 text-xs px-3 py-1 text-green-700 border-green-200 hover:bg-green-50 flex-1 sm:flex-none"
            title="Confirmar recogida"
          >
            Confirmar
          </button>
        )}
        {item.reservation_status === 'confirmed' && (
          <button
            onClick={onComplete}
            disabled={!!isCompleting}
            className="btn-primary min-h-11 sm:min-h-8 text-xs px-3 py-1 flex-1 sm:flex-none"
            title="Entregar al cliente y descontar stock"
          >
            {isCompleting
              ? <Loader2 size={11} className="animate-spin" />
              : 'Entregar'
            }
          </button>
        )}
      </div>
    </div>
  )
}
