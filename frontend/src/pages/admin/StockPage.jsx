/**
 * pages/admin/StockPage.jsx
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { stockAPI, productsAPI, warehousesAPI, batchesAPI, serialsAPI, putawayAPI } from '../../services/api'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import toast from 'react-hot-toast'
import {
  Plus, ArrowUp, ArrowDown, RefreshCw, BarChart3,
  X, Loader2, Pencil, Warehouse, MapPin, CalendarX2, Layers,
  Hash, Search, CheckCircle2, ShoppingCart, Archive, Trash2, ChevronDown,
  ScanLine, Camera, AlertCircle
} from 'lucide-react'
import ProductImage from '../../components/shared/ProductImage'
import BarcodeScannerModal from '../../components/shared/BarcodeScannerModal'
import { Modal } from '../../components/ui'
import { format, differenceInDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

/**
 * SearchableSelect — dropdown con búsqueda integrada.
 * options: array de objetos | getValue(opt)→string | getLabel(opt)→string
 */
function SearchableSelect({ options = [], value, onChange, placeholder = 'Seleccionar...', getLabel, getValue, required }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selected = options.find(o => getValue(o) === value)

  const filtered = query
    ? options.filter(o => getLabel(o).toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      {/* Hidden input for form required validation */}
      <input type="text" value={value} onChange={() => {}} required={required} className="sr-only" tabIndex={-1} />
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className={clsx(
          'input w-full flex items-center justify-between gap-2 text-left',
          !selected && 'text-ink-400'
        )}
      >
        <span className="truncate">{selected ? getLabel(selected) : placeholder}</span>
        <ChevronDown size={14} className={clsx('shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-[60] w-full mt-1 bg-white border border-ink-200 rounded-xl shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-ink-100">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-7 pr-2 py-1.5 text-sm outline-none bg-ink-50 rounded-lg"
              />
            </div>
          </div>
          {/* Options */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-ink-400 text-center py-4">Sin resultados para "{query}"</p>
            ) : filtered.map(opt => (
              <button
                key={getValue(opt)}
                type="button"
                onClick={() => { onChange(getValue(opt)); setOpen(false); setQuery('') }}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm transition-colors hover:bg-ink-50',
                  getValue(opt) === value && 'bg-brand-50 text-brand-700 font-medium'
                )}
              >
                {getLabel(opt)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const SERIAL_STATUSES = {
  in_stock:  { label: 'En stock',   color: 'badge-green',  icon: CheckCircle2  },
  reserved:  { label: 'Reservado',  color: 'badge-orange', icon: Archive       },
  sold:      { label: 'Vendido',    color: 'badge-gray',   icon: ShoppingCart  },
  retired:   { label: 'Retirado',   color: 'badge-red',    icon: Trash2        },
}

const typeConfig = {
  entrada:       { color: 'badge-green',  icon: ArrowUp,    label: 'Entrada'       },
  salida:        { color: 'badge-red',    icon: ArrowDown,  label: 'Salida'        },
  transferencia: { color: 'badge-orange', icon: RefreshCw,  label: 'Transferencia' },
  ajuste:        { color: 'badge-gray',   icon: BarChart3,  label: 'Ajuste'        },
}

function EditStockModal({ open, onClose, item, onSaved }) {
  const [newQty, setNewQty] = useState('')
  const [reason, setReason] = useState('')
  const [aisle, setAisle] = useState('')
  const [shelf, setShelf] = useState('')
  const [bin, setBin] = useState('')
  const [storeLocation, setStoreLocation] = useState('')
  const [minStockAlert, setMinStockAlert] = useState('5')
  const [saving, setSaving] = useState(false)
  const [putawaySuggestion, setPutawaySuggestion] = useState(null)

  useEffect(() => {
    if (open && item) {
      setNewQty(String(item.current_qty))
      setReason('')
      setAisle(item.aisle || '')
      setShelf(item.shelf || '')
      setBin(item.bin || '')
      setStoreLocation(item.store_location || '')
      setMinStockAlert(String(item.min_stock_alert ?? 5))
      setPutawaySuggestion(null)
      // Buscar sugerencia de putaway si no hay ubicación asignada
      if (!item.aisle && !item.shelf && !item.bin) {
        putawayAPI.suggest(item.product_id, item.warehouse_id)
          .then(r => { if (r.data?.source) setPutawaySuggestion(r.data) })
          .catch(() => {})
      }
    }
  }, [open, item])

  if (!open || !item) return null

  const handleSave = async (e) => {
    e.preventDefault()
    const qty = parseInt(newQty)
    if (isNaN(qty) || qty < 0) { toast.error('Cantidad inválida'); return }
    const isDecrease = qty < item.current_qty
    if (isDecrease && !reason.trim()) {
      toast.error('Indica el motivo de la baja (ej. venta, daño, extravío)')
      return
    }
    setSaving(true)
    try {
      const tasks = []
      if (qty !== item.current_qty) {
        const baseNote = `Ajuste manual: ${item.current_qty} → ${qty}`
        tasks.push(stockAPI.createMovement({
          product_id: item.product_id,
          warehouse_id: item.warehouse_id,
          type: 'ajuste',
          quantity: qty,
          notes: isDecrease ? `${baseNote} — Motivo: ${reason.trim()}` : baseNote,
        }))
      }
      tasks.push(stockAPI.updateLocation({
        product_id: item.product_id,
        warehouse_id: item.warehouse_id,
        aisle: aisle || null,
        shelf: shelf || null,
        bin: bin || null,
        store_location: storeLocation || null,
        min_stock_alert: minStockAlert === '' ? null : parseInt(minStockAlert),
      }))
      await Promise.all(tasks)
      toast.success('Stock actualizado')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al actualizar')
    } finally {
      setSaving(false)
    }
  }

  const diff = parseInt(newQty) - item.current_qty
  const diffLabel = isNaN(diff) ? null : diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0'
  const diffColor = diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-ink-400'

  return (
    <Modal open={open} onClose={onClose} title="Editar stock" size="sm">
        <p className="text-xs text-ink-400 -mt-2 mb-4">{item.product_name} · {item.warehouse_name}</p>
        <form onSubmit={handleSave} className="space-y-4">
          {/* Cantidad */}
          <div className="flex items-center gap-4 p-3 rounded-xl bg-ink-50 border border-ink-100">
            <div className="text-center flex-1">
              <p className="text-xs text-ink-400 mb-1">Actual</p>
              <p className="text-2xl font-bold text-ink-700">{item.current_qty}</p>
            </div>
            <div className="text-ink-300 text-xl">→</div>
            <div className="text-center flex-1">
              <p className="text-xs text-ink-400 mb-1">Nuevo</p>
              <p className={clsx('text-2xl font-bold', parseInt(newQty) >= 0 ? 'text-ink-900' : 'text-ink-300')}>
                {newQty !== '' ? newQty : '—'}
              </p>
            </div>
            {diffLabel && (
              <div className="text-center flex-1">
                <p className="text-xs text-ink-400 mb-1">Diferencia</p>
                <p className={clsx('text-2xl font-bold', diffColor)}>{diffLabel}</p>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Nueva cantidad *
            </label>
            <input
              type="number" min="0" value={newQty}
              onChange={e => setNewQty(e.target.value)}
              className="input text-center text-xl font-bold"
              autoFocus
            />
          </div>

          <p className="text-xs text-ink-400 text-center">
            Se registrará como <span className="font-semibold text-ink-600">ajuste manual</span> en el historial.
          </p>

          {parseInt(newQty) < item.current_qty && (
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                Motivo de la baja *
              </label>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="input"
                placeholder="Venta, daño, extravío, conteo físico..."
              />
              <p className="text-[11px] text-ink-400 mt-1">
                Obligatorio al bajar la cantidad — queda registrado en Actividad para trazabilidad ante robos o faltantes.
              </p>
            </div>
          )}

          {/* Alerta de stock mínimo */}
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Alerta de stock mínimo
            </label>
            <input
              type="number" min="0" value={minStockAlert}
              onChange={e => setMinStockAlert(e.target.value)}
              className="input"
            />
            <p className="text-[11px] text-ink-400 mt-1">
              Cuando el stock baje a este número o menos, se genera una alerta y una solicitud de reabastecimiento.
            </p>
          </div>

          {/* Ubicación de bodega (empleados / picking) */}
          <div className="divider" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-ink-500" />
              <span className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Ubicación en bodega</span>
              <span className="text-xs text-ink-400">· solo empleados</span>
            </div>
            {putawaySuggestion && (
              <button
                type="button"
                onClick={() => {
                  setAisle(putawaySuggestion.aisle || '')
                  setShelf(putawaySuggestion.shelf || '')
                  setBin(putawaySuggestion.bin || '')
                  setPutawaySuggestion(null)
                }}
                className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1 bg-brand-50 px-2 py-1 rounded-lg border border-brand-200"
              >
                ✨ Sugerencia: {[putawaySuggestion.aisle, putawaySuggestion.shelf, putawaySuggestion.bin].filter(Boolean).join(' · ')}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { label: 'Pasillo', value: aisle, set: setAisle, placeholder: 'P-5' },
              { label: 'Estante', value: shelf, set: setShelf, placeholder: 'E-B' },
              { label: 'Caja/Bin', value: bin,   set: setBin,   placeholder: '12' },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label}>
                <label className="text-xs text-ink-400 block mb-1">{label}</label>
                <input value={value} onChange={e => set(e.target.value)} className="input text-sm text-center" placeholder={placeholder} />
              </div>
            ))}
          </div>

          {/* Ubicación en tienda (visible para clientes) */}
          <div className="flex items-center gap-2 mt-3 mb-2">
            <MapPin size={14} className="text-brand-500" />
            <span className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Ubicación en tienda</span>
            <span className="text-xs text-brand-500">· visible para clientes</span>
          </div>
          <input
            value={storeLocation}
            onChange={e => setStoreLocation(e.target.value)}
            className="input text-sm"
            placeholder="Ej: Pasillo 3 - Estante B, Sección Deportes..."
          />

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
            </button>
          </div>
        </form>
    </Modal>
  )
}

// ── VariantStockModal ─────────────────────────────────────────────────
function VariantStockModal({ open, onClose, product, warehouses }) {
  const [warehouseId, setWarehouseId] = useState('')
  const [variantStock, setVariantStock] = useState([])
  const [originalStock, setOriginalStock] = useState([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const options = product?.product_options || []

  // Genera todas las combinaciones posibles
  const buildCombinations = (opts) => {
    if (!opts.length) return []
    const result = [{}]
    for (const opt of opts) {
      const expanded = []
      for (const existing of result) {
        for (const val of opt.values) {
          expanded.push({ ...existing, [opt.name]: val.label })
        }
      }
      expanded.forEach(r => result.splice(0, result.length, ...expanded))
      break
    }
    // Proper cartesian product
    let combos = [[]]
    for (const opt of opts) {
      const newCombos = []
      for (const combo of combos) {
        for (const val of opt.values) {
          newCombos.push([...combo, { key: opt.name, val: val.label }])
        }
      }
      combos = newCombos
    }
    return combos.map(pairs => Object.fromEntries(pairs.map(p => [p.key, p.val])))
  }

  const combinations = buildCombinations(options)

  useEffect(() => {
    if (open && product?.id) {
      setWarehouseId(warehouses[0]?.id || '')
    }
  }, [open, product?.id])

  useEffect(() => {
    if (!open || !product?.id || !warehouseId) return
    setLoading(true)
    productsAPI.getVariantStock(product.id)
      .then(r => {
        setVariantStock(r.data || [])
        setOriginalStock(r.data || [])
        setReason('')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, product?.id, warehouseId])

  const getOriginalQty = (combination) => {
    const key = JSON.stringify(combination)
    const found = originalStock.find(vs =>
      vs.warehouse_id === warehouseId &&
      JSON.stringify(vs.combination) === key
    )
    return found?.quantity ?? 0
  }

  const getQty = (combination) => {
    const key = JSON.stringify(combination)
    const found = variantStock.find(vs =>
      vs.warehouse_id === warehouseId &&
      JSON.stringify(vs.combination) === key
    )
    return found?.quantity ?? 0
  }

  const setQty = (combination, qty) => {
    const key = JSON.stringify(combination)
    setVariantStock(prev => {
      const existing = prev.findIndex(vs =>
        vs.warehouse_id === warehouseId &&
        JSON.stringify(vs.combination) === key
      )
      if (existing >= 0) {
        return prev.map((vs, i) => i === existing ? { ...vs, quantity: qty } : vs)
      }
      return [...prev, { warehouse_id: warehouseId, combination, quantity: qty }]
    })
  }

  const handleSave = async () => {
    const items = variantStock
      .filter(vs => vs.warehouse_id === warehouseId)
      .map(vs => ({
        warehouse_id: vs.warehouse_id,
        combination: vs.combination,
        quantity: parseInt(vs.quantity) || 0,
      }))
    // Fill missing combinations with 0
    for (const combo of combinations) {
      const key = JSON.stringify(combo)
      if (!items.find(it => JSON.stringify(it.combination) === key)) {
        items.push({ warehouse_id: warehouseId, combination: combo, quantity: 0 })
      }
    }

    // Trazabilidad ante robo/faltante: si alguna combinación BAJA de
    // cantidad, exigir motivo — igual que el ajuste manual de stock general.
    const hasDecrease = items.some(it => it.quantity < getOriginalQty(it.combination))
    if (hasDecrease && !reason.trim()) {
      toast.error('Indica el motivo de la baja (ej. venta, daño, extravío)')
      return
    }

    setSaving(true)
    try {
      await productsAPI.upsertVariantStock(product.id, items, reason.trim() || undefined)
      toast.success('Stock de variantes guardado')
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const hasAnyDecrease = variantStock
    .filter(vs => vs.warehouse_id === warehouseId)
    .some(vs => (parseInt(vs.quantity) || 0) < getOriginalQty(vs.combination))

  if (!open || !product) return null

  // Determina si hay 2 tipos de opción para mostrar la tabla cruzada
  const type1 = options[0]
  const type2 = options[1]

  return (
    <Modal open={open} onClose={onClose} title="Stock por variante" size="xl">
        <div className="space-y-4">
          <p className="text-xs text-ink-400 -mt-2">{product.name}</p>
          {/* Selector de almacén */}
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Almacén</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="input">
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="text-center py-8 text-ink-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>
          ) : combinations.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-6">Este producto no tiene opciones configuradas</p>
          ) : type2 ? (
            /* Tabla cruzada: tipo1 × tipo2 */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left p-2 text-xs text-ink-500 font-semibold">{type1.name} \ {type2.name}</th>
                    {type2.values.map(v2 => (
                      <th key={v2.label} className="p-2 text-xs text-ink-600 font-semibold text-center min-w-[72px]">
                        {v2.image
                          ? <img src={v2.image} className="w-6 h-6 rounded object-cover mx-auto mb-0.5" alt="" />
                          : null
                        }
                        {v2.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {type1.values.map(v1 => (
                    <tr key={v1.label} className="border-t border-ink-50">
                      <td className="p-2 font-medium text-ink-700 flex items-center gap-2">
                        {v1.image && <img src={v1.image} className="w-6 h-6 rounded object-cover" alt="" />}
                        {v1.label}
                      </td>
                      {type2.values.map(v2 => {
                        const combo = { [type1.name]: v1.label, [type2.name]: v2.label }
                        const qty = getQty(combo)
                        return (
                          <td key={v2.label} className="p-1.5 text-center">
                            <input
                              type="number" min="0"
                              value={qty}
                              onChange={e => setQty(combo, parseInt(e.target.value) || 0)}
                              className="w-16 text-center input text-sm py-1 px-2"
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Lista simple: solo un tipo de opción */
            <div className="space-y-2">
              {type1.values.map(v1 => {
                const combo = { [type1.name]: v1.label }
                const qty = getQty(combo)
                return (
                  <div key={v1.label} className="flex items-center gap-3 p-2 rounded-xl border border-ink-100">
                    {v1.image && <img src={v1.image} className="w-8 h-8 rounded-lg object-cover" alt="" />}
                    <span className="flex-1 text-sm font-medium text-ink-700">{v1.label}</span>
                    <input
                      type="number" min="0"
                      value={qty}
                      onChange={e => setQty(combo, parseInt(e.target.value) || 0)}
                      className="w-24 text-center input text-sm"
                    />
                    <span className="text-xs text-ink-400">unidades</span>
                  </div>
                )
              })}
            </div>
          )}

          {hasAnyDecrease && (
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                Motivo de la baja *
              </label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Ej. venta, daño, extravío..."
                className="input"
              />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar stock'}
            </button>
          </div>
        </div>
    </Modal>
  )
}

export default function StockPage() {
  const { hasFeature } = useCompanyFeatures()
  const [movements, setMovements] = useState([])
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [modal, setModal] = useState(false)
  const [editModal, setEditModal] = useState(null)
  const [batches, setBatches] = useState([])
  const [serials, setSerials] = useState([])
  const [serialSearch, setSerialSearch] = useState('')
  const [serialStatusFilter, setSerialStatusFilter] = useState('')
  const [serialModal, setSerialModal] = useState(false)
  const [serialForm, setSerialForm] = useState({ product_id: '', warehouse_id: '', serial_numbers: '', notes: '' })
  const [serialSaving, setSerialSaving] = useState(false)
  const [stockSearch, setStockSearch] = useState('')
  const [movementSearch, setMovementSearch] = useState('')
  const [movementDateFrom, setMovementDateFrom] = useState('')
  const [movementDateTo, setMovementDateTo] = useState('')
  const [form, setForm] = useState({ product_id: '', warehouse_id: '', type: 'entrada', quantity: 1, notes: '', expires_at: '', batch_code: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('current')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [variantStockModal, setVariantStockModal] = useState(null) // product obj

  const loadSerials = useCallback(() => {
    if (!hasFeature('serial_numbers')) return
    serialsAPI.list({
      ...(serialSearch ? { search: serialSearch } : {}),
      ...(serialStatusFilter ? { status: serialStatusFilter } : {}),
    }).then(r => setSerials(r.data || []))
  }, [serialSearch, serialStatusFilter, hasFeature])

  const load = () => {
    setLoading(true)
    const calls = [
      stockAPI.listMovements(),
      productsAPI.list(),
      warehousesAPI.list(),
    ]
    if (hasFeature('batch_tracking')) calls.push(batchesAPI.list({ include_empty: false }))
    Promise.all(calls).then(([m, p, w, b]) => {
      setMovements(m.data)
      setProducts(p.data)
      setWarehouses(w.data)
      if (b) setBatches(b.data || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => { loadSerials() }, [loadSerials])

  // Aplanar productos → filas por producto+almacén, con filtrado por búsqueda
  const currentStockRows = products.flatMap(p =>
    (p.stock_by_warehouse || []).map(s => {
      const wh = warehouses.find(w => w.id === s.warehouse_id)
      return {
        product_id: p.id,
        product_name: p.name,
        product_image: p.images?.[0] || null,
        product_options: p.product_options || [],
        warehouse_id: s.warehouse_id,
        warehouse_name: wh?.name || s.warehouse_id,
        current_qty: s.quantity,
        aisle: s.aisle || null,
        shelf: s.shelf || null,
        bin:   s.bin   || null,
        store_location: s.store_location || null,
        min_stock_alert: s.min_stock_alert ?? 5,
        nearest_expiry: s.nearest_expiry || null,
      }
    })
  )

  const filteredStockRows = stockSearch
    ? currentStockRows.filter(r =>
        r.product_name.toLowerCase().includes(stockSearch.toLowerCase()) ||
        r.warehouse_name.toLowerCase().includes(stockSearch.toLowerCase()) ||
        [r.aisle, r.shelf, r.bin].filter(Boolean).join(' ').toLowerCase().includes(stockSearch.toLowerCase())
      )
    : currentStockRows

  const filteredMovements = movements.filter(m => {
    if (movementSearch) {
      const q = movementSearch.toLowerCase()
      const haystack = [
        m.products?.name, m.warehouses?.name, m.notes, m.created_by_name,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (movementDateFrom && m.created_at < movementDateFrom) return false
    if (movementDateTo && m.created_at > `${movementDateTo}T23:59:59`) return false
    return true
  })

  const handleSave = async (e) => {
    e.preventDefault()
    if (form.type === 'salida' && !form.notes.trim()) {
      toast.error('Indica el motivo de la salida (ej. venta, daño, extravío)')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        quantity: parseInt(form.quantity),
        expires_at: form.expires_at || null,
        batch_code: form.batch_code || null,
      }
      await stockAPI.createMovement(payload)
      toast.success('Movimiento registrado')
      setModal(false)
      setForm({ product_id: '', warehouse_id: '', type: 'entrada', quantity: 1, notes: '', expires_at: '', batch_code: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    } finally { setSaving(false) }
  }

  const handleSaveSerials = async (e) => {
    e.preventDefault(); setSerialSaving(true)
    try {
      const lines = serialForm.serial_numbers
        .split(/[\n,]+/)
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
      if (!lines.length) { toast.error('Ingresa al menos un número de serie'); return }
      const res = await serialsAPI.create({
        product_id: serialForm.product_id,
        warehouse_id: serialForm.warehouse_id,
        serial_numbers: lines,
        notes: serialForm.notes || null,
      })
      toast.success(`${res.data.created} serie(s) registrada(s)`)
      setSerialModal(false)
      setSerialForm({ product_id: '', warehouse_id: '', serial_numbers: '', notes: '' })
      loadSerials()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al registrar series')
    } finally { setSerialSaving(false) }
  }

  const handleDeleteSerial = async (id) => {
    if (!confirm('¿Eliminar este número de serie?')) return
    try {
      await serialsAPI.delete(id)
      toast.success('Serie eliminada')
      loadSerials()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'No se puede eliminar')
    }
  }

  // ── Barcode scan handler ─────────────────────────────────────────
  const handleScanDetected = (code) => {
    const trimmed = code.trim()
    // Search by barcode, then by SKU
    const match = products.find(p =>
      p.barcode === trimmed || p.sku === trimmed
    )
    if (match) {
      setForm(f => ({ ...f, product_id: match.id }))
      if (!modal) setModal(true) // open movement modal if not open
      toast.success(`Producto encontrado: ${match.name}`)
    } else {
      toast.error(`Sin coincidencia para: "${trimmed}"`)
    }
  }

  const handleUpdateSerialStatus = async (id, status) => {
    try {
      await serialsAPI.update(id, { status })
      toast.success('Estado actualizado')
      loadSerials()
    } catch (err) {
      toast.error('Error al actualizar')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="page-title">Stock</h1>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setScannerOpen(true)}
            className="btn-secondary flex-1 sm:flex-none justify-center"
            title="Escanear código de barras o QR"
          >
            <ScanLine size={16} /> Escanear
          </button>
          <button onClick={() => setModal(true)} className="btn-primary flex-1 sm:flex-none justify-center">
            <Plus size={16} /> Registrar movimiento
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 p-1 rounded-xl w-full sm:w-fit overflow-x-auto sm:flex-wrap">
        {[
          { key: 'current',   label: 'Inventario actual' },
          { key: 'movements', label: 'Historial' },
          ...(hasFeature('batch_tracking')  ? [{ key: 'batches', label: 'Lotes' }]   : []),
          ...(hasFeature('serial_numbers')  ? [{ key: 'serials', label: 'Seriales' }] : []),
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              'min-h-11 px-4 py-2 rounded-lg text-sm font-semibold transition-all shrink-0',
              activeTab === tab.key
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Inventario actual */}
      {activeTab === 'current' && (
        <div className="space-y-3">
          {/* Buscador de stock */}
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={stockSearch}
              onChange={e => setStockSearch(e.target.value)}
              placeholder="Buscar producto, almacén o ubicación..."
              className="input pl-9 text-sm"
            />
            {stockSearch && (
              <button onClick={() => setStockSearch('')} className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 inline-flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-50" aria-label="Limpiar búsqueda">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Almacén</th>
                <th>Ubicación</th>
                <th>Cantidad</th>
                {hasFeature('expiration_dates') && <th>Vencimiento</th>}
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={6}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                ))
              ) : filteredStockRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-ink-400">
                    <Warehouse size={32} className="mx-auto mb-2 opacity-40" />
                    <p>{stockSearch ? `Sin resultados para "${stockSearch}"` : 'Sin stock registrado'}</p>
                    {!stockSearch && <p className="text-xs mt-1">Registra un movimiento de entrada para comenzar</p>}
                  </td>
                </tr>
              ) : filteredStockRows.map((row, i) => {
                const locationParts = [row.aisle, row.shelf, row.bin].filter(Boolean)
                const locationText = locationParts.join(' · ')
                return (
                <tr key={`${row.product_id}-${row.warehouse_id}-${i}`}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductImage src={row.product_image} className="w-8 h-8 rounded-lg" iconSize={13} />
                      <span className="font-medium text-ink-900 text-sm">{row.product_name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Warehouse size={13} className="text-ink-400" />
                      <span className="text-sm text-ink-600">{row.warehouse_name}</span>
                    </div>
                  </td>
                  <td>
                    {locationText ? (
                      <div className="flex items-center gap-1.5">
                        <MapPin size={12} className="text-brand-500 shrink-0" />
                        <span className="text-xs text-ink-600 font-medium">{locationText}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-300">—</span>
                    )}
                  </td>
                  <td>
                    <span className={clsx('badge', row.current_qty > 0 ? 'badge-green' : 'badge-red')}>
                      {row.current_qty}
                    </span>
                  </td>
                  {hasFeature('expiration_dates') && (
                    <td>
                      {row.nearest_expiry ? (() => {
                        const daysLeft = differenceInDays(parseISO(row.nearest_expiry), new Date())
                        return (
                          <div className="flex items-center gap-1.5">
                            <CalendarX2 size={12} className={clsx(
                              daysLeft <= 3 ? 'text-red-500' : daysLeft <= 7 ? 'text-yellow-500' : 'text-ink-400'
                            )} />
                            <span className={clsx('text-xs font-medium',
                              daysLeft <= 3 ? 'text-red-600' : daysLeft <= 7 ? 'text-yellow-600' : 'text-ink-500'
                            )}>
                              {format(parseISO(row.nearest_expiry), 'd MMM yyyy', { locale: es })}
                              <span className="text-ink-400 ml-1">({daysLeft}d)</span>
                            </span>
                          </div>
                        )
                      })() : <span className="text-xs text-ink-300">—</span>}
                    </td>
                  )}
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditModal(row)}
                        className="btn-ghost p-2 text-ink-500"
                        title="Editar stock y ubicación"
                      >
                        <Pencil size={14} />
                      </button>
                      {hasFeature('variants') && row.product_options?.length > 0 && (
                        <button
                          onClick={() => setVariantStockModal(products.find(p => p.id === row.product_id))}
                          className="btn-ghost p-2 text-brand-500"
                          title="Stock por variante (Color, Talla...)"
                        >
                          <Layers size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Tab: Historial de movimientos */}
      {activeTab === 'movements' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={movementSearch}
                onChange={e => setMovementSearch(e.target.value)}
                placeholder="Buscar por producto, almacén, notas o usuario..."
                className="input pl-9 text-sm w-full"
              />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <label className="text-xs text-ink-400 shrink-0">Desde</label>
              <input
                type="date" value={movementDateFrom}
                onChange={e => setMovementDateFrom(e.target.value)}
                className="input text-sm min-w-0"
              />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <label className="text-xs text-ink-400 shrink-0">Hasta</label>
              <input
                type="date" value={movementDateTo}
                onChange={e => setMovementDateTo(e.target.value)}
                className="input text-sm min-w-0"
              />
            </div>
            {(movementSearch || movementDateFrom || movementDateTo) && (
              <button
                onClick={() => { setMovementSearch(''); setMovementDateFrom(''); setMovementDateTo('') }}
                className="btn-ghost text-xs px-2 py-1.5"
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Almacén</th>
                <th>Cantidad</th>
                <th>Notas</th>
                <th>Usuario</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={7}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                ))
              ) : filteredMovements.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-ink-400">
                  {movements.length === 0 ? 'Sin movimientos' : 'Sin resultados para ese filtro'}
                </td></tr>
              ) : filteredMovements.map(m => {
                const t = typeConfig[m.type] || typeConfig.ajuste
                const TIcon = t.icon
                return (
                  <tr key={m.id}>
                    <td>
                      <span className={`badge ${t.color} flex items-center gap-1 w-fit`}>
                        <TIcon size={11} /> {t.label}
                      </span>
                    </td>
                    <td className="font-medium text-ink-900">{m.products?.name || m.product_id}</td>
                    <td className="text-ink-600">{m.warehouses?.name || '—'}</td>
                    <td>
                      <span className={clsx(
                        'font-bold text-sm',
                        m.type === 'entrada' ? 'text-green-600' :
                        m.type === 'salida' ? 'text-red-600' : 'text-ink-700'
                      )}>
                        {m.type === 'entrada' ? '+' : m.type === 'salida' ? '-' : ''}{m.quantity}
                      </span>
                    </td>
                    <td className="text-xs text-ink-400">{m.notes || '—'}</td>
                    <td className="text-xs text-ink-500">{m.created_by_name || '—'}</td>
                    <td className="text-xs text-ink-400">
                      {format(new Date(m.created_at), 'd MMM HH:mm', { locale: es })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Tab: Lotes */}
      {activeTab === 'batches' && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Código de lote</th>
                <th>Producto</th>
                <th>Almacén</th>
                <th>Restante / Inicial</th>
                <th>Consumido</th>
                <th>Vencimiento</th>
                <th>Recibido</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={7}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                ))
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-400">
                    <Layers size={32} className="mx-auto mb-2 opacity-40" />
                    <p>Sin lotes registrados</p>
                    <p className="text-xs mt-1">Los lotes se crean automáticamente al registrar entradas de stock</p>
                  </td>
                </tr>
              ) : batches.map(b => {
                const expiry = b.expires_at ? parseISO(b.expires_at) : null
                const daysLeft = expiry ? differenceInDays(expiry, new Date()) : null
                const pct = Math.round((b.quantity / (b.initial_quantity || 1)) * 100)
                const unit = b.product_unit || ''
                return (
                  <tr key={b.id}>
                    <td>
                      <span className="font-mono text-xs font-semibold text-ink-700 bg-ink-100 px-2 py-1 rounded-lg">
                        {b.batch_code}
                      </span>
                    </td>
                    <td className="font-medium text-ink-900 text-sm">{b.product_name || '—'}</td>
                    <td className="text-ink-600 text-sm">{b.warehouse_name || '—'}</td>
                    <td>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={clsx('badge', b.quantity > 0 ? 'badge-green' : 'badge-red')}>
                            {b.quantity} {unit}
                          </span>
                          <span className="text-xs text-ink-400">/ {b.initial_quantity} {unit}</span>
                        </div>
                        {/* Barra de progreso */}
                        <div className="w-24 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                          <div
                            className={clsx('h-full rounded-full transition-all',
                              pct > 50 ? 'bg-green-400' : pct > 20 ? 'bg-yellow-400' : 'bg-red-400'
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="text-xs text-ink-500">
                      {b.consumed > 0
                        ? <span className="text-red-500">-{b.consumed} {unit}</span>
                        : <span className="text-ink-300">—</span>
                      }
                    </td>
                    <td>
                      {expiry ? (
                        <div className="flex items-center gap-1.5">
                          <CalendarX2 size={12} className={clsx(
                            daysLeft <= 3 ? 'text-red-500' : daysLeft <= 7 ? 'text-yellow-500' : 'text-ink-400'
                          )} />
                          <span className={clsx('text-xs font-medium',
                            daysLeft <= 3 ? 'text-red-600' : daysLeft <= 7 ? 'text-yellow-600' : 'text-ink-500'
                          )}>
                            {format(expiry, 'd MMM yyyy', { locale: es })}
                            <span className="text-ink-400 ml-1">({daysLeft}d)</span>
                          </span>
                        </div>
                      ) : <span className="text-xs text-ink-300">—</span>}
                    </td>
                    <td className="text-xs text-ink-400">
                      {format(parseISO(b.received_at || b.created_at), 'd MMM yyyy', { locale: es })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Seriales */}
      {activeTab === 'serials' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={serialSearch}
                onChange={e => setSerialSearch(e.target.value)}
                placeholder="Buscar número de serie..."
                className="input pl-8 text-sm"
              />
            </div>
            <select
              value={serialStatusFilter}
              onChange={e => setSerialStatusFilter(e.target.value)}
              className="input text-sm w-40"
            >
              <option value="">Todos los estados</option>
              {Object.entries(SERIAL_STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <button onClick={() => setSerialModal(true)} className="btn-primary">
              <Plus size={14} /> Registrar series
            </button>
          </div>

          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Número de serie</th>
                  <th>Producto</th>
                  <th>Almacén</th>
                  <th>Estado</th>
                  <th>Notas</th>
                  <th>Registrado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {serials.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-ink-400">
                      <Hash size={32} className="mx-auto mb-2 opacity-40" />
                      <p>Sin números de serie registrados</p>
                      <p className="text-xs mt-1">Registra series para llevar trazabilidad individual</p>
                    </td>
                  </tr>
                ) : serials.map(s => {
                  const st = SERIAL_STATUSES[s.status] || SERIAL_STATUSES.in_stock
                  const StIcon = st.icon
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="font-mono text-xs font-bold text-ink-800 bg-ink-100 px-2 py-1 rounded-lg tracking-wider">
                          {s.serial_number}
                        </span>
                      </td>
                      <td className="font-medium text-ink-900 text-sm">
                        {s.products?.name || '—'}
                      </td>
                      <td className="text-ink-600 text-sm">
                        {s.warehouses?.name || '—'}
                      </td>
                      <td>
                        <select
                          value={s.status}
                          onChange={e => handleUpdateSerialStatus(s.id, e.target.value)}
                          className={clsx('text-xs font-semibold border-0 bg-transparent cursor-pointer focus:ring-1 focus:ring-brand-400 rounded px-1', {
                            'text-green-700': s.status === 'in_stock',
                            'text-orange-600': s.status === 'reserved',
                            'text-ink-500': s.status === 'sold',
                            'text-red-600': s.status === 'retired',
                          })}
                        >
                          {Object.entries(SERIAL_STATUSES).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-xs text-ink-400 max-w-[140px] truncate">{s.notes || '—'}</td>
                      <td className="text-xs text-ink-400">
                        {format(parseISO(s.created_at), 'd MMM yyyy', { locale: es })}
                      </td>
                      <td>
                        {s.status === 'in_stock' && (
                          <button
                            onClick={() => handleDeleteSerial(s.id)}
                            className="btn-ghost p-1.5 text-red-400 hover:text-red-600"
                            title="Eliminar"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal registrar series */}
      <Modal open={serialModal} onClose={() => setSerialModal(false)} title="Registrar números de serie">
        <form onSubmit={handleSaveSerials} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Producto *</label>
            <SearchableSelect
              options={products}
              value={serialForm.product_id}
              onChange={v => setSerialForm(f => ({ ...f, product_id: v }))}
              getLabel={p => p.name}
              getValue={p => p.id}
              placeholder="Buscar producto..."
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Almacén *</label>
            <select
              value={serialForm.warehouse_id}
              onChange={e => setSerialForm(f => ({ ...f, warehouse_id: e.target.value }))}
              className="input" required
            >
              <option value="">Seleccionar...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Números de serie *
              <span className="text-ink-400 font-normal normal-case ml-1">(uno por línea o separados por coma)</span>
            </label>
            <textarea
              value={serialForm.serial_numbers}
              onChange={e => setSerialForm(f => ({ ...f, serial_numbers: e.target.value }))}
              className="input font-mono text-sm h-28 resize-none"
              placeholder={"SN-001\nSN-002\nSN-003"}
              required
            />
            {serialForm.serial_numbers && (
              <p className="text-xs text-ink-400 mt-1">
                {serialForm.serial_numbers.split(/[\n,]+/).filter(s => s.trim()).length} serie(s) a registrar
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Notas</label>
            <input
              value={serialForm.notes}
              onChange={e => setSerialForm(f => ({ ...f, notes: e.target.value }))}
              className="input" placeholder="Ej: Lote de importación mayo 2024"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setSerialModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={serialSaving} className="btn-primary flex-1 justify-center">
              {serialSaving ? <Loader2 size={14} className="animate-spin" /> : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal registrar movimiento */}
      <Modal open={modal} onClose={() => setModal(false)} title="Registrar movimiento">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Tipo *</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input">
              {Object.entries(typeConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Producto *
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchableSelect
                  options={products}
                  value={form.product_id}
                  onChange={v => setForm(f => ({ ...f, product_id: v }))}
                  getLabel={p => p.name}
                  getValue={p => p.id}
                  placeholder="Buscar producto..."
                  required
                />
              </div>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="btn-secondary px-3 shrink-0"
                title="Escanear código de barras o QR"
              >
                <ScanLine size={16} />
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Almacén *</label>
            <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} className="input" required>
              <option value="">Seleccionar...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Cantidad {form.type === 'ajuste' ? '(valor final)' : ''} *
            </label>
            <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Notas {form.type === 'salida' ? '*' : ''}
            </label>
            <input
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="input"
              placeholder={form.type === 'salida' ? 'Motivo de la salida (venta, daño, extravío...)' : 'Motivo del movimiento...'}
            />
            {form.type === 'salida' && (
              <p className="text-[11px] text-ink-400 mt-1">
                Obligatorio en salidas — queda registrado en Actividad para trazabilidad ante robos o faltantes.
              </p>
            )}
          </div>
          {hasFeature('expiration_dates') && form.type === 'entrada' && (
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                Fecha de vencimiento <span className="text-ink-400 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                className="input"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          )}
          {hasFeature('batch_tracking') && form.type === 'entrada' && (
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                Código de lote <span className="text-ink-400 font-normal normal-case">(se genera automáticamente si se deja vacío)</span>
              </label>
              <input
                value={form.batch_code}
                onChange={e => setForm(f => ({ ...f, batch_code: e.target.value }))}
                className="input font-mono"
                placeholder="Ej: LOTE-20240115-A1B2"
              />
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal editar stock */}
      <EditStockModal
        open={!!editModal}
        onClose={() => setEditModal(null)}
        item={editModal}
        onSaved={load}
      />

      {/* Scanner de barras/QR */}
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanDetected}
      />

      {/* Modal stock por variante */}
      <VariantStockModal
        open={!!variantStockModal}
        onClose={() => setVariantStockModal(null)}
        product={variantStockModal}
        warehouses={warehouses}
      />
    </div>
  )
}
