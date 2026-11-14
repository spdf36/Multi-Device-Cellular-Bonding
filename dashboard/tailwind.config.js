/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0d14',
        surface: '#121722',
        card: '#161c2b',
        border: '#222b3d',
        cyan: {
          400: '#00f0ff',
          500: '#00c8d7',
        },
      },
    },
  },
  plugins: [],
}
