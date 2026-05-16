/**
 * pages/admin/ImportPage.jsx
 * Importación masiva de productos desde CSV.
 * El backend procesa la lista y genera embeddings automáticamente.
 */
import { useState, useRef, useCallback } from 'react'
import { reportsAPI } from '../../services/api'
import toast from 'react-hot-toast'
import {
  Upload, FileText, CheckCircle, XCircle,
  AlertTriangle, Download, Loader2, Trash2
} from 'lucide-react'
import clsx from 'clsx'

// Columnas esperadas en el CSV
const EXPECTED_COLS = ['name', 'price', 'unit', 'sku', 'barcode', 'cost_price', 'description', 'tags']

const TEMPLATE_CSV = `name,price,unit,sku,barcode,cost_price,description,tags
Mochila Escolar,350,unidad,MOC-001,,280,Mochila resistente para uso diario,mochilas,escolar
Cuaderno A4,45,unidad,CUA-001,,30,Cuaderno de 100 páginas,,papelería
`

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('El archivo debe tener al menos una fila de datos')

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    // Manejo simple de comas dentro de comillas
    const vals = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || []
    const row = {}
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim()
    })
    if (row.name) rows.push(row)
  }

  return rows
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla_productos.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImportPage() {
  const [preview, setPreview] = useState(null)   // filas parseadas
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const handleFile = useCallback((file) => {
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      toast.error('Solo se aceptan archivos .csv')
      return
    }
    setFileName(file.name)
    setResult(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result)
        setPreview(rows)
        toast.success(`${rows.length} productos leídos`)
      } catch (err) {
        toast.error(err.message || 'Error al leer el archivo')
        setPreview(null)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }, [])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  const handleImport = async () => {
    if (!preview?.length) return
    setImporting(true)
    try {
      const res = await reportsAPI.importProducts(preview)
      setResult(res.data)
      if (res.data.errors?.length === 0) {
        toast.success(`¡${res.data.created} productos importados!`)
      } else {
        toast(`Importación con ${res.data.errors.length} error(es)`, { icon: '⚠️' })
      }
    } catch {
      toast.error('Error al importar. Revisa el formato.')
    } finally {
      setImporting(false)
    }
  }

  const handleReset = () => {
    setPreview(null)
    setFileName('')
    setResult(null)
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Importar productos</h1>
        <button onClick={downloadTemplate} className="btn-ghost text-xs">
          <Download size={14} /> Descargar plantilla CSV
        </button>
      </div>

      {/* Instrucciones */}
      <div className="card p-4 bg-brand-50 border-brand-100">
        <p className="text-sm text-brand-700 font-medium mb-1">¿Cómo importar?</p>
        <ol className="text-xs text-brand-600 space-y-1 list-decimal list-inside">
          <li>Descarga la plantilla CSV y ábrela en Excel o Google Sheets</li>
          <li>Completa los datos (solo <strong>name</strong> y <strong>price</strong> son obligatorios)</li>
          <li>Exporta como CSV y súbelo aquí</li>
          <li>Revisa la vista previa y haz clic en Importar</li>
        </ol>
        <p className="text-xs text-brand-500 mt-2">Máximo 500 productos por archivo · Los productos con SKU repetido se actualizan</p>
      </div>

      {/* Drop zone */}
      {!preview && (
        <div
          className={clsx(
            'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
            dragOver
              ? 'border-brand-400 bg-brand-50'
              : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50'
          )}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload size={36} className={clsx('mx-auto mb-3', dragOver ? 'text-brand-500' : 'text-ink-300')} />
          <p className="font-semibold text-ink-700">Arrastra tu archivo CSV aquí</p>
          <p className="text-sm text-ink-400 mt-1">o haz clic para seleccionarlo</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* Vista previa */}
      {preview && !result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-brand-500" />
              <span className="text-sm font-medium text-ink-700">{fileName}</span>
              <span className="badge badge-green">{preview.length} productos</span>
            </div>
            <button onClick={handleReset} className="btn-ghost text-xs text-ink-400">
              <Trash2 size={13} /> Cambiar archivo
            </button>
          </div>

          {/* Tabla preview */}
          <div className="table-container max-h-72 overflow-y-auto">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Precio</th>
                  <th>Unidad</th>
                  <th>SKU</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((row, i) => (
                  <tr key={i} className={clsx(!row.name && 'bg-red-50')}>
                    <td className="text-ink-400">{i + 1}</td>
                    <td className="font-medium">{row.name || <span className="text-red-500">⚠ requerido</span>}</td>
                    <td>{row.price || '—'}</td>
                    <td>{row.unit || 'unidad'}</td>
                    <td className="font-mono text-ink-400">{row.sku || '—'}</td>
                    <td className="text-ink-400">{row.tags || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 50 && (
            <p className="text-xs text-ink-400 text-center">
              Mostrando 50 de {preview.length} filas
            </p>
          )}

          <button
            onClick={handleImport}
            disabled={importing}
            className="btn-primary w-full justify-center"
          >
            {importing
              ? <><Loader2 size={16} className="animate-spin" /> Importando...</>
              : <><Upload size={16} /> Importar {preview.length} productos</>
            }
          </button>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="space-y-4">
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center border-green-100 bg-green-50">
              <CheckCircle size={22} className="text-green-500 mx-auto mb-1" />
              <p className="text-2xl font-extrabold text-green-700">{result.created}</p>
              <p className="text-xs text-green-600">Creados</p>
            </div>
            <div className="card p-4 text-center border-brand-100 bg-brand-50">
              <CheckCircle size={22} className="text-brand-500 mx-auto mb-1" />
              <p className="text-2xl font-extrabold text-brand-700">{result.updated}</p>
              <p className="text-xs text-brand-600">Actualizados</p>
            </div>
            <div className="card p-4 text-center border-red-100 bg-red-50">
              <XCircle size={22} className="text-red-400 mx-auto mb-1" />
              <p className="text-2xl font-extrabold text-red-600">{result.errors?.length || 0}</p>
              <p className="text-xs text-red-500">Errores</p>
            </div>
          </div>

          {/* Errores detallados */}
          {result.errors?.length > 0 && (
            <div className="card p-4 border-red-100 bg-red-50 space-y-2">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                <AlertTriangle size={15} /> Filas con error
              </p>
              {result.errors.map((err, i) => (
                <p key={i} className="text-xs text-red-600">
                  Fila {err.row}: {err.error}
                </p>
              ))}
            </div>
          )}

          <button onClick={handleReset} className="btn-ghost w-full justify-center">
            <Upload size={14} /> Importar otro archivo
          </button>
        </div>
      )}
    </div>
  )
}
