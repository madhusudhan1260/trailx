/**
 * TRAILX design tokens.
 * Dark, high-contrast palette chosen for sunlight legibility: near-black forest backgrounds,
 * one electric accent (lime) for "go / on route", and safety orange reserved for warnings.
 */
export const C = {
  bg: '#040705',
  bg2: '#07100B',
  forest: '#0C2418',
  forest2: '#123524',
  moss: '#1D4A32',
  lime: '#C6FF3D',
  limeDim: '#8FBF24',
  limeGlow: 'rgba(198,255,61,0.18)',
  orange: '#FF6A1F',
  orangeDim: 'rgba(255,106,31,0.16)',
  red: '#FF3B30',
  text: '#F3F7EE',
  text2: '#B4C2B5',
  muted: '#77857A',
  faint: '#3C4A40',
  glass: 'rgba(255,255,255,0.045)',
  glassStrong: 'rgba(255,255,255,0.08)',
  line: 'rgba(255,255,255,0.09)',
  lineStrong: 'rgba(255,255,255,0.16)',
} as const;

export const F = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodyBold: 'Inter_600SemiBold',
} as const;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const R = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;

/** Minimum touch target for gloved / one-handed outdoor use. */
export const TOUCH = 52;
