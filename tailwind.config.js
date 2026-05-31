/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A1628',
          900: '#050B15',
          800: '#0A1628',
          700: '#16243A',
        },
        gold: {
          DEFAULT: '#B8923F',
          light: '#D4B068',
          dark: '#937030',
        },
        dark: '#0a0a0a',
        'red-tactical': '#E63946',
        'orange-tactical': '#F4A261',
        cream: '#FAFAF7',
        stone: {
          50: '#FAFAF7',
          100: '#F4F2EC',
          200: '#E6E3DA',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', 'sans-serif'],
        light: ['Montserrat-Light', 'Montserrat', 'sans-serif'],
        display: ['Oswald', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tight: '-0.015em',
      },
    },
  },
  plugins: [],
}
