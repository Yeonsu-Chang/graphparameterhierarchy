/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",                 // ← 전체 스캔 (가장 안전)
    // shadcn/ui 등을 별 폴더로 두었다면 거기도 추가:
    // "./components/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  safelist: [
    // 런타임에 조합하는 클래스가 있다면 패턴으로 살려두기
    { pattern: /(bg|text|border)-(slate|zinc|neutral|blue|green|red|amber|violet)-(50|100|200|300|400|500|600|700|800|900)/ },
    { pattern: /(hidden|block|inline-block|flex|grid)/ },
    { pattern: /(items-center|justify-between|justify-center)/ },
    { pattern: /(rounded|rounded-(sm|md|lg|xl|2xl))/ },
    // 필요 없으면 줄여도 됩니다.
  ],
  plugins: [],
}
