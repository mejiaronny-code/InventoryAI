/**
 * pages/admin/ReportsPage.jsx
 * Fase 4: Reportes profesionales
 *  - Aging report (stock sin movimiento)
 *  - Valuación de inventario
 *  - Exportar CSV/Excel
 *  - Importar CSV/Excel
 */
import { useState, useEffect, useRef } from 'react'
import { reportsAPI, productsAPI, companiesAPI } from '../../services/api'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import toast from 'react-hot-toast'
import {
  BarChart3, TrendingDown, DollarSign, Upload, Download,
  AlertTriangle, CheckCircle2, Clock, Package, X,
  Loader2, RefreshCw, FileSpreadsheet, FileText, ChevronDown
} from 'lucide-react'
import ProductImage from '../../components/shared/ProductImage'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

// ── Utilidad: exportar a PDF ──────────────────────────────────────────
// Carga una imagen desde URL y la convierte a base64
async function loadImageAsBase64(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// Convierte hex (#rrggbb) a [r, g, b]
function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const val = parseInt(clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean, 16)
  return [(val >> 16) & 255, (val >> 8) & 255, val & 255]
}

async function buildPDFBase(title, companyName, brandColor = '#f97316', logoUrl = '') {
  const [[{ default: jsPDF }, { default: autoTable }], logoBase64] = await Promise.all([
    Promise.all([import('jspdf'), import('jspdf-autotable')]),
    loadImageAsBase64(logoUrl),
  ])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.autoTable = (opts) => autoTable(doc, opts)

  const [r, g, b] = hexToRgb(brandColor)
  const pageW = doc.internal.pageSize.width

  // Encabezado con color de la empresa
  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pageW, 50, 'F')

  // Logo (si existe) — cuadrado de 36×36 a la izquierda
  let textX = 18
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 7, 7, 36, 36)
      textX = 52
    } catch { /* logo inválido — ignorar */ }
  }

  // Título y nombre empresa
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text(title, textX, 24)
  if (companyName) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(companyName, textX, 38)
  }

  // Fecha — derecha
  const dateStr = format(new Date(), "d 'de' MMMM yyyy", { locale: es })
  doc.setFontSize(9)
  doc.text(dateStr, pageW - 18, 24, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  doc._brandRgb = [r, g, b]
  return doc
}

async function exportAgingPDF(data, companyName, brandColor, logoUrl) {
  const doc = await buildPDFBase('Aging Report — Rotación de Inventario', companyName, brandColor, logoUrl)
  const rgb = doc._brandRgb
  doc.autoTable({
    startY: 58,
    head: [['Producto', 'SKU', 'Categoría', 'Stock', 'Último movimiento', 'Días sin mov.', 'Estado']],
    body: data.map(p => [
      p.product_name,
      p.sku || '—',
      p.category_name,
      `${p.total_stock} ${p.unit}`,
      p.last_movement ? format(parseISO(p.last_movement), 'dd/MM/yyyy') : 'Nunca',
      p.days_idle != null ? `${p.days_idle}d` : '—',
      p.bucket,
    ]),
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: { 0: { cellWidth: 140 }, 2: { cellWidth: 90 } },
    margin: { left: 28, right: 28 },
  })
  addPageNumbers(doc)
  doc.save('aging_report.pdf')
}

async function exportValuationPDF(data, formatPrice, companyName, brandColor, logoUrl) {
  const doc = await buildPDFBase('Valuación de Inventario', companyName, brandColor, logoUrl)
  const rgb = doc._brandRgb
  // Resumen total
  doc.setFillColor(254, 243, 199)
  doc.roundedRect(28, 56, 250, 34, 6, 6, 'F')
  doc.setFontSize(9)
  doc.setTextColor(120, 80, 0)
  doc.text('Valor total del inventario', 38, 70)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(180, 100, 0)
  doc.text(formatPrice(data.total_value), 38, 86)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')

  doc.autoTable({
    startY: 102,
    head: [['Producto', 'SKU', 'Categoría', 'Stock', 'Costo unit.', 'Precio venta', 'Margen', 'Valor total']],
    body: data.products.map(p => [
      p.product_name,
      p.sku || '—',
      p.category_name,
      `${p.total_stock} ${p.unit}`,
      p.cost_price > 0 ? formatPrice(p.cost_price) : '—',
      formatPrice(p.sale_price || 0),
      p.margin_pct != null ? `${p.margin_pct}%` : '—',
      formatPrice(p.total_value),
    ]),
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: { 0: { cellWidth: 130 } },
    margin: { left: 28, right: 28 },
  })
  addPageNumbers(doc)
  doc.save('valuacion_inventario.pdf')
}

