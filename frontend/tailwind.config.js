export default {
  content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        broad: {
          navy: '#07192b',
          teal: '#087f8c',
          cyan: '#14b8b8',
          soft: '#f4f7fb'
        }
      },
      boxShadow: {
        enterprise: '0 14px 40px rgba(17, 32, 52, 0.08)'
      },
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', 'Inter', 'IBM Plex Sans', 'Arial', 'sans-serif']
      }
    }
  },
  plugins: []
};
