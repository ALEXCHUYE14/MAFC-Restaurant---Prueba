/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{jsx,js,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#060809',
          1: '#0d1014',
          2: '#131720',
          3: '#1a2030',
          4: '#222a3a',
          5: '#2c3548',
        },
        line: { DEFAULT: '#1e2a3a', 2: '#283548', 3: '#344060' },
        amber:   { DEFAULT: '#f5a623', 2: '#e8941a', 3: '#d4820f' },
        flame:   '#ff6b35',
        crimson: { DEFAULT: '#e63946', 2: '#c0303b' },
        emerald: { DEFAULT: '#2ecc71', 2: '#27ae60' },
        sapphire:'#3b9eff',
        violet:  '#9b59b6',
        snow:    '#f0f4ff',
        mist:    '#8899bb',
        fog:     '#4a5870',
        ghost:   '#2a3448',
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        body:    ['"Outfit"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        xl2: '14px',
        xl3: '20px',
      },
      boxShadow: {
        amber: '0 0 30px rgba(245,166,35,0.25)',
        fire:  '0 0 20px rgba(255,107,53,0.2)',
        green: '0 0 16px rgba(46,204,113,0.2)',
        blue:  '0 0 16px rgba(59,158,255,0.2)',
      },
    },
  },
  plugins: [],
}
