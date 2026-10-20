/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        paper: {
          50: '#FAF8F5',
          100: '#F3EFE6',
          200: '#E6DFD1',
          300: '#D4C8B4',
          800: '#292524',
          900: '#1C1917',
        },
        terracotta: {
          50: '#FEF2F0',
          100: '#FDE3DF',
          500: '#D95338',
          600: '#C84B31',
          700: '#A63A22',
        }
      }
    },
  },
  plugins: [],
}
