/**
 * pages/admin/ProductsPage.jsx
 * CRUD completo de productos con generación automática de embeddings.
 */
import { useState, useEffect, useCallback } from 'react'
import { productsAPI, categoriesAPI, warehousesAPI, stockAPI, companiesAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import {
  Plus, Search, Pencil, Trash2, Package, X,
  RefreshCw, Loader2, Upload, ImageIcon, Warehouse, Tag,
  QrCode, Printer, ScanLine
} from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import ProductImage from '../../components/shared/ProductImage'
import BarcodeScannerModal from '../../components/shared/BarcodeScannerModal'
import clsx from 'clsx'

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const trimmed = input.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInput('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-ink-200 rounded-xl min-h-[40px] focus-within:border-brand-400 transition-colors">
      {tags.map(tag => (
        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-100 text-brand-700 rounded-lg text-xs font-medium">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter(t => t !== tag))} className="text-brand-400 hover:text-brand-700">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={addTag}
        placeholder={tags.length === 0 ? 'Agregar etiqueta...' : ''}
        className="flex-1 min-w-[100px] bg-transparent outline-none text-xs text-ink-700 placeholder-ink-400"
      />
    </div>
  )
}

// ── ProductOptionsEditor ──────────────────────────────────────────────
function ProductOptionsEditor({ options, onChange, onUploadImage }) {
  const [newTypeName, setNewTypeName] = useState('')

  const addType = () => {
    const name = newTypeName.trim()
    if (!name) return
    if (options.some(o => o.name.toLowerCase() === name.toLowerCase())) return
    onChange([...options, { name, with_images: false, values: [] }])
    setNewTypeName('')
  }

  const updateType = (idx, patch) => {
    onChange(options.map((o, i) => i === idx ? { ...o, ...patch } : o))
  }

  const removeType = (idx) => onChange(options.filter((_, i) => i !== idx))

  const addValue = (typeIdx, label) => {
    if (!label.trim()) return
    const type = options[typeIdx]
    if (type.values.some(v => v.label.toLowerCase() === label.toLowerCase())) return
    const newValues = [...type.values, { label: label.trim(), image: '' }]
    updateType(typeIdx, { values: newValues })
  }

  const removeValue = (typeIdx, valIdx) => {
    const newValues = options[typeIdx].values.filter((_, i) => i !== valIdx)
    updateType(typeIdx, { values: newValues })
  }

  const setValueImage = (typeIdx, valIdx, url) => {
    const newValues = options[typeIdx].values.map((v, i) =>
      i === valIdx ? { ...v, image: url } : v
    )
    updateType(typeIdx, { values: newValues })
  }

  return (
    <div className="space-y-3">
      {options.map((type, typeIdx) => (
        <OptionTypeBlock
          key={typeIdx}
          type={type}
          onUpdate={patch => updateType(typeIdx, patch)}
          onRemove={() => removeType(typeIdx)}
          onAddValue={label => addValue(typeIdx, label)}
          onRemoveValue={valIdx => removeValue(typeIdx, valIdx)}
          onSetValueImage={(valIdx, url) => setValueImage(typeIdx, valIdx, url)}
          onUploadImage={onUploadImage}
        />
      ))}

      <div className="flex gap-2">
        <input
          value={newTypeName}
          onChange={e => setNewTypeName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addType())}
          placeholder="Ej: Color, Talla, Material, Tamaño..."
          className="input text-sm flex-1"
        />
        <button type="button" onClick={addType} className="btn-secondary px-3 text-sm shrink-0">
          <Plus size={14} /> Agregar tipo
        </button>
      </div>
    </div>
  )
}

function OptionTypeBlock({ type, onUpdate, onRemove, onAddValue, onRemoveValue, onSetValueImage, onUploadImage }) {
  const [newVal, setNewVal] = useState('')
  const [uploadingIdx, setUploadingIdx] = useState(null)

  const handleAdd = () => {
    onAddValue(newVal)
    setNewVal('')
  }

  const handleImageUpload = async (valIdx, file) => {
    if (!file) return
    setUploadingIdx(valIdx)
    try {
      const url = await onUploadImage(file)
      onSetValueImage(valIdx, url)
    } catch {
      toast.error('Error al subir imagen')
    } finally {
      setUploadingIdx(null)
    }
  }

  return (
    <div className="border border-ink-200 rounded-xl overflow-hidden">
      {/* Header del tipo */}
      <div className="flex items-center gap-2 px-3 py-2 bg-ink-50 border-b border-ink-100">
        <span className="font-semibold text-sm text-ink-800 flex-1">{type.name}</span>
        <label className="flex items-center gap-1.5 text-xs text-ink-500 cursor-pointer">
          <input
            type="checkbox"
            checked={type.with_images}
            onChange={e => onUpdate({ with_images: e.target.checked })}
            className="w-3.5 h-3.5 rounded"
          />
          Con fotos
        </label>
        <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-600 p-1">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Valores */}
      <div className="p-3 space-y-2">
        {type.values.map((val, valIdx) => (
          <div key={valIdx} className="flex items-center gap-2">
            {type.with_images && (
              <label className="w-8 h-8 rounded-lg border-2 border-dashed border-ink-200 flex items-center justify-center cursor-pointer hover:border-brand-300 shrink-0 overflow-hidden">
                {uploadingIdx === valIdx
                  ? <Loader2 size={12} className="animate-spin text-brand-500" />
                  : val.image
                    ? <img src={val.image} className="w-full h-full object-cover" alt="" />
                    : <ImageIcon size={12} className="text-ink-300" />
                }
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => handleImageUpload(valIdx, e.target.files[0])}
                />
              </label>
            )}
            <span className="flex-1 text-sm text-ink-700 font-medium">{val.label}</span>
            <button type="button" onClick={() => onRemoveValue(valIdx)} className="text-red-400 hover:text-red-600">
              <X size={13} />
            </button>
          </div>
        ))}

        {/* Agregar valor */}
        <div className="flex gap-2 mt-1">
          <input
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
            placeholder={`Ej: ${type.name === 'Color' ? 'Rojo, Azul, Negro' : type.name === 'Talla' ? 'S, M, L, XL' : 'valor...'}`}
            className="input text-xs flex-1"
          />
          <button type="button" onClick={handleAdd} className="btn-ghost px-2 py-1 text-brand-600 text-xs border border-brand-200 rounded-lg hover:bg-brand-50">
            <Plus size={12} /> Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

function UnitsEditor({ baseUnit, units, onChange }) {
  const [newName, setNewName] = useState('')
  const [newFactor, setNewFactor] = useState('')

  const add = () => {
    const name = newName.trim()
    const factor = parseFloat(newFactor)
    if (!name || !factor || factor <= 0) return
    if (units.some(u => u.name === name)) return
    onChange([...units, { name, factor }])
    setNewName('')
    setNewFactor('')
  }

  return (
    <div className="space-y-2">
      {/* Base unit (read-only) */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ink-50 border border-ink-200">
        <span className="text-xs font-semibold text-brand-600 w-16 shrink-0">Base</span>
        <span className="flex-1 text-xs text-ink-700 font-medium">{baseUnit}</span>
        <span className="text-xs text-ink-400">factor: 1</span>
      </div>

      {/* Existing extra units */}
      {units.map((u, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-ink-200">
          <span className="text-xs text-ink-400 w-16 shrink-0">Extra</span>
          <span className="flex-1 text-xs text-ink-700 font-medium">{u.name}</span>
          <span className="text-xs text-ink-500">× {u.factor} {baseUnit}s</span>
          <button
            type="button"
            onClick={() => onChange(units.filter((_, j) => j !== i))}
            className="text-red-400 hover:text-red-600 ml-1"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {/* Add new unit */}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Ej: caja, pack, docena..."
          className="input text-xs flex-1"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <input
          type="number"
          value={newFactor}
          onChange={e => setNewFactor(e.target.value)}
          placeholder="Factor"
          className="input text-xs w-24"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button type="button" onClick={add} className="btn-primary px-3 py-2 text-xs">
          <Plus size={13} />
        </button>
      </div>
      <p className="text-[10px] text-ink-400">Factor = cuántas unidades base contiene. Ej: caja = 12 unidades</p>
    </div>
  )
}

// ── QR Label Modal ────────────────────────────────────────────────────
function QRLabelModal({ open, onClose, product, companySlug }) {
  const [labelCount, setLabelCount] = useState(1)
  if (!open || !product) return null

  // QR encodes the product catalog URL (or barcode if available)
  const qrValue = product.barcode
    ? product.barcode
    : `${window.location.origin}/${companySlug || ''}?search=${encodeURIComponent(product.name)}`

  const printLabels = (count) => {
    const canvas = document.getElementById('qr-print-canvas')
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')

    const labelHtml = Array.from({ length: count }, () => `
      <div class="label">
        <img src="${dataUrl}" alt="QR" />
        <p class="name">${product.name.replace(/</g, '&lt;')}</p>
        ${product.sku ? `<p class="sub">SKU: ${product.sku}</p>` : ''}
        ${product.barcode ? `<p class="sub">${product.barcode}</p>` : ''}
      </div>`).join('')

    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { toast.error('Permite ventanas emergentes para imprimir'); return }
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Etiquetas — ${product.name}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Arial,sans-serif;background:#fff}
        .grid{display:flex;flex-wrap:wrap;gap:6mm;padding:10mm}
        .label{
          width:55mm;border:1px solid #ccc;border-radius:3mm;
          padding:4mm;display:flex;flex-direction:column;
          align-items:center;page-break-inside:avoid
        }
        .label img{width:90px;height:90px}
        .name{font-size:8pt;font-weight:700;text-align:center;margin-top:3mm;line-height:1.2}
        .sub{font-size:7pt;color:#555;margin-top:1mm;font-family:monospace}
        @media print{body{margin:0}.grid{padding:5mm}}
      </style>
    </head><body>
      <div class="grid">${labelHtml}</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}<\/script>
    </body></html>`)
    win.document.close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-xs">
        <div className="flex items-center justify-between p-5 border-b border-ink-100">
          <h3 className="text-base font-bold text-ink-900 flex items-center gap-2">
            <QrCode size={18} className="text-brand-500" /> Etiqueta QR
          </h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          {/* QR Code */}
          <div className="p-3 bg-white border-2 border-ink-100 rounded-2xl shadow-sm">
            <QRCodeCanvas
              id="qr-print-canvas"
              value={qrValue}
              size={160}
              level="M"
              includeMargin={false}
            />
          </div>

          {/* Product info */}
          <div className="text-center">
            <p className="font-bold text-ink-900 text-sm">{product.name}</p>
            {product.sku && <p className="text-xs text-ink-400 font-mono mt-0.5">SKU: {product.sku}</p>}
            {product.barcode && <p className="text-xs text-ink-400 font-mono mt-0.5">{product.barcode}</p>}
            <p className="text-[10px] text-ink-300 mt-1.5 max-w-[200px] break-all">{qrValue}</p>
          </div>

          {/* Quantity selector + print */}
          <div className="w-full pt-3 border-t border-ink-100 space-y-3">
            <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide text-center">
              Cantidad de etiquetas
            </p>
            <div className="grid grid-cols-4 gap-2">
              {[1, 4, 9, 16].map(n => (
                <button
                  key={n}
                  onClick={() => setLabelCount(n)}
                  className={clsx(
                    'py-2 rounded-xl text-sm font-semibold border transition-colors',
                    labelCount === n
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-ink-700 border-ink-200 hover:border-brand-300'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              onClick={() => printLabels(labelCount)}
              className="btn-primary w-full justify-center"
            >
              <Printer size={15} />
              Imprimir {labelCount} {labelCount === 1 ? 'etiqueta' : 'etiquetas'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProductForm({ product, categories, warehouses, onSave, onClose }) {
  const { hasFeature } = useCompanyFeatures()
  const [form, setForm] = useState({
    name: product?.name || '',
    description: product?.description || '',
    use_cases: product?.use_cases || '',
    sku: product?.sku || '',
    barcode: product?.barcode || '',
    price: product?.price || 0,
    cost_price: product?.cost_price || '',
    unit: product?.unit || 'unidad',
    category_id: product?.category_id || '',
    reservation_time_hours: product?.reservation_time_hours || '',
    attributes: JSON.stringify(product?.attributes || {}, null, 2),
    images: product?.images || [],
    tags: product?.tags || [],
    units: product?.units || [],
    variant_attributes: product?.variant_attributes || {},
    parent_product_id: product?.parent_product_id || null,
    product_options: product?.product_options || [],
  })
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false)
  const [stockData, setStockData] = useState({ warehouse_id: '', quantity: '', min_stock_alert: 5 })
  const [loading, setLoading] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)

  const onDropImage = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0]
    if (!file) return
    setUploadingImg(true)
    try {
      const res = await productsAPI.uploadImage(file)
      setForm(f => ({ ...f, images: [...f.images, res.data.url] }))
    } catch {
      toast.error('Error al subir imagen')
    } finally { setUploadingImg(false) }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropImage,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
  })

  const removeImage = (idx) => setForm(f => ({ ...f, images: f.images.filter((_, i) => i !== idx) }))

  const uploadOptionImage = async (file) => {
    const res = await productsAPI.uploadImage(file)
    return res.data.url
  }

  const handleChange = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price) || 0,
        cost_price: form.cost_price !== '' ? parseFloat(form.cost_price) || null : null,
        category_id: form.category_id || null,
        reservation_time_hours: form.reservation_time_hours ? parseInt(form.reservation_time_hours) : null,
        attributes: (() => { try { return JSON.parse(form.attributes) } catch { return {} } })(),
        tags: form.tags,
        units: form.units,
        variant_attributes: form.variant_attributes,
        parent_product_id: form.parent_product_id || null,
      }

      let saved
      if (product?.id) {
        saved = await productsAPI.update(product.id, payload)
      } else {
        saved = await productsAPI.create(payload)
      }

      // Agregar stock inicial si se especificó
      if (!product?.id && stockData.warehouse_id && stockData.quantity > 0) {
        await stockAPI.createMovement({
          product_id: saved.data.id,
          warehouse_id: stockData.warehouse_id,
          type: 'entrada',
          quantity: parseInt(stockData.quantity),
          notes: 'Stock inicial',
        })
      }

      toast.success(product?.id ? 'Producto actualizado' : 'Producto creado con embedding ✅')
      onSave()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
          <input value={form.name} onChange={e => handleChange('name', e.target.value)} className="input" required />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Precio de venta</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.price}
            onChange={e => handleChange('price', e.target.value)}
            onFocus={e => { if (parseFloat(e.target.value) === 0) e.target.select() }}
            className="input"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Precio de costo <span className="text-ink-300 font-normal normal-case">(opcional — usado en reportes de valuación)</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.cost_price}
            onChange={e => handleChange('cost_price', e.target.value)}
            onFocus={e => { if (parseFloat(e.target.value) === 0) e.target.select() }}
            placeholder="0.00"
            className="input"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Unidad</label>
          <input value={form.unit} onChange={e => handleChange('unit', e.target.value)} className="input" placeholder="unidad, kg, m²..." />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">SKU</label>
          <input value={form.sku} onChange={e => handleChange('sku', e.target.value)} className="input font-mono" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Código de barras</label>
          <div className="flex gap-2">
            <input
              value={form.barcode}
              onChange={e => handleChange('barcode', e.target.value)}
              className="input font-mono flex-1"
              placeholder="Escribe o escanea..."
            />
            <button
              type="button"
              onClick={() => setBarcodeScanOpen(true)}
              className="btn-secondary px-3 shrink-0"
              title="Escanear con la cámara"
            >
              <ScanLine size={16} />
            </button>
          </div>
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Categoría</label>
          <select value={form.category_id} onChange={e => handleChange('category_id', e.target.value)} className="input">
            <option value="">Sin categoría</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Descripción <span className="text-brand-500">(afecta búsqueda semántica)</span>
          </label>
          <textarea value={form.description} onChange={e => handleChange('description', e.target.value)} rows={2} className="input resize-none" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Casos de uso <span className="text-brand-500">(afecta búsqueda semántica)</span>
          </label>
          <textarea value={form.use_cases} onChange={e => handleChange('use_cases', e.target.value)} rows={2} className="input resize-none" placeholder="¿Para qué se usa este producto?" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Tiempo de reserva (horas) <span className="text-ink-400 font-normal normal-case">· opcional, sobreescribe el de la categoría</span>
          </label>
          <input type="number" min="1" value={form.reservation_time_hours} onChange={e => handleChange('reservation_time_hours', e.target.value)} className="input" placeholder="Ej: 48 — deja vacío para usar el de la categoría" />
        </div>
      </div>

      {/* Tags */}
      {hasFeature('tags') && (
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Etiquetas <span className="text-ink-400 font-normal normal-case">· Enter o coma para agregar</span>
          </label>
          <TagInput tags={form.tags} onChange={v => handleChange('tags', v)} />
        </div>
      )}


      {/* Multi-unidad */}
      {hasFeature('multi_unit') && (
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Unidades de medida <span className="text-ink-400 font-normal normal-case">· unidades adicionales de venta</span>
          </label>
          <UnitsEditor
            baseUnit={form.unit || 'unidad'}
            units={form.units}
            onChange={v => handleChange('units', v)}
          />
        </div>
      )}

      {/* Opciones de producto (Color, Talla, etc.) */}
      {hasFeature('variants') && (
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Opciones <span className="text-ink-400 font-normal normal-case">· Color, Talla, Material, etc. (opcional)</span>
          </label>
          <ProductOptionsEditor
            options={form.product_options}
            onChange={v => handleChange('product_options', v)}
            onUploadImage={uploadOptionImage}
          />
        </div>
      )}

      {/* Imágenes */}
      <div>
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-2">
          Imágenes <span className="text-brand-500">(la IA las usa para reconocer fotos)</span>
        </label>
        <div className="flex gap-2 flex-wrap mb-2">
          {form.images.map((url, i) => (
            <div key={i} className="relative group w-16 h-16">
              <img src={url} className="w-16 h-16 rounded-xl object-cover border border-ink-100" alt="" />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={11} className="text-white" />
              </button>
            </div>
          ))}
          <div
            {...getRootProps()}
            className={`w-16 h-16 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
              isDragActive ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50'
            }`}
          >
            <input {...getInputProps()} />
            {uploadingImg
              ? <Loader2 size={16} className="text-brand-500 animate-spin" />
              : <Upload size={16} className="text-ink-400" />
            }
          </div>
        </div>
        <p className="text-xs text-ink-400">PNG, JPG, WEBP · máx 5MB por imagen</p>
      </div>

      {/* Stock inicial (solo creación) */}
      {!product?.id && warehouses.length > 0 && (
        <div className="border border-brand-100 bg-brand-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-brand-700 uppercase tracking-wide">Stock inicial (opcional)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-ink-500 block mb-1">Almacén</label>
              <select value={stockData.warehouse_id} onChange={e => setStockData(s => ({ ...s, warehouse_id: e.target.value }))} className="input text-sm">
                <option value="">Seleccionar...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-500 block mb-1">Cantidad</label>
              <input type="number" min="1" value={stockData.quantity} onChange={e => setStockData(s => ({ ...s, quantity: e.target.value }))} placeholder="0" className="input text-sm" />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancelar</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Guardar'}
        </button>
      </div>

      {/* Scanner de código de barras */}
      <BarcodeScannerModal
        open={barcodeScanOpen}
        onClose={() => setBarcodeScanOpen(false)}
        onDetected={(code) => {
          handleChange('barcode', code)
          setBarcodeScanOpen(false)
        }}
      />
    </form>
  )
}

function StockDetailModal({ open, onClose, product, warehouses }) {
  if (!open || !product) return null
  const rows = product.stock_by_warehouse || []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-sm">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <div>
            <h3 className="text-base font-bold text-ink-900">Stock por almacén</h3>
            <p className="text-xs text-ink-400 mt-0.5">{product.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">
          {rows.length === 0 ? (
            <div className="text-center py-8 text-ink-400">
              <Warehouse size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Sin stock registrado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const wh = warehouses.find(w => w.id === r.warehouse_id)
                return (
                  <div key={r.warehouse_id} className="flex items-center justify-between p-3 rounded-xl bg-ink-50 border border-ink-100">
                    <div className="flex items-center gap-2">
                      <Warehouse size={14} className="text-brand-500" />
                      <span className="text-sm font-medium text-ink-700">{wh?.name || r.warehouse_id}</span>
                    </div>
                    <span className={clsx('badge', r.quantity > 0 ? 'badge-green' : 'badge-red')}>
                      {r.quantity}
                    </span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between p-3 rounded-xl bg-brand-50 border border-brand-100 mt-3">
                <span className="text-sm font-bold text-brand-700">Total</span>
                <span className="badge badge-orange">{product.total_stock || 0}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProductsPage() {
  const { user } = useAuth()
  const { hasFeature, formatPrice } = useCompanyFeatures()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'create' | product obj
  const [stockModal, setStockModal] = useState(null) // product obj para ver desglose
  const [confirmDelete, setConfirmDelete] = useState(null) // null | { id, name }
  const [qrModal, setQrModal] = useState(null) // null | product obj
  const [companySlug, setCompanySlug] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      productsAPI.list({ search }),
      categoriesAPI.list(),
      warehousesAPI.list(),
    ]).then(([p, c, w]) => {
      setProducts(p.data)
      setCategories(c.data)
      setWarehouses(w.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    companiesAPI.getMe().then(r => { if (r.data?.slug) setCompanySlug(r.data.slug) }).catch(() => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [search])

  const doDelete = async () => {
    await productsAPI.delete(confirmDelete.id)
    toast.success('Producto desactivado')
    setConfirmDelete(null)
    load()
  }

  const handleRegenerateEmbedding = async (id) => {
    toast.promise(productsAPI.regenerateEmbedding(id), {
      loading: 'Regenerando embedding...',
      success: 'Embedding actualizado ✅',
      error: 'Error al regenerar',
    })
  }

  const isAdmin = user?.role === 'admin'

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Productos</h1>
        {isAdmin && (
          <button onClick={() => setModal('create')} className="btn-primary">
            <Plus size={16} /> Nuevo producto
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU, descripción..."
            className="input pl-10"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700">
              <X size={14} />
            </button>
          )}
        </div>
        {!loading && (
          <span className="text-sm text-ink-400 shrink-0">
            {products.length} resultado{products.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>Estado</th>
              {isAdmin && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
              ))
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-ink-400">Sin productos</td></tr>
            ) : products.map(p => {
              const cat = categories.find(c => c.id === p.category_id)
              return (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductImage src={p.images?.[0]} className="w-9 h-9 rounded-lg" iconSize={14} />
                      <div>
                        <p className="font-semibold text-ink-900 text-sm">{p.name}</p>
                        <p className="text-xs text-ink-400">{p.unit}</p>
                        {hasFeature('tags') && p.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded text-[10px] font-medium border border-brand-100">
                                <Tag size={8} /> {tag}
                              </span>
                            ))}
                            {p.tags.length > 3 && <span className="text-[10px] text-ink-400">+{p.tags.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td><span className="font-mono text-xs text-ink-500">{p.sku || '—'}</span></td>
                  <td><span className="text-xs text-ink-600">{cat?.name || '—'}</span></td>
                  <td><span className="font-semibold text-brand-600">{formatPrice(p.price)}</span></td>
                  <td>
                    <button
                      onClick={() => setStockModal(p)}
                      title="Ver stock por almacén"
                      className={clsx('badge cursor-pointer hover:opacity-80 transition-opacity', (p.total_stock || 0) > 0 ? 'badge-green' : 'badge-red')}
                    >
                      {p.total_stock || 0}
                    </button>
                  </td>
                  <td>
                    <span className={clsx('badge', p.is_active ? 'badge-green' : 'badge-gray')}>
                      {p.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setModal(p)} className="btn-ghost p-2 text-ink-500" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setQrModal(p)} className="btn-ghost p-2 text-brand-500" title="Imprimir etiqueta QR">
                          <QrCode size={14} />
                        </button>
                        <button onClick={() => handleRegenerateEmbedding(p.id)} className="btn-ghost p-2 text-ink-400" title="Regenerar embedding">
                          <RefreshCw size={14} />
                        </button>
                        <button onClick={() => setConfirmDelete({ id: p.id, name: p.name })} className="btn-ghost p-2 text-red-500 hover:bg-red-50" title="Desactivar">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal editar/crear */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Nuevo producto' : `Editar: ${modal?.name}`}
      >
        <ProductForm
          product={modal === 'create' ? null : modal}
          categories={categories}
          warehouses={warehouses}
          onSave={() => {
            setModal(null)
            load()
          }}
          onClose={() => setModal(null)}
        />
      </Modal>

      {/* Modal confirmación eliminar */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Confirmar desactivación">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            ¿Desactivar <strong className="text-ink-900">"{confirmDelete?.name}"</strong>?
            El producto dejará de aparecer en el catálogo.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={doDelete} className="btn-danger flex-1 justify-center">Desactivar</button>
          </div>
        </div>
      </Modal>

      {/* Modal stock por almacén */}
      <StockDetailModal
        open={!!stockModal}
        onClose={() => setStockModal(null)}
        product={stockModal}
        warehouses={warehouses}
      />

      {/* Modal QR / etiquetas */}
      <QRLabelModal
        open={!!qrModal}
        onClose={() => setQrModal(null)}
        product={qrModal}
        companySlug={companySlug}
      />
    </div>
  )
}
