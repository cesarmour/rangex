import { useState } from 'react'
import { CALIBRES } from '../lib/defaults.js'

export default function SettingsPanel({
  acervo, onAddAcervo, onUpdateAcervo, onRemoveAcervo,
  precos, setPrecos,
  settings, setSettings,
  club, onChangeClub,
  user, onLogout,
  optedInRanking, onToggleRanking,
  nickname, onChangeNickname,
}) {
  const [tab, setTab] = useState('clube')
  const [nickInput, setNickInput] = useState(nickname || '')

  const saveNick = () => {
    if (nickInput !== nickname) onChangeNickname(nickInput.trim() || null)
  }

  return (
    <div className="card">
      <div className="px-4 pt-4 flex gap-1 border-b border-stone-100 overflow-x-auto">
        {['clube', 'acervo', 'preços', 'pix', 'ranking', 'conta'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-semibold tracking-wide uppercase border-b-2 transition flex-shrink-0 ${
              tab === t
                ? 'border-gold text-navy'
                : 'border-transparent text-stone-400 hover:text-stone-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        {tab === 'clube' && (
          <div className="space-y-3">
            <div>
              <div className="label mb-1.5">Clube atual</div>
              <div className="px-3 py-2.5 rounded-md bg-stone-50 border border-stone-200">
                <div className="text-sm font-semibold">
                  {club?.name || 'Nenhum clube selecionado'}
                </div>
                {club?.address && (
                  <div className="text-[11px] text-stone-500 mt-0.5">{club.address}</div>
                )}
              </div>
            </div>
            <button onClick={onChangeClub} className="btn-secondary w-full">
              trocar clube
            </button>
          </div>
        )}

        {tab === 'acervo' && (
          <>
            {acervo.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                <input
                  className="input"
                  value={item.arma}
                  onChange={(e) => onUpdateAcervo(item.id, { arma: e.target.value })}
                  placeholder="Nome da arma"
                />
                <select
                  className="input w-32"
                  value={item.calibre}
                  onChange={(e) => onUpdateAcervo(item.id, { calibre: e.target.value })}
                >
                  {CALIBRES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button onClick={() => onRemoveAcervo(item.id)} className="btn-ghost text-red-600 px-2">×</button>
              </div>
            ))}
            <button onClick={onAddAcervo} className="btn-secondary w-full">
              + adicionar arma ao acervo
            </button>
          </>
        )}

        {tab === 'preços' && (
          <div className="space-y-2">
            {CALIBRES.map((cal) => (
              <div key={cal} className="grid grid-cols-[1fr_auto] gap-2 items-center">
                <span className="text-sm">{cal}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-stone-400">R$</span>
                  <input
                    type="number"
                    step="0.50"
                    className="input w-24 text-right"
                    value={precos[cal] ?? ''}
                    onChange={(e) =>
                      setPrecos({ ...precos, [cal]: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'pix' && (
          <>
            <div>
              <div className="label mb-1.5">Chave PIX</div>
              <input
                className="input font-mono text-xs"
                value={settings.pixKey || ''}
                onChange={(e) => setSettings({ ...settings, pixKey: e.target.value })}
              />
            </div>
            <div>
              <div className="label mb-1.5">Beneficiário</div>
              <input
                className="input"
                value={settings.pixMerchant || ''}
                onChange={(e) => setSettings({ ...settings, pixMerchant: e.target.value.toUpperCase().slice(0, 25) })}
              />
            </div>
            <div>
              <div className="label mb-1.5">Cidade</div>
              <input
                className="input"
                value={settings.pixCity || ''}
                onChange={(e) => setSettings({ ...settings, pixCity: e.target.value.toUpperCase().slice(0, 15) })}
              />
            </div>
          </>
        )}

        {tab === 'ranking' && (
          <div className="space-y-3">
            <div>
              <div className="label mb-2">Participação no ranking</div>
              <button
                onClick={onToggleRanking}
                className={`w-full text-left px-3 py-3 rounded-md border transition ${
                  optedInRanking
                    ? 'bg-green-50 border-green-300 text-green-800'
                    : 'bg-stone-50 border-stone-200 text-stone-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {optedInRanking ? 'Aparece no ranking' : 'Não aparece no ranking'}
                  </span>
                  <span className="text-xs">{optedInRanking ? 'sair' : 'entrar'}</span>
                </div>
                <div className="text-[11px] mt-1 opacity-80">
                  {optedInRanking
                    ? 'Seus dados de treino agregados aparecem no leaderboard.'
                    : 'Quando ativado, seus dados agregados (sem fotos ou detalhes) aparecem pro resto.'}
                </div>
              </button>
            </div>
            {optedInRanking && (
              <div>
                <div className="label mb-1.5">Apelido no ranking (opcional)</div>
                <input
                  className="input"
                  value={nickInput}
                  onChange={(e) => setNickInput(e.target.value.slice(0, 30))}
                  onBlur={saveNick}
                  placeholder={user?.displayName || 'Seu apelido'}
                />
                <div className="text-[10px] text-stone-400 mt-1">
                  Deixe vazio pra usar "{user?.displayName}"
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'conta' && (
          <div className="space-y-3">
            <div>
              <div className="label mb-1.5">Email</div>
              <div className="px-3 py-2.5 rounded-md bg-stone-50 border border-stone-200 text-sm">
                {user?.email}
              </div>
            </div>
            <div>
              <div className="label mb-1.5">Nome</div>
              <div className="px-3 py-2.5 rounded-md bg-stone-50 border border-stone-200 text-sm">
                {user?.displayName || '—'}
              </div>
            </div>
            <button
              onClick={onLogout}
              className="w-full px-4 py-3 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm font-semibold hover:bg-red-100 transition"
            >
              Sair da conta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