async function exportProductsPDF(products, formatPrice, companyName, brandColor, logoUrl) {
  const doc = await buildPDFBase('Catálogo de Productos', companyName, brandColor, logoUrl)
  const rgb = doc._brandRgb
  doc.autoTable({
    startY: 58,
    head: [['Producto', 'SKU', 'Precio', 'Costo', 'Unidad', 'Stock', 'Estado']],
    body: products.map(p => [
      p.name,
      p.sku || '—',
      formatPrice(p.price || 0),
      p.cost_price ? formatPrice(p.cost_price) : '—',
      p.unit,
      p.total_stock || 0,
      p.is_active ? 'Activo' : 'Inactivo',
    ]),
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: { 0: { cellWidth: 150 } },
    margin: { left: 28, right: 28 },
  })
  addPageNumbers(doc)
  doc.save('catalogo_productos.pdf')
}

function addPageNumbers(doc) {
  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text(
      `Página ${i} de ${total}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 12,
      { align: 'center' }
    )
  }
}

// ── Utilidad: exportar a CSV ──────────────────────────────────────────
function exportCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(','))
  ]
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Aging buckets ─────────────────────────────────────────────────────
const BUCKETS = [
  { key: '0_30',         label: '0–30 días',   color: 'text-green-600',  bg: 'bg-green-50  border-green-200' },
  { key: '31_60',        label: '31–60 días',  color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' },
  { key: '61_90',        label: '61–90 días',  color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
  { key: '91_180',       label: '91–180 días', color: 'text-red-500',    bg: 'bg-red-50    border-red-200' },
  { key: '180_plus',     label: '+180 días',   color: 'text-red-700',    bg: 'bg-red-100   border-red-300' },
  { key: 'sin_movimiento', label: 'Sin mov.',  color: 'text-ink-400',    bg: 'bg-ink-50    border-ink-200' },
]

// ── Template CSV para importación ─────────────────────────────────────
const IMPORT_TEMPLATE_HEADERS = ['name','sku','barcode','price','cost_price','unit','description','tags']
const IMPORT_TEMPLATE_EXAMPLE = ['Producto Ejemplo','SKU-001','123456789','99.99','60.00','unidad','Descripción del producto','electronica,nuevo']

export default function ReportsPage() {
  const { formatPrice } = useCompanyFeatures()
  const [activeTab, setActiveTab] = useState('aging')
  const [agingData, setAgingData] = useState([])
  const [valuationData, setValuationData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [agingBucket, setAgingBucket] = useState('all')
  const [companyName, setCompanyName] = useState('')
  const [brandColor, setBrandColor] = useState('#f97316')
  const [logoUrl, setLogoUrl] = useState('')
  const [pdfLoading, setPdfLoading] = useState('')   // key del reporte que está generando

  // Import state
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    companiesAPI.getMe().then(r => {
      setCompanyName(r.data?.name || '')
      setBrandColor(r.data?.settings?.primary_color || '#f97316')
      setLogoUrl(r.data?.logo_url || '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeTab === 'aging' && agingData.length === 0) loadAging()
    if (activeTab === 'valuation' && !valuationData) loadValuation()
  }, [activeTab])

  const loadAging = async () => {
    setLoading(true)
    try {
      const res = await reportsAPI.aging()
      setAgingData(res.data || [])
    } catch { toast.error('Error al cargar reporte') }
    finally { setLoading(false) }
  }

  const loadValuation = async () => {
    setLoading(true)
    try {
      const res = await reportsAPI.valuation()
      setValuationData(res.data)
    } catch { toast.error('Error al cargar valuación') }
    finally { setLoading(false) }
  }

  // ── Export aging CSV
  const exportAging = () => {
    const rows = filteredAging.map(p => [
      p.product_name, p.sku || '', p.unit, p.category_name,
      p.total_stock, p.days_idle ?? 'N/A',
      p.last_movement ? format(parseISO(p.last_movement), 'dd/MM/yyyy') : 'Nunca',
      p.bucket,
    ])
    exportCSV('aging_report.csv',
      ['Producto','SKU','Unidad','Categoría','Stock','Días sin movimiento','Último movimiento','Bucket'],
      rows)
  }

  // ── Export valuation CSV
  const exportValuation = () => {
    if (!valuationData) return
    const rows = valuationData.products.map(p => [
      p.product_name, p.sku || '', p.unit, p.category_name,
      p.total_stock, p.cost_price || 0, p.sale_price || 0,
      p.total_value.toFixed(2), p.margin_pct != null ? `${p.margin_pct}%` : 'N/A',
    ])
    exportCSV('valuation_report.csv',
      ['Producto','SKU','Unidad','Categoría','Stock','Costo','Precio venta','Valor total','Margen'],
      rows)
  }

  // ── Export products CSV (all products)
  const exportProducts = async () => {
    try {
      const res = await productsAPI.list()
      const rows = (res.data || []).map(p => [
        p.name, p.sku || '', p.barcode || '', p.price, p.cost_price || '',
        p.unit, p.description || '', (p.tags || []).join(';'),
        p.total_stock || 0, p.is_active ? 'Activo' : 'Inactivo',
      ])
      exportCSV('productos.csv',
        ['Nombre','SKU','Código barras','Precio','Costo','Unidad','Descripción','Tags','Stock total','Estado'],
        rows)
      toast.success('Exportado correctamente')
    } catch { toast.error('Error al exportar') }
  }

  // ── Export PDF handlers
  const handleAgingPDF = async () => {
    if (!agingData.length) { toast.error('Carga el reporte primero'); return }
    setPdfLoading('aging')
    try { await exportAgingPDF(filteredAging.length ? filteredAging : agingData, companyName, brandColor, logoUrl) }
    catch (err) { console.error('PDF aging error:', err); toast.error(`Error PDF: ${err?.message || 'error desconocido'}`) }
    finally { setPdfLoading('') }
  }

  const handleValuationPDF = async () => {
    if (!valuationData) { toast.error('Carga la valuación primero'); return }
    setPdfLoading('valuation')
    try { await exportValuationPDF(valuationData, formatPrice, companyName, brandColor, logoUrl) }
    catch (err) { console.error('PDF valuation error:', err); toast.error(`Error PDF: ${err?.message || 'error desconocido'}`) }
    finally { setPdfLoading('') }
  }

  const handleProductsPDF = async () => {
    setPdfLoading('products')
    try {
      const res = await productsAPI.list()
      await exportProductsPDF(res.data || [], formatPrice, companyName, brandColor, logoUrl)
    } catch (err) {
      console.error('PDF productos error:', err)
      toast.error(`Error al generar PDF: ${err?.message || 'error desconocido'}`)
    }
    finally { setPdfLoading('') }
  }

  // ── Download import template
  const downloadTemplate = () => {
    exportCSV('plantilla_importacion.csv', IMPORT_TEMPLATE_HEADERS, [IMPORT_TEMPLATE_EXAMPLE])
    toast.success('Plantilla descargada')
  }

  // ── Parse CSV file
  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      parseCSV(text)
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  const parseCSV = (text) => {
    setImportResult(null)
    setImportErrors([])
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { toast.error('El archivo está vacío o solo tiene cabecera'); return }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
    const rows = []
    const parseErrors = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      const obj = {}
      headers.forEach((h, idx) => { obj[h] = values[idx] || '' })

      if (!obj.name) { parseErrors.push(`Fila ${i + 1}: nombre vacío`); continue }
      rows.push(obj)
    }

    if (parseErrors.length) {
      setImportErrors(parseErrors)
      toast.error(`${parseErrors.length} fila(s) con errores`)
    }
    setImportRows(rows)
    if (rows.length > 0) toast.success(`${rows.length} producto(s) listos para importar`)
  }

  const handleImport = async () => {
    if (!importRows.length) return
    setImporting(true)
    try {
      const res = await reportsAPI.importProducts(importRows)
      setImportResult(res.data)
      setImportRows([])
      toast.success(`✅ ${res.data.created} creados, ${res.data.updated} actualizados`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al importar')
    } finally { setImporting(false) }
  }

  // Filtered aging
  const filteredAging = agingBucket === 'all'
    ? agingData
    : agingData.filter(p => p.bucket === agingBucket)

  const agingCounts = BUCKETS.reduce((acc, b) => {
    acc[b.key] = agingData.filter(p => p.bucket === b.key).length
    return acc
  }, {})

  const tabs = [
    { key: 'aging',     label: 'Aging Report',  icon: TrendingDown    },
    { key: 'valuation', label: 'Valuación',      icon: DollarSign      },
    { key: 'export',    label: 'Exportar',       icon: Download        },
    { key: 'import',    label: 'Importar',       icon: Upload          },
  ]

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title flex items-center gap-2">
          <BarChart3 size={22} className="text-brand-500" />
          Reportes
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 p-1 rounded-xl w-fit flex-wrap">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all',
              activeTab === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
            )}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── Aging Report ─────────────────────────────────────────────── */}
      {activeTab === 'aging' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-500">
              Productos ordenados por días sin movimiento de stock.
              Identifica inventario muerto o de baja rotación.
            </p>
            <div className="flex gap-2">
              <button onClick={loadAging} className="btn-secondary"><RefreshCw size={13} /></button>
              <button onClick={exportAging} className="btn-secondary" disabled={!agingData.length}>
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button onClick={handleAgingPDF} className="btn-secondary" disabled={!agingData.length || pdfLoading === 'aging'}>
                {pdfLoading === 'aging' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} PDF
              </button>
            </div>
          </div>

          {/* Bucket summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {BUCKETS.map(b => (
              <button
                key={b.key}
                onClick={() => setAgingBucket(agingBucket === b.key ? 'all' : b.key)}
                className={clsx(
                  'p-3 rounded-xl border-2 text-center transition-all',
                  b.bg,
                  agingBucket === b.key && 'ring-2 ring-brand-400 ring-offset-1'
                )}
              >
                <p className={clsx('text-xl font-extrabold', b.color)}>{agingCounts[b.key] || 0}</p>
                <p className="text-[10px] text-ink-500 mt-0.5">{b.label}</p>
              </button>
            ))}
          </div>

          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Stock</th>
                  <th>Último movimiento</th>
                  <th>Días sin mov.</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}><td colSpan={6}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                  ))
                ) : filteredAging.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-10 text-ink-400">Sin datos</td></tr>
                ) : filteredAging.map(p => {
                  const bucket = BUCKETS.find(b => b.key === p.bucket)
                  return (
                    <tr key={p.product_id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <ProductImage src={p.image} className="w-8 h-8 rounded-lg" iconSize={12} />
                          <div>
                            <p className="font-medium text-ink-900 text-sm">{p.product_name}</p>
                            {p.sku && <p className="text-[10px] text-ink-400 font-mono">{p.sku}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="text-xs text-ink-500">{p.category_name}</td>
                      <td>
                        <span className={clsx('badge', p.total_stock > 0 ? 'badge-green' : 'badge-red')}>
                          {p.total_stock} {p.unit}
                        </span>
                      </td>
                      <td className="text-xs text-ink-500">
                        {p.last_movement
                          ? format(parseISO(p.last_movement), 'd MMM yyyy', { locale: es })
                          : <span className="text-ink-300 italic">Nunca</span>}
                      </td>
                      <td>
                        <span className={clsx('font-bold text-sm', bucket?.color)}>
                          {p.days_idle != null ? `${p.days_idle}d` : '—'}
                        </span>
                      </td>
                      <td>
                        <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full border', bucket?.bg, bucket?.color)}>
                          {bucket?.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Valuación ─────────────────────────────────────────────────── */}
      {activeTab === 'valuation' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-500">
              Valor total del inventario basado en precio de costo por producto.
              Agrega el costo en cada producto para habilitar el cálculo.
            </p>
            <div className="flex gap-2">
              <button onClick={loadValuation} className="btn-secondary"><RefreshCw size={13} /></button>
              <button onClick={exportValuation} className="btn-secondary" disabled={!valuationData}>
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button onClick={handleValuationPDF} className="btn-secondary" disabled={!valuationData || pdfLoading === 'valuation'}>
                {pdfLoading === 'valuation' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} PDF
              </button>
            </div>
          </div>

          {valuationData && (
            <div className="card p-5 bg-gradient-to-r from-brand-500 to-brand-600 text-white">
              <p className="text-sm font-medium opacity-80">Valor total del inventario</p>
              <p className="text-4xl font-extrabold mt-1">
                {formatPrice(valuationData.total_value)}
              </p>
              <p className="text-xs opacity-70 mt-1">
                {valuationData.products.filter(p => p.cost_price > 0).length} productos con costo definido
              </p>
            </div>
          )}

          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Stock</th>
                  <th>Costo unit.</th>
                  <th>Precio venta</th>
                  <th>Margen</th>
                  <th>Valor total</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}><td colSpan={7}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                  ))
                ) : !valuationData ? (
                  <tr><td colSpan={7} className="text-center py-10 text-ink-400">Cargando...</td></tr>
                ) : valuationData.products.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-ink-400">Sin productos</td></tr>
                ) : valuationData.products.map(p => (
                  <tr key={p.product_id}>
                    <td>
                      <div>
                        <p className="font-medium text-ink-900 text-sm">{p.product_name}</p>
                        {p.sku && <p className="text-[10px] text-ink-400 font-mono">{p.sku}</p>}
                      </div>
                    </td>
                    <td className="text-xs text-ink-500">{p.category_name}</td>
                    <td>
                      <span className={clsx('badge', p.total_stock > 0 ? 'badge-green' : 'badge-red')}>
                        {p.total_stock} {p.unit}
                      </span>
                    </td>
                    <td className="text-sm font-medium text-ink-700">
                      {p.cost_price > 0
                        ? formatPrice(p.cost_price)
                        : <span className="text-ink-300 text-xs italic">Sin costo</span>}
                    </td>
                    <td className="text-sm text-brand-600 font-semibold">
                      {formatPrice(p.sale_price || 0)}
                    </td>
                    <td>
                      {p.margin_pct != null ? (
                        <span className={clsx('font-bold text-sm', p.margin_pct >= 20 ? 'text-green-600' : 'text-orange-500')}>
                          {p.margin_pct}%
                        </span>
                      ) : <span className="text-ink-300 text-xs">—</span>}
                    </td>
                    <td className="font-bold text-ink-900">
                      {formatPrice(p.total_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Exportar ──────────────────────────────────────────────────── */}
      {activeTab === 'export' && (
        <div className="space-y-4 max-w-xl">
          <p className="text-sm text-ink-500">
            Descarga tus datos en CSV (Excel) o PDF con formato profesional.
          </p>
          {[
            {
              key: 'products',
              title: 'Catálogo de productos',
              desc: 'Todos los productos con precio, costo, stock y tags.',
              icon: Package,
              csvAction: exportProducts,
              pdfAction: handleProductsPDF,
            },
            {
              key: 'aging',
              title: 'Aging Report',
              desc: 'Productos por días sin movimiento de stock.',
              icon: TrendingDown,
              csvAction: () => { if (!agingData.length) { loadAging().then(exportAging) } else exportAging() },
              pdfAction: handleAgingPDF,
            },
            {
              key: 'valuation',
              title: 'Valuación de inventario',
              desc: 'Valor total por producto (requiere precio de costo).',
              icon: DollarSign,
              csvAction: () => { if (!valuationData) { loadValuation().then(exportValuation) } else exportValuation() },
              pdfAction: handleValuationPDF,
            },
          ].map(item => {
            const Icon = item.icon
            const isLoading = pdfLoading === item.key
            return (
              <div key={item.title} className="card p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-brand-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-ink-900 text-sm">{item.title}</p>
                  <p className="text-xs text-ink-400 mt-0.5">{item.desc}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={item.csvAction}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <FileSpreadsheet size={12} /> CSV
                  </button>
                  <button
                    onClick={item.pdfAction}
                    disabled={isLoading}
                    className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} PDF
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Importar ──────────────────────────────────────────────────── */}
      {activeTab === 'import' && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-500">
              Importa productos en lote desde un archivo CSV.
              Si un producto ya existe (mismo SKU) se actualiza.
            </p>
            <button onClick={downloadTemplate} className="btn-secondary text-sm">
              <Download size={13} /> Plantilla CSV
            </button>
          </div>

          {/* Drop zone */}
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-ink-200 hover:border-brand-400 rounded-xl p-8 text-center transition-colors group"
          >
            <Upload size={28} className="mx-auto mb-2 text-ink-300 group-hover:text-brand-500 transition-colors" />
            <p className="font-semibold text-ink-600 group-hover:text-ink-900">
              Haz clic para seleccionar un archivo CSV
            </p>
            <p className="text-xs text-ink-400 mt-1">Columnas: name, sku, barcode, price, cost_price, unit, description, tags</p>
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />

          {/* Errores de parseo */}
          {importErrors.length > 0 && (
            <div className="card p-3 bg-red-50 border border-red-200 space-y-1">
              <p className="text-xs font-bold text-red-700 mb-1">Errores encontrados:</p>
              {importErrors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
            </div>
          )}

          {/* Preview */}
          {importRows.length > 0 && !importResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-ink-800 text-sm">
                  Vista previa — {importRows.length} producto(s)
                </p>
                <button onClick={() => setImportRows([])} className="btn-ghost text-xs text-ink-400">
                  <X size={12} /> Limpiar
                </button>
              </div>
              <div className="table-container max-h-64 overflow-y-auto">
                <table className="table text-xs">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Nombre</th>
                      <th>SKU</th>
                      <th>Precio</th>
                      <th>Costo</th>
                      <th>Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((row, i) => (
                      <tr key={i} className={!row.name ? 'bg-red-50' : ''}>
                        <td className="text-ink-400">{i + 1}</td>
                        <td className="font-medium text-ink-900">{row.name || <span className="text-red-500">⚠ vacío</span>}</td>
                        <td className="font-mono text-ink-500">{row.sku || '—'}</td>
                        <td>{row.price ? formatPrice(row.price) : '—'}</td>
                        <td>{row.cost_price ? formatPrice(row.cost_price) : '—'}</td>
                        <td>{row.unit || 'unidad'}</td>
                      </tr>
                    ))}
                    {importRows.length > 50 && (
                      <tr><td colSpan={6} className="text-center text-ink-400 text-xs py-2">
                        ... y {importRows.length - 50} más
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button onClick={handleImport} disabled={importing} className="btn-primary">
                {importing
                  ? <><Loader2 size={14} className="animate-spin" /> Importando...</>
                  : `Importar ${importRows.length} producto(s)`
                }
              </button>
            </div>
          )}

          {/* Resultado */}
          {importResult && (
            <div className="card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={20} className="text-green-500" />
                <p className="font-bold text-ink-900">Importación completada</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-green-50 rounded-xl">
                  <p className="text-2xl font-extrabold text-green-600">{importResult.created}</p>
                  <p className="text-xs text-ink-400">Creados</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl">
                  <p className="text-2xl font-extrabold text-blue-600">{importResult.updated}</p>
                  <p className="text-xs text-ink-400">Actualizados</p>
                </div>
                <div className="p-3 bg-red-50 rounded-xl">
                  <p className="text-2xl font-extrabold text-red-500">{importResult.errors?.length || 0}</p>
                  <p className="text-xs text-ink-400">Errores</p>
                </div>
              </div>
              {importResult.errors?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold text-red-700">Filas con error:</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">Fila {e.row}: {e.error}</p>
                  ))}
                </div>
              )}
              <button onClick={() => setImportResult(null)} className="btn-secondary w-full">
                Nueva importación
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
