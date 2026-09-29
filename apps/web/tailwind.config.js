/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Risk band / severity tokens (PRD 3). Values live in src/index.css as CSS variables so the
        // .rig (dark) theme can swap them: low green, moderate SKY (not yellow), elevated amber,
        // high orange, critical red. Colour is never the only signal (always add the word + icon).
        risk: {
          low: 'var(--color-risk-low)',
          moderate: 'var(--color-risk-moderate)',
          elevated: 'var(--color-risk-elevated)',
          high: 'var(--color-risk-high)',
          critical: 'var(--color-risk-critical)',
        }
      },
    },
  },
  plugins: [],
}
