/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/components/**/*.{ts,tsx}",
    "./src/pages/**/*.{ts,tsx}",
    // 필요한 곳만!  ./src/**/* 로 너무 크게 잡지 말기
  ],
  theme: { extend: {} },
  plugins: [],
}
