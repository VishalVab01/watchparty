/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: { colors: { paper: '#f4f2e9', ink: '#17231d', leaf: '#b7cd75', clay: '#dc6548' }, fontFamily: { sans: ['Manrope', 'sans-serif'], mono: ['DM Mono', 'monospace'] } } },
  plugins: [],
};
