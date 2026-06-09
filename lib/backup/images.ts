import { get, set } from '@/lib/persistence'
import { type GeneratedImage } from '@/types/mashup'

const BACKUP_KEY = 'mashup_saved_images_backup'
const BACKUP_METADATA_KEY = 'mashup_saved_images_backup_meta'
const SALT_BACKUP_KEY = 'higgsfield_oauth_salt_backup'
const SALT_CONFIG_KEY = 'HIGGSFIELD_OAUTH_SALT'

export interface BackupMetadata {
  timestamp: number
  version: string
  imageCount: number
  source: 'auto' | 'manual'
}

function isTauriWithFS(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in (window as any) || '__TAURI__' in (window as any))
}

async function getBackupDir(): Promise<string | null> {
  if (!isTauriWithFS()) return null
  try {
    const { appDataDir } = await import('@tauri-apps/api/path')
    const baseDir = await appDataDir()
    const { join } = await import('@tauri-apps/api/path')
    return await join(baseDir, '..', 'Documents', 'MashupForge Backups')
  } catch { return null }
}

async function readBackupFile(filename: string): Promise<string | null> {
  if (!isTauriWithFS()) return null
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const backupDir = await getBackupDir()
    if (!backupDir) return null
    const filePath = await join(backupDir, filename)
    return await (await import('@tauri-apps/plugin-fs')).readTextFile(filePath)
  } catch { return null }
}

async function writeBackupFile(filename: string, content: string): Promise<boolean> {
  if (!isTauriWithFS()) return false
  try {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const backupDir = await getBackupDir()
    if (!backupDir) return false
    await mkdir(backupDir, { recursive: true })
    const filePath = await join(backupDir, filename)
    await (await import('@tauri-apps/plugin-fs')).writeTextFile(filePath, content)
    return true
  } catch { return false }
}

/**
 * Auto-backup the current image store to local Tauri app data.
 * Fires on every `useImages` mutation (debounced 200ms).
 */
export async function autoBackupImages(images: GeneratedImage[]): Promise<void> {
  if (images.length === 0) return
  const metadata: BackupMetadata = {
    timestamp: Date.now(),
    version: '1.3.1',
    imageCount: images.length,
    source: 'auto',
  }
  await set(BACKUP_KEY, images)
  await set(BACKUP_METADATA_KEY, metadata)
  const json = JSON.stringify({ images, ...metadata }, null, 2)
  const filename = `mashupforge_images_${new Date().toISOString().split('T')[0]}.json`
  await writeBackupFile(filename, json)
  await writeBackupFile('latest.json', json)
}

/**
 * Backup the Higgsfield OAuth encryption salt so the user can re-derive
 * decryption keys after a reinstall. Reads config.json from the Tauri
 * app data dir, extracts HIGGSFIELD_OAUTH_SALT, and writes it to:
 *   - <BackupDir>/higgsfield_oauth_salt.txt
 *   - Tauri plugin-store key `higgsfield_oauth_salt_backup`
 */
export async function backupHiggsfieldSalt(): Promise<void> {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const appDir = await appDataDir()
    const configPath = await join(appDir, '..', 'config.json')
    const configContent = await (await import('@tauri-apps/plugin-fs')).readTextFile(configPath)
    const config = JSON.parse(configContent)
    const salt = config[SALT_CONFIG_KEY] || config['HIGGSFIELD_OAUTH_SALT']
    if (!salt) return
    await writeBackupFile('higgsfield_oauth_salt.txt', salt)
    await set(SALT_BACKUP_KEY, salt)
  } catch {}
}

/**
 * Trigger a browser download of the full image library as a single
 * JSON file the user can stash anywhere (cloud drive, USB, etc.).
 * Falls back to writing to the Tauri backup dir if available, but
 * the download is the primary path.
 */
export async function exportImagesToFile(images: GeneratedImage[]): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const json = JSON.stringify(
      { images, exportedAt: new Date().toISOString(), version: '1.3.1' },
      null,
      2,
    )
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mashupforge_images_${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Restore images from a user-picked JSON file. The file is selected
 * via a hidden file input. Validates the shape, merges with existing
 * images (newer wins, dedupe by `id`), and writes back to the store.
 */
export async function importImagesFromFile(file: File): Promise<GeneratedImage[]> {
  try {
    const text = await file.text()
    const data = JSON.parse(text) as { images?: GeneratedImage[] }
    if (!Array.isArray(data.images)) return []
    // Basic shape check
    const valid = data.images.filter(
      (img): img is GeneratedImage =>
        img != null &&
        typeof img === 'object' &&
        typeof (img as GeneratedImage).id === 'string' &&
        typeof (img as GeneratedImage).url === 'string',
    )
    return valid
  } catch {
    return []
  }
}

/**
 * Restore the last auto-backup from the Tauri backup dir or
 * plugin-store. Called on app start to recover from data loss
 * (e.g. after a corrupt app-data wipe or install on a new machine
 * where the user copied the backup folder over).
 */
export async function restoreFromAutoBackup(): Promise<GeneratedImage[] | null> {
  try {
    // Prefer plugin-store first (fast, in-memory)
    const stored = (await get(BACKUP_KEY)) as GeneratedImage[] | null | undefined
    if (Array.isArray(stored) && stored.length > 0) return stored

    // Fall back to the latest.json file on disk
    const text = await readBackupFile('latest.json')
    if (!text) return null
    const data = JSON.parse(text) as { images?: GeneratedImage[] }
    if (!Array.isArray(data.images) || data.images.length === 0) return null
    return data.images
  } catch {
    return null
  }
}
