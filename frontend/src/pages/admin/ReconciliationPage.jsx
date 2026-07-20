/**
 * pages/admin/ReconciliationPage.jsx
 * Conteo cíclico / reconciliación de inventario.
 * El empleado ingresa el conteo físico real → el sistema muestra discrepancias
 * y genera ajustes automáticos al aprobar.
 */
import { useState, useEffect } from 'react'
import { stockAPI, productsAPI, warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import {
  ClipboardCheck, Warehouse, AlertTriangle, CheckCircle2,
  RefreshCw, ChevronRight, Loader2, X, BarChart3
} from 'lucide-react'
import ProductImage from '../../components/shared/ProductImage'
import clsx from 'clsx'

export default function ReconciliationPage() {
  const [step, setStep] = useState('select')   // select | count | review | done
  const [warehouses, setWarehouses] = useState([])
  const [products, setProducts] = useState([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [counts, setCounts] = useState({})      // { product_id: string_value }
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    Promise.all([warehousesAPI.list(), productsAPI.list()])
      .then(([w, p]) => { setWarehouses(w.data || []); setProducts(p.data || []) })
      .finally(() => setLoading(false))
  }, [])

  // Filas de stock para el almacén seleccionado
  const stockRows = products.flatMap(p =>
    (p.stock_by_warehouse || [])
      .filter(s => s.warehouse_id === selectedWarehouse)
      .map(s => ({
        product_id:    p.id,
        product_name:  p.name,
        product_image: p.images?.[0] || null,
        product_unit:  p.unit,
        system_qty:    s.quantity,
        aisle:         s.aisle,
        shelf:         s.shelf,
        bin:           s.bin,
      }))
  )

  // Discrepancias
  const discrepancies = stockRows.map(row => {
    const physical = parseInt(counts[row.product_id] ?? '')
    const diff = isNaN(physical) ? null : physical - row.system_qty
    return { ...row, physical_qty: physical, diff }
  }).filter(r => r.diff !== null && r.diff !== 0)

  const handleStartCount = () => {
    if (!selectedWarehouse) { toast.error('Selecciona un almacén'); return }
    if (stockRows.length === 0) { toast.error('Sin productos en este almacén'); return }
    // Pre-rellenar con el valor del sistema
    const initial = {}
    stockRows.forEach(r => { initial[r.product_id] = String(r.system_qty) })
    setCounts(initial)
    setStep('count')
  }

  const handleReview = () => {
    const anyFilled = stockRows.some(r => counts[r.product_id] !== undefined && counts[r.product_id] !== '')
    if (!anyFilled) { toast.error('Ingresa al menos un conteo físico'); return }
    setStep('review')
  }

  const handleApply = async () => {
    if (discrepancies.length === 0) { toast('Sin discrepancias que ajustar'); setStep('done'); return }
    setApplying(true)
    try {
      // Crear movimiento de ajuste para cada discrepancia
      const adjustments = discrepancies.map(d =>
        stockAPI.createMovement({
          product_id:   d.product_id,
          warehouse_id: selectedWarehouse,
          type:         'ajuste',
          quantity:     d.physical_qty,
          notes:        `Ajuste por conteo cíclico (sistema: ${d.system_qty} → físico: ${d.physical_qty})`,
        })
      )
      await Promise.all(adjustments)
      toast.success(`✅ ${discrepancies.length} ajuste(s) aplicados`)
      setStep('done')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al aplicar ajustes')
    } finally {
      setApplying(false)
    }
  }

  const reset = () => {
    setStep('select')
    setSelectedWarehouse('')
    setCounts({})
  }

  const whName = warehouses.find(w => w.id === selectedWarehouse)?.name || ''

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="page-title flex items-center gap-2">
          <ClipboardCheck size={22} className="text-brand-500" />
          Conteo Cíclico
        </h1>
        <p className="text-sm text-ink-400 mt-0.5">
          Compara el inventario del sistema con el conteo físico real y aplica ajustes
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-sm overflow-x-auto overscroll-x-contain pb-2 -mb-2" aria-label="Progreso del conteo">
        {[
          { key: 'select', label: '1. Almacén'    },
          { key: 'count',  label: '2. Conteo'     },
          { key: 'review', label: '3. Revisión'   },
          { key: 'done',   label: '4. Completado' },
        ].map((s, i, arr) => (
          <div key={s.key} className="flex items-center gap-2 shrink-0">
            <span className={clsx(
              'px-3 py-2 rounded-full font-semibold text-xs transition-all whitespace-nowrap',
              step === s.key
                ? 'bg-brand-500 text-white'
                : ['done'].includes(step) || arr.findIndex(x => x.key === step) > i
                  ? 'bg-green-100 text-green-700'
                  : 'bg-ink-100 text-ink-400'
            )} aria-current={step === s.key ? 'step' : undefined}>
              {s.label}
            </span>
            {i < arr.length - 1 && <ChevronRight size={14} className="text-ink-300 shrink-0" />}
          </div>
        ))}
      </div>

      {/* Paso 1: Seleccionar almacén */}
      {step === 'select' && (
        <div className="card p-6 space-y-4">
          <h2 className="font-bold text-ink-800">Selecciona el almacén a contar</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-ink-400"><Loader2 size={16} className="animate-spin" /> Cargando...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {warehouses.map(w => {
                  const productCount = products.filter(p => p.stock_by_warehouse?.some(s => s.warehouse_id === w.id)).length
                  return (
                    <button
                      key={w.id}
                      onClick={() => setSelectedWarehouse(w.id)}
                      className={clsx(
                        'p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm',
                        selectedWarehouse === w.id
                          ? 'border-brand-400 bg-brand-50'
                          : 'border-ink-200 hover:border-ink-300'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Warehouse size={16} className={selectedWarehouse === w.id ? 'text-brand-500' : 'text-ink-400'} />
                        <span className="font-semibold text-ink-900">{w.name}</span>
                      </div>
                      <p className="text-xs text-ink-400">{productCount} producto(s) con stock</p>
                      {w.location && <p className="text-xs text-ink-400">{w.location}</p>}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={handleStartCount}
                disabled={!selectedWarehouse}
                className="btn-primary"
              >
                Iniciar conteo <ChevronRight size={14} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Paso 2: Ingresar conteos físicos */}
      {step === 'count' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-ink-800">
              Conteo físico — <span className="text-brand-600">{whName}</span>
            </h2>
            <button onClick={reset} className="btn-ghost text-xs text-ink-400">
              <X size={13} /> Cancelar
            </button>
          </div>
          <p className="text-sm text-ink-500">
            Ingresa la cantidad física real de cada producto. Los valores pre-rellenados son los del sistema.
          </p>

          <div className="card overflow-hidden">
            <div className="divide-y divide-ink-50">
              {stockRows.map(row => {
                const val = counts[row.product_id] ?? ''
                const physical = parseInt(val)
                const diff = isNaN(physical) ? null : physical - row.system_qty
                return (
                  <div key={row.product_id} className={clsx(
                    'grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3',
                    diff !== null && diff !== 0 && 'bg-yellow-50'
                  )}>
                    <ProductImage src={row.product_image} className="w-9 h-9 rounded-lg shrink-0" iconSize={13} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-900 text-sm truncate">{row.product_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-ink-400">
                          Sistema: <strong className="text-ink-600">{row.system_qty} {row.product_unit}</strong>
                        </span>
                        {[row.aisle, row.shelf, row.bin].filter(Boolean).length > 0 && (
                          <span className="text-xs text-brand-600 font-medium">
                            {[row.aisle, row.shelf, row.bin].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-2">
                      <input
                        type="number"
                        min="0"
                        value={val}
                        onChange={e => setCounts(c => ({ ...c, [row.product_id]: e.target.value }))}
                        className={clsx(
                          'input w-24 text-center font-bold',
                          diff !== null && diff > 0 && 'border-green-400 bg-green-50 text-green-700',
                          diff !== null && diff < 0 && 'border-red-400 bg-red-50 text-red-700',
                        )}
                        placeholder="—"
                      />
                      {diff !== null && diff !== 0 && (
                        <span className={clsx('text-xs font-bold w-10 text-right', diff > 0 ? 'text-green-600' : 'text-red-600')}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                      {diff === 0 && (
                        <CheckCircle2 size={16} className="text-green-400 w-10 text-right" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={reset} className="btn-secondary flex-1 sm:flex-none justify-center">Cancelar</button>
            <button onClick={handleReview} className="btn-primary flex-1 sm:flex-none justify-center">
              Ver discrepancias <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Paso 3: Revisión de discrepancias */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-ink-800">Resumen de discrepancias</h2>
            <button onClick={() => setStep('count')} className="btn-ghost text-xs">
              ← Volver a contar
            </button>
          </div>

          {discrepancies.length === 0 ? (
            <div className="card p-8 text-center">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-green-500" />
              <p className="font-bold text-ink-800">¡Inventario correcto!</p>
              <p className="text-sm text-ink-400 mt-1">No se encontraron diferencias entre el sistema y el conteo físico.</p>
              <button onClick={() => setStep('done')} className="btn-primary mt-4">Finalizar</button>
            </div>
          ) : (
            <>
              <div className="card overflow-x-auto overscroll-x-contain">
                <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-100 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-yellow-600" />
                  <span className="text-sm font-semibold text-yellow-700">
                    {discrepancies.length} discrepancia(s) encontrada(s)
                  </span>
                </div>
                <table className="table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Sistema</th>
                      <th>Físico</th>
                      <th>Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discrepancies.map(d => (
                      <tr key={d.product_id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProductImage src={d.product_image} className="w-8 h-8 rounded-lg" iconSize={12} />
                            <span className="font-medium text-ink-900 text-sm">{d.product_name}</span>
                          </div>
                        </td>
                        <td className="text-ink-600 font-medium">{d.system_qty} {d.product_unit}</td>
                        <td className="text-ink-900 font-bold">{d.physical_qty} {d.product_unit}</td>
                        <td>
                          <span className={clsx(
                            'badge font-bold',
                            d.diff > 0 ? 'badge-green' : 'badge-red'
                          )}>
                            {d.diff > 0 ? '+' : ''}{d.diff}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card p-4 bg-ink-50 border border-ink-200">
                <div className="flex items-start gap-3">
                  <BarChart3 size={16} className="text-brand-500 mt-0.5 shrink-0" />
                  <div className="text-sm text-ink-600">
                    <p className="font-semibold text-ink-800 mb-1">Se crearán {discrepancies.length} movimiento(s) de ajuste</p>
                    <p>Cada ajuste fijará el stock al valor físico contado y quedará registrado en el historial de movimientos.</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('count')} className="btn-secondary flex-1 sm:flex-none justify-center">Volver</button>
                <button onClick={handleApply} disabled={applying} className="btn-primary flex-1 sm:flex-none justify-center">
                  {applying
                    ? <><Loader2 size={14} className="animate-spin" /> Aplicando...</>
                    : `Aplicar ${discrepancies.length} ajuste(s)`
                  }
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Paso 4: Completado */}
      {step === 'done' && (
        <div className="card p-10 text-center space-y-4">
          <CheckCircle2 size={48} className="mx-auto text-green-500" />
          <h2 className="text-xl font-extrabold text-ink-900">Conteo completado</h2>
          <p className="text-ink-500 text-sm">
            Los ajustes fueron aplicados correctamente. El inventario del sistema
            ahora refleja el conteo físico realizado.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={reset} className="btn-primary">
              <RefreshCw size={14} /> Nuevo conteo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
