import { useRef } from 'react'

export default function PhotoInput({ value, onChange }) {
  const fileRef = useRef(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Read as data URL, then downscale to keep PDF size reasonable
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result
      const compressed = await compressImage(dataUrl, 1800)
      onChange(compressed)
    }
    reader.readAsDataURL(file)
  }

  const remove = () => {
    onChange(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (value) {
    return (
      <div className="relative">
        <img src={value} alt="alvo" className="w-full rounded-md border border-stone-200 object-contain max-h-96 bg-stone-50" />
        <button
          onClick={remove}
          className="absolute top-2 right-2 bg-white/95 backdrop-blur text-xs px-2 py-1 rounded-md border border-stone-200 text-stone-600 hover:text-navy"
        >
          remover
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-stone-200 rounded-md cursor-pointer hover:border-gold hover:bg-stone-50 transition">
        <span className="text-xs font-semibold tracking-wide text-stone-600 uppercase">Câmera</span>
        <span className="text-[10px] text-stone-400 mt-1">tirar foto</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFile}
        />
      </label>
      <label className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-stone-200 rounded-md cursor-pointer hover:border-gold hover:bg-stone-50 transition">
        <span className="text-xs font-semibold tracking-wide text-stone-600 uppercase">Galeria</span>
        <span className="text-[10px] text-stone-400 mt-1">escolher arquivo</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </label>
    </div>
  )
}

// Compress image to a max dimension, preserving aspect ratio.
// Returns a JPEG data URL.
async function compressImage(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      const ratio = Math.min(maxDim / width, maxDim / height, 1)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = dataUrl
  })
}
