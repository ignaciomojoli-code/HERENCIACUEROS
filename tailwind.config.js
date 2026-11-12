/** Paleta y tipografías del Manual de marca Herencia Cuero 2026. */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        carbon: { DEFAULT: '#15120F', 800: '#221D19', 700: '#2E2823', 600: '#3D3530' },
        marfil: '#EFE6D2',
        crema: { DEFAULT: '#EFE8DA', 50: '#F7F2E8' },
        arena: '#CDB6A9',
        dorado: { DEFAULT: '#C2AC7E', oscuro: '#8C7A52' },
        bordo: { DEFAULT: '#6B1E28', claro: '#F1E1E1' },
        conac: { DEFAULT: '#A65A2E', claro: '#F5E6D9' },
        oferta: '#B8261C',
      },
      fontFamily: {
        titulo: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Jost', 'Futura', 'Montserrat', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { etiqueta: '0.14em' },
    },
  },
  plugins: [],
};
