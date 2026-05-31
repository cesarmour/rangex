# Shooting Range Analytics

App de relatórios de treino de tiro com autenticação, banco de dados e IA.

## Stack

- **Frontend:** React + Vite + Tailwind
- **Auth + DB:** Supabase (Postgres com Row Level Security)
- **Storage de fotos:** Supabase Storage
- **PDF:** jsPDF (client-side)
- **IA de análise:** Claude API via Netlify Function
- **Geolocalização:** Google Places API via Netlify Function

## Setup completo (primeira vez)

### 1. Supabase

1. Crie conta em [supabase.com](https://supabase.com)
2. New project → escolhe região São Paulo
3. Espera ~2 min até inicializar
4. **SQL Editor** (menu lateral) → cole o conteúdo de `supabase-schema.sql` → Run
5. **Authentication → Settings → Email**:
   - Em "Confirm email" você pode desabilitar pra dev rápido (recomendo deixar ativo em produção)
6. **Settings → API**: copia 2 valores
   - `Project URL`
   - `anon public key`

### 2. Netlify env vars

Site configuration → Environment variables. Adicione:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | anon key do Supabase |
| `ANTHROPIC_API_KEY` | sua key do console.anthropic.com |
| `GOOGLE_MAPS_API_KEY` | sua key do Google Cloud (Places API) |

Em scopes, marca **Builds** + **Functions** (VITE_* precisa de Builds porque é injetado no bundle).

### 3. Deploy

Conecta o repo no Netlify ou faz push pro repo conectado. O Vite vai usar as `VITE_*` no build.

## Como funciona

- **Sign up/Login:** email + senha (Supabase Auth)
- **Primeiro login:** acervo é seedado automaticamente com defaults
- **Acervo:** persistido na tabela `acervo`, vinculado ao `user_id`
- **Treinos salvos:** persistidos na tabela `trainings` como jsonb
- **Configurações** (clube, preços, PIX): persistidas no `profiles`
- **Row Level Security:** cada usuário só vê os próprios dados (garantido no banco)

## Dev local

```bash
npm install
# Crie .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev          # frontend só
netlify dev          # frontend + functions (precisa de netlify-cli)
```

## Estrutura

```
g16-app/
├── netlify/functions/
│   ├── analyze-target.js          # Proxy pra Anthropic API
│   └── find-ranges.js             # Proxy pra Google Places API
├── public/
│   ├── favicon.svg                # Crosshair em gold/navy
│   ├── range-bg.jpeg              # Background da splash
│   └── apple-touch-icon.png       # Home screen iOS
├── src/
│   ├── App.jsx                    # Orquestra auth, hydration, UI
│   ├── components/
│   │   ├── AuthScreen.jsx         # Tela de login/signup/forgot
│   │   ├── LoginScreen.jsx        # Splash de seleção de clube
│   │   ├── Header.jsx             # Header com menu de usuário
│   │   ├── SessionCard.jsx        # Card de sessão (foto, IA, etc)
│   │   ├── PhotoInput.jsx         # Upload/captura de foto
│   │   └── SettingsPanel.jsx      # Acervo, preços, PIX, conta
│   ├── lib/
│   │   ├── supabase.js            # Client setup
│   │   ├── auth.js                # signUp, signIn, signOut, session
│   │   ├── db.js                  # CRUD acervo + treinos + fotos
│   │   ├── analyze.js             # Client da função analyze-target
│   │   ├── location.js            # Geolocation + find-ranges
│   │   ├── pix.js                 # Gerador EMV BR Code
│   │   ├── defaults.js            # Acervo + preços default
│   │   └── pdf/
│   │       ├── utils.js
│   │       ├── resumo.js
│   │       ├── completo.js
│   │       └── cobranca.js
│   └── index.css
├── supabase-schema.sql            # SQL pra rodar no Supabase
├── netlify.toml
└── package.json
```

## Custos

- **Supabase Free:** 500MB DB, 1GB storage, 50K MAU. Mais que suficiente pra uso pessoal e pequenos grupos.
- **Anthropic API:** ~R$ 0,10-0,50 por análise de alvo (Sonnet 4.5)
- **Google Places API:** US$ 200/mês de crédito grátis = ~11 mil buscas

## Segurança

- Senhas: gerenciadas pelo Supabase (bcrypt, nunca expostas ao client)
- API keys: ficam server-side nas Netlify Functions
- Banco: Row Level Security garante que cada usuário só acessa seus próprios dados
- Storage de fotos: bucket privado, signed URLs com expiração
