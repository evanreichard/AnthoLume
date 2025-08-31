/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.{tmpl,html,htm,svg}",
    "./web/**/*.go",
    "./assets/local/*.{html,htm,svg,js}",
    "./assets/reader/*.{html,htm,svg,js}",
  ],
  safelist: [
    "peer-checked/All:block",
    "peer-checked/Year:block",
    "peer-checked/Month:block",
    "peer-checked/Week:block",
  ],
  theme: {
    extend: {
      minWidth: {
        40: "10rem",
      },
      animation: {
        notification:
          "slideIn 0.25s ease-out forwards, slideOut 0.25s ease-out 4.5s forwards",
      },
      keyframes: {
        slideIn: {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        slideOut: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
    },
  },
  plugins: [],
};
