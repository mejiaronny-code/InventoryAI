/**
 * services/storage.js
 * Subida de imágenes de productos a Supabase Storage.
 * Bucket: product-images (debe estar creado y ser público en Supabase)
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const BUCKET = 'product-images'

/**
 * Sube una imagen al bucket y retorna la URL pública.
 * @param {File} file - Archivo de imagen
 * @param {string} companyId - UUID de la empresa (para organizar por carpeta)
 * @returns {Promise<string>} URL pública de la imagen
 */
export async function uploadProductImage(file, companyId) {
  if (!file) throw new Error('No file provided')

  const ext = file.name.split('.').pop()
  const filename = `${companyId}/${Date.now()}.${ext}`

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })

  if (error) throw error

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(filename)

  return urlData.publicUrl
}

/**
 * Elimina una imagen del bucket.
 * @param {string} url - URL pública de la imagen
 */
export async function deleteProductImage(url) {
  const path = url.split(`${BUCKET}/`)[1]
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path])
}

/**
 * Sube el logo de una empresa y retorna la URL pública.
 * Usa el mismo bucket product-images en la carpeta logos/
 */
export async function uploadCompanyLogo(file, companyId) {
  if (!file) throw new Error('No file provided')

  const ext = file.name.split('.').pop()
  const filename = `logos/${companyId}.${ext}`

  // upsert: true para reemplazar si ya existe un logo anterior
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    })

  if (error) throw error

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(filename)

  // Forzar cache-bust para que el navegador muestre el nuevo logo
  return `${urlData.publicUrl}?t=${Date.now()}`
}
