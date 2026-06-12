import { useState, useRef, useEffect } from 'react'

export default function Header({ club, onChangeClub, user, onLogout, onOpenProfile }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Usuário'
  const initial = displayName[0]?.toUpperCase() || '?'

  return (
    <header className="bg-navy text-white safe-top">
      <div className="px-5 pb-3 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-light tracking-[0.08em]">STRIKECORE</span>
          </div>
          <div className="text-[9px] tracking-[0.28em] text-gold uppercase mt-0.5 font-light">
            Shooting Analytics
          </div>
          {club && (
            <button onClick={onChangeClub} className="mt-2 text-left max-w-full">
              <div className="text-[11px] tracking-[0.12em] text-stone-300 uppercase truncate">
                {club.name}
              </div>
              <div className="text-[9px] text-stone-500 mt-0.5 underline">trocar clube</div>
            </button>
          )}
        </div>

        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-9 h-9 rounded-full bg-gold text-navy text-sm font-bold flex items-center justify-center hover:opacity-90 transition"
            aria-label="Menu do usuário"
          >
            {initial}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-11 w-56 bg-white text-stone-800 rounded-md shadow-xl border border-stone-200 overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-stone-100">
                <div className="text-sm font-semibold truncate">{displayName}</div>
                <div className="text-[11px] text-stone-500 truncate">{user?.email}</div>
              </div>
              {onOpenProfile && (
                <button
                  onClick={() => { setMenuOpen(false); onOpenProfile() }}
                  className="w-full text-left px-4 py-3 text-sm text-stone-700 hover:bg-stone-50 transition border-b border-stone-100"
                >
                  Meu perfil
                </button>
              )}
              <button
                onClick={() => { setMenuOpen(false); onLogout() }}
                className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-stone-50 transition"
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="h-[2px] bg-gold" />
    </header>
  )
}
