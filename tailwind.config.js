/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.{html,htm,svg}",
    "./assets/local/*.{html,htm,svg,js}",
    "./assets/reader/*.{html,htm,svg,js}",
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
