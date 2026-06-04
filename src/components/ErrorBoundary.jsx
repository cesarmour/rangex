import { Component } from 'react'

// Without a boundary, any thrown error during render unmounts the whole React
// tree and leaves a blank white page. This catches it, shows the error on screen
// (so it can be reported), and lets the user recover without losing the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary capturou:', error, info)
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    if (!this.state.error) return this.props.children

    const { error, info } = this.state
    const label = this.props.label || 'a tela'
    const msg = (error && (error.message || String(error))) || 'Erro desconhecido'
    const stack = (info && info.componentStack) || (error && error.stack) || ''

    return (
      <div className="m-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <div className="font-semibold mb-1">Algo quebrou ao renderizar {label}.</div>
        <div className="text-xs text-red-800 mb-2">
          O app não fechou. Tire um print desta mensagem pra eu corrigir a causa exata.
        </div>
        <div className="rounded bg-white/70 border border-red-200 p-2 font-mono text-[11px] break-words whitespace-pre-wrap max-h-48 overflow-auto">
          {msg}
          {stack ? `\n${stack}` : ''}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={this.reset}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-navy text-white"
          >
            tentar de novo
          </button>
          <button
            onClick={() => { try { window.location.reload() } catch {} }}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-200 text-stone-700"
          >
            recarregar app
          </button>
        </div>
      </div>
    )
  }
}
