/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        chrome: {
          bg: "#0a0e14",
          panel: "#0f141b",
          card: "#141b24",
          border: "#1f2733",
          muted: "#5b6772",
          text: "#c7d0d9",
        },
        up: "#26d07c",
        down: "#ff5c5c",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
