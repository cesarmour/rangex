// Meu perfil: identidade, papel e o que cada papel pode fazer no app.
// Papeis: user (atirador), ro (atirador com permissao de Range Officer),
// admin (faz tudo). Promocao de papel e acao administrativa (SQL por enquanto).

const ROLE_META = {
  user: { label: 'Atirador', badge: 'bg-stone-100 text-stone-600 border-stone-200' },
  ro: { label: 'Árbitro/RO', badge: 'bg-gold/10 text-gold border-gold/30' },
  admin: { label: 'Admin', badge: 'bg-gold text-navy border-gold' },
}

const PERMS_BASE = [
  'Registrar treinos com detecção e pontuação automática',
  'Gerenciar o próprio acervo e usar o catálogo global',
  'Duelar 1x1 com atiradores do clube',
  'Criar e participar de campeonatos (submissão auditada)',
  'Lançar habitualidade e emitir o Anexo E do período',
]
const PERMS_RO = [
  'Auditar submissões dos campeonatos onde é Árbitro/RO (detecção + correção manual)',
]
const PERMS_ADMIN = [
  'Auditar submissões de QUALQUER campeonato',
  'Encerrar qualquer campeonato e ver todos (qualquer escopo)',
  'Gerar o pacote mensal do SFPC (habitualidade)',
  'Acessar selfies de presença pra auditoria',
]

function maskCpf(cpf) {
  if (!cpf) return null
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`
}

export default function ProfilePanel({ profile, userInfo, club, onClose }) {
  const role = profile?.role || 'user'
  const meta = ROLE_META[role] || ROLE_META.user
  const perms = [
    ...PERMS_BASE.map((p) => ({ p, on: true })),
    ...PERMS_RO.map((p) => ({ p, on: role === 'ro' || role === 'admin' })),
    ...PERMS_ADMIN.map((p) => ({ p, on: role === 'admin' })),
  ]

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-cream w-full sm:max-w-md sm:rounded-xl rounded-t-xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-navy text-white p-5 sm:rounded-t-xl rounded-t-xl relative">
          <button onClick={onClose} className="absolute right-4 top-4 text-stone-300 hover:text-white text-lg leading-none">×</button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gold text-navy text-lg font-bold flex items-center justify-center">
              {(userInfo?.displayName || '?')[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold truncate">
                {profile?.nome_completo || userInfo?.displayName}
              </div>
              <div className="text-[11px] text-stone-300 truncate">{userInfo?.email}</div>
              <div className="text-[11px] text-stone-400 truncate">{club?.name || 'sem clube'}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className={`text-[10px] tracking-[0.12em] uppercase font-bold px-2 py-1 rounded border ${meta.badge}`}>
              {meta.label}
            </span>
            {profile?.judge_badge && role !== 'admin' && role !== 'ro' && (
              <span className="text-[10px] tracking-[0.12em] uppercase font-semibold px-2 py-1 rounded border bg-gold/10 text-gold border-gold/30">
                Árbitro/RO
              </span>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold mb-2">Permissões</div>
            <div className="space-y-1">
              {perms.map(({ p, on }) => (
                <div key={p} className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 border ${
                  on ? 'bg-white border-stone-200 text-stone-700' : 'bg-stone-50 border-stone-100 text-stone-400'
                }`}>
                  <span className={`mt-0.5 shrink-0 font-bold ${on ? 'text-emerald-600' : 'text-stone-300'}`}>{on ? '✓' : '—'}</span>
                  <span className="leading-relaxed">{p}</span>
                </div>
              ))}
            </div>
          </div>

          {(profile?.cpf || profile?.cr_numero) && (
            <div>
              <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold mb-2">Cadastro de habitualidade</div>
              <div className="text-xs text-stone-700 bg-white border border-stone-200 rounded-md p-3 space-y-1">
                {profile?.nome_completo && <div><span className="text-stone-400">nome civil:</span> {profile.nome_completo}</div>}
                {profile?.cpf && <div><span className="text-stone-400">CPF:</span> {maskCpf(profile.cpf)}</div>}
                {profile?.cr_numero && <div><span className="text-stone-400">CR:</span> {profile.cr_numero}</div>}
                <div><span className="text-stone-400">nível:</span> {profile?.nivel_habitualidade === 'alto_rendimento' ? 'Alto rendimento' : `Nível ${profile?.nivel_habitualidade || '1'}`}</div>
              </div>
              <div className="text-[10px] text-stone-400 mt-1.5">Edição na aba Habitualidade (editar cadastro do atirador).</div>
            </div>
          )}

          <div className="text-[10px] text-stone-400 leading-relaxed">
            Mudança de papel (admin/RO) é ação administrativa. O papel de Árbitro/RO também é concedido automaticamente ao aceitar um convite de campeonato.
          </div>
        </div>
      </div>
    </div>
  )
}
