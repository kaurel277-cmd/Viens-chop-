/** Configuration Tailwind — reprend exactement le thème des pages Viens chop */
module.exports = {
  content: [
    '/home/user/site/*.html',
    '/home/user/site/assets/js/*.js'
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Outfit', 'sans-serif'] },
      colors: {
        brandOrange: '#FF5E1A',
        brandPink: '#FF1E56',
        wa: {
          bg: '#0B141A',
          panel: '#111B21',
          panel2: '#202C33',
          sent: '#005C4B',
          recv: '#202C33',
          green: '#25D366',
          tick: '#53BDEB'
        }
      }
    }
  },
  // Seules les classes réellement construites à la volée et absentes des sources
  safelist: [
    'bg-brand-gradient', 'bg-slate-200', 'bg-orange-100', 'text-orange-700',
    'text-brandPink', 'border-brandPink', 'border-transparent', 'shadow',
    'h-1.5', 'flex-1', 'rounded-full', 'text-white', 'bg-white', 'text-slate-600', 'border-slate-200'
  ],
  corePlugins: { preflight: true }
};
