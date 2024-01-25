/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.{tmpl,html,htm,svg}",
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
    },
  },
  plugins: [],
};
