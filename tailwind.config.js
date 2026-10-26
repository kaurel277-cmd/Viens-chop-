/** Viens chop — configuration Tailwind (reconstruite à l'identique) */
module.exports = {
  content: ['./*.html'],
  theme: {
    extend: {
      colors: {
        brandOrange: '#FF6B00',
        brandPink:   '#FF1E56',
        brandRed:    '#E11D48'
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #FF6B00 0%, #FF1E56 100%)'
      }
    }
  },
  safelist: [
    'bg-brand-gradient','text-brand-gradient',
    'bg-brandOrange','bg-brandPink','text-brandOrange','text-brandPink',
    'border-brandOrange','border-brandPink','hover:border-brandPink','focus:border-brandPink',
    'hover:text-brandPink','group-hover:text-brandPink',
    { pattern: /^bg-(orange|emerald|slate|white|black|red|amber|purple|pink|indigo)-(50|100|200|600|700|800|900)$/ },
    { pattern: /^text-(orange|emerald|slate|white|red|amber)=?(50|100|200|600|700|800|900)?$/ },
    'bg-white/10','bg-white/20','bg-white/5','border-white/15','border-white/20','border-white/10',
    'text-white/80','text-white/90','text-white/70','text-white/60','text-white/75','text-white/85',
    'bg-slate-950','bg-slate-900','bg-slate-800','bg-slate-50','bg-slate-100',
    'text-slate-400','text-slate-500','text-slate-600','text-slate-700','text-slate-800','text-slate-900',
    'border-slate-100','border-slate-200','border-slate-700',
    'bg-orange-50','bg-orange-100','bg-emerald-50','text-orange-400','text-orange-700','text-emerald-500','text-emerald-700','border-emerald-200',
    'hidden','block','flex','grid','min-w-0','shrink-0','leading-tight','leading-relaxed',
    'blur-[3px]','rounded-[2rem]','rounded-[2.5rem]','text-[10px]','text-[11px]','text-[9px]',
    'scale-100','scale-95','opacity-0','opacity-100','translate-x-0','-translate-x-full'
  ]
};
