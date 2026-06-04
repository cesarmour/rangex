import { useState } from 'react'
import { signUp, signIn, sendPasswordReset } from '../lib/auth.js'
import { isConfigured } from '../lib/supabase.js'

export default function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col bg-navy text-white p-6">
        <div className="max-w-md mx-auto flex-1 flex flex-col justify-center w-full">
          <BrandBlock />
          <div className="p-4 bg-red-900/40 border border-red-900/60 rounded-md text-sm">
            <div className="font-semibold mb-2">Configuração pendente</div>
            <div className="text-stone-300">
              Variáveis <code className="font-mono">VITE_SUPABASE_URL</code> e
              {' '}<code className="font-mono">VITE_SUPABASE_ANON_KEY</code> não configuradas no Netlify.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)
    if (!email || (mode !== 'forgot' && !password)) {
      setError('Preencha todos os campos.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'signup') {
        if (password.length < 6) throw new Error('Senha deve ter ao menos 6 caracteres.')
        await signUp({ email, password, displayName })
        setSuccess('Cadastro criado. Confira seu email pra confirmar.')
      } else if (mode === 'login') {
        await signIn({ email, password })
      } else if (mode === 'forgot') {
        await sendPasswordReset(email)
        setSuccess('Email de recuperação enviado se o endereço existir.')
      }
    } catch (e) {
      setError(translateError(e.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/range-bg.jpeg)' }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-navy/90 via-navy/80 to-navy/95" aria-hidden="true" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 0%, rgba(5,11,21,0.5) 100%)' }}
        aria-hidden="true"
      />

      <div className="relative z-10 min-h-screen flex flex-col text-white">
        <div className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md mx-auto w-full">
          <BrandBlock mode={mode} />

          <div className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="text-[10px] tracking-[0.15em] uppercase text-stone-300">Nome</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full mt-1.5 px-4 py-3 bg-black/30 backdrop-blur-sm border border-white/20 rounded-md text-sm placeholder:text-stone-400 focus:outline-none focus:border-gold text-white"
                  placeholder="Como você quer ser chamado"
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] tracking-[0.15em] uppercase text-stone-300">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                className="w-full mt-1.5 px-4 py-3 bg-black/30 backdrop-blur-sm border border-white/20 rounded-md text-sm placeholder:text-stone-400 focus:outline-none focus:border-gold text-white"
                placeholder="seu@email.com"
                autoComplete="email"
                autoCapitalize="off"
              />
            </div>
            {mode !== 'forgot' && (
              <div>
                <label className="text-[10px] tracking-[0.15em] uppercase text-stone-300">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full mt-1.5 px-4 py-3 bg-black/30 backdrop-blur-sm border border-white/20 rounded-md text-sm placeholder:text-stone-400 focus:outline-none focus:border-gold text-white"
                  placeholder={mode === 'signup' ? 'mínimo 6 caracteres' : '••••••'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-900/40 border border-red-900/60 backdrop-blur-sm rounded-md text-xs">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 bg-green-900/40 border border-green-900/60 backdrop-blur-sm rounded-md text-xs">
                {success}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full px-4 py-4 bg-gold text-navy text-sm font-bold tracking-wide rounded-md hover:opacity-90 disabled:opacity-50 transition active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? <Spinner /> : (
                mode === 'signup' ? 'CRIAR CONTA' :
                mode === 'forgot' ? 'ENVIAR LINK' :
                'ENTRAR'
              )}
            </button>

            <div className="pt-4 flex flex-col gap-2 text-center text-xs">
              {mode === 'login' && (
                <>
                  <button onClick={() => { setMode('signup'); setError(null); setSuccess(null) }} className="text-stone-300 hover:text-white underline">
                    não tem conta? criar
                  </button>
                  <button onClick={() => { setMode('forgot'); setError(null); setSuccess(null) }} className="text-stone-400 hover:text-white underline">
                    esqueci minha senha
                  </button>
                </>
              )}
              {mode === 'signup' && (
                <button onClick={() => { setMode('login'); setError(null); setSuccess(null) }} className="text-stone-300 hover:text-white underline">
                  já tem conta? entrar
                </button>
              )}
              {mode === 'forgot' && (
                <button onClick={() => { setMode('login'); setError(null); setSuccess(null) }} className="text-stone-300 hover:text-white underline">
                  voltar pro login
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BrandBlock({ mode }) {
  return (
    <div className="mb-10">
      <div className="text-4xl font-light tracking-[0.1em] mb-2">STRIKECORE</div>
      <div className="text-[10px] tracking-[0.32em] text-gold uppercase font-light mb-4">
        Shooting Analytics
      </div>
      <div className="h-[2px] w-12 bg-gold mb-3" />
      {mode && (
        <div className="text-[11px] tracking-[0.18em] text-stone-200 uppercase">
          {mode === 'signup' ? 'Crie sua conta' : mode === 'forgot' ? 'Recuperar senha' : 'Entrar'}
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-navy" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function translateError(message) {
  if (!message) return 'Erro desconhecido.'
  const map = {
    'Invalid login credentials': 'Email ou senha inválidos.',
    'User already registered': 'Esse email já tem conta. Tenta fazer login.',
    'Email not confirmed': 'Confirme seu email primeiro (cheque sua caixa de entrada).',
    'Password should be at least 6 characters': 'Senha deve ter ao menos 6 caracteres.',
    'Email rate limit exceeded': 'Muitas tentativas. Aguarde alguns minutos.',
    'Unable to validate email address: invalid format': 'Email inválido.',
  }
  for (const [en, pt] of Object.entries(map)) {
    if (message.includes(en)) return pt
  }
  return message
}
