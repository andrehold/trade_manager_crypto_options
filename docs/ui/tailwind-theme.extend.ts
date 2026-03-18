import type { Config } from "tailwindcss";

export const uiFrameworkTailwindExtension: Config["theme"] = {
  extend: {
    colors: {
      bg: {
        canvas: "var(--bg-canvas)",
        elevated: "var(--bg-canvas-elevated)",
        inverse: "var(--bg-inverse)",
        overlay: "var(--bg-overlay)",
        surface: {
          1: "var(--bg-surface-1)",
          2: "var(--bg-surface-2)",
          3: "var(--bg-surface-3)",
          4: "var(--bg-surface-4)"
        }
      },
      text: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        tertiary: "var(--text-tertiary)",
        disabled: "var(--text-disabled)",
        inverse: "var(--text-inverse)",
        accent: "var(--text-accent)"
      },
      border: {
        subtle: "var(--border-subtle)",
        DEFAULT: "var(--border-default)",
        strong: "var(--border-strong)",
        accent: "var(--border-accent)"
      },
      accent: {
        300: "var(--accent-300)",
        400: "var(--accent-400)",
        500: "var(--accent-500)",
        600: "var(--accent-600)",
        700: "var(--accent-700)"
      },
      status: {
        success: "var(--status-success)",
        warning: "var(--status-warning)",
        danger: "var(--status-danger)",
        info: "var(--status-info)",
        waiting: "var(--status-waiting)",
        approved: "var(--status-approved)",
        active: "var(--status-active)",
        completed: "var(--status-completed)",
        occupied: "var(--status-occupied)",
        available: "var(--status-available)"
      }
    },
    borderRadius: {
      xs: "var(--radius-xs)",
      sm: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
      "2xl": "var(--radius-2xl)",
      pill: "var(--radius-pill)",
      round: "var(--radius-round)"
    },
    boxShadow: {
      soft: "var(--shadow-soft)",
      card: "var(--shadow-card)",
      overlay: "var(--shadow-overlay)",
      "accent-sm": "var(--glow-accent-sm)",
      "accent-md": "var(--glow-accent-md)"
    },
    fontFamily: {
      sans: ["var(--font-sans)"],
      mono: ["var(--font-mono)"]
    },
    fontSize: {
      "display-l": ["40px", { lineHeight: "44px", fontWeight: "700", letterSpacing: "-0.03em" }],
      "display-m": ["32px", { lineHeight: "36px", fontWeight: "700", letterSpacing: "-0.025em" }],
      "title-l": ["24px", { lineHeight: "30px", fontWeight: "600", letterSpacing: "-0.02em" }],
      "title-m": ["20px", { lineHeight: "26px", fontWeight: "600", letterSpacing: "-0.015em" }],
      headline: ["16px", { lineHeight: "22px", fontWeight: "600", letterSpacing: "-0.01em" }],
      body: ["14px", { lineHeight: "20px", fontWeight: "500", letterSpacing: "-0.005em" }],
      subhead: ["14px", { lineHeight: "18px", fontWeight: "500" }],
      caption: ["12px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.01em" }],
      micro: ["11px", { lineHeight: "14px", fontWeight: "500", letterSpacing: "0.015em" }]
    }
  }
};
