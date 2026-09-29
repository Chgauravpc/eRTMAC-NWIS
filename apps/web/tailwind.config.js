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
