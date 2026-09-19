import typography from "@tailwindcss/typography";
import containerQueries from "@tailwindcss/container-queries";
import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["index.html", "src/**/*.{js,ts,jsx,tsx,html,css}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "oklch(var(--border))",
        input: "oklch(var(--input))",
        ring: "oklch(var(--ring) / <alpha-value>)",
        background: "oklch(var(--background))",
        foreground: "oklch(var(--foreground))",
        primary: {
          DEFAULT: "oklch(var(--primary) / <alpha-value>)",
          foreground: "oklch(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "oklch(var(--secondary) / <alpha-value>)",
          foreground: "oklch(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "oklch(var(--destructive) / <alpha-value>)",
          foreground: "oklch(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "oklch(var(--muted) / <alpha-value>)",
          foreground: "oklch(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "oklch(var(--accent) / <alpha-value>)",
          foreground: "oklch(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "oklch(var(--popover))",
          foreground: "oklch(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "oklch(var(--card))",
          foreground: "oklch(var(--card-foreground))",
        },
        chart: {
          1: "oklch(var(--chart-1))",
          2: "oklch(var(--chart-2))",
          3: "oklch(var(--chart-3))",
          4: "oklch(var(--chart-4))",
          5: "oklch(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "oklch(var(--sidebar))",
          foreground: "oklch(var(--sidebar-foreground))",
          primary: "oklch(var(--sidebar-primary))",
          "primary-foreground": "oklch(var(--sidebar-primary-foreground))",
          accent: "oklch(var(--sidebar-accent))",
          "accent-foreground": "oklch(var(--sidebar-accent-foreground))",
          border: "oklch(var(--sidebar-border))",
          ring: "oklch(var(--sidebar-ring))",
        },
        success: {
          DEFAULT: "oklch(var(--success) / <alpha-value>)",
          foreground: "oklch(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "oklch(var(--warning) / <alpha-value>)",
          foreground: "oklch(var(--warning-foreground))",
        },
        hud: {
          DEFAULT: "oklch(var(--hud-bg) / <alpha-value>)",
          foreground: "oklch(var(--hud-fg))",
          muted: "oklch(var(--hud-muted))",
          border: "oklch(var(--hud-border))",
          accent: "oklch(var(--hud-accent))",
        },
        resource: {
          food: "oklch(var(--resource-food))",
          wood: "oklch(var(--resource-wood))",
          gold: "oklch(var(--resource-gold))",
          stone: "oklch(var(--resource-stone))",
          money: "oklch(var(--resource-money))",
          energy: "oklch(var(--resource-energy))",
        },
        faction: {
          1: "oklch(var(--faction-1))",
          2: "oklch(var(--faction-2))",
          3: "oklch(var(--faction-3))",
        },
        health: {
          full: "oklch(var(--health-full))",
          mid: "oklch(var(--health-mid))",
          low: "oklch(var(--health-low))",
          empty: "oklch(var(--health-empty))",
        },
        selection: "oklch(var(--selection))",
        valid: "oklch(var(--valid))",
        invalid: "oklch(var(--invalid))",
        rally: "oklch(var(--rally))",
        terrain: {
          grass: "oklch(var(--terrain-grass))",
          dirt: "oklch(var(--terrain-dirt))",
          rock: "oklch(var(--terrain-rock))",
          water: "oklch(var(--terrain-water))",
          sand: "oklch(var(--terrain-sand))",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(0,0,0,0.05)",
        subtle: "0 1px 2px 0 oklch(0 0 0 / 0.22), 0 1px 0 0 oklch(1 0 0 / 0.04) inset",
        elevated:
          "0 2px 0 0 oklch(0 0 0 / 0.35), 0 8px 20px -6px oklch(0 0 0 / 0.55)",
        "inset-plate":
          "inset 0 1px 0 oklch(1 0 0 / 0.07), inset 0 -1px 0 oklch(0 0 0 / 0.45)",
        "banner-ring": "0 0 0 1px oklch(0 0 0 / 0.5), 0 0 0 3px oklch(var(--selection) / 0.35)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-ring": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(1.06)" },
        },
        "hit-flash": {
          "0%": { filter: "brightness(1)" },
          "35%": { filter: "brightness(1.9) saturate(0.4)" },
          "100%": { filter: "brightness(1)" },
        },
        "marker-pop": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "0", transform: "scale(1.25)" },
        },
        "order-ping": {
          "0%": { opacity: "0.95", transform: "scale(0.4)" },
          "100%": { opacity: "0", transform: "scale(1.6)" },
        },
        "banner-drift": {
          "0%, 100%": { transform: "translateY(0) rotate(-1deg)" },
          "50%": { transform: "translateY(-2px) rotate(1deg)" },
        },
        "ember-rise": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "30%": { opacity: "0.9" },
          "100%": { opacity: "0", transform: "translateY(-14px)" },
        },
        "alert-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-ring": "pulse-ring 1.6s ease-in-out infinite",
        "hit-flash": "hit-flash 0.28s ease-out",
        "marker-pop": "marker-pop 0.5s ease-out forwards",
        "order-ping": "order-ping 0.6s ease-out forwards",
        "banner-drift": "banner-drift 4s ease-in-out infinite",
        "ember-rise": "ember-rise 1.4s ease-out infinite",
        "alert-sweep": "alert-sweep 2.4s linear infinite",
      },
    },
  },
  plugins: [typography, containerQueries, animate],
};
