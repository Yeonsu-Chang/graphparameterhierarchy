// postcss.config.js
export default {
  plugins: {
    // dev에서는 끔, build(prod)에서만 켜서 로컬 Tailwind로 번들
    ...(process.env.NODE_ENV === 'production' ? { '@tailwindcss/postcss': {} } : {}),
    autoprefixer: {},
  },
}