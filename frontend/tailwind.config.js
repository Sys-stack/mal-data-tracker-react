/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F0F2EC",
        panel: "#FFFFFF",
        "panel-alt": "#F7F8F5",
        ink: "#20241F",
        "ink-soft": "#565B54",
        "ink-faint": "#8B9088",
        line: "#DEE2D9",
        pine: { DEFAULT: "#3A6B5C", soft: "#E4EDE9", dark: "#264A3F" },
        rust: { DEFAULT: "#B5541F", soft: "#F5E5DA" },
        steel: { DEFAULT: "#35618C", soft: "#E1E9F1" },
        mustard: { DEFAULT: "#8A6D00", soft: "#F3EAC9" },
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(32,36,31,0.04), 0 2px 8px rgba(32,36,31,0.05)",
        lifted: "0 4px 16px rgba(32,36,31,0.08)",
      },
    },
  },
  plugins: [],
};
