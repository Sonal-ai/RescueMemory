/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ['selector', '[data-theme="dark"]'],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                rescue: {
                    dark: '#0a0e1a',
                    card: '#111827',
                    red: '#ff3b3b',
                    green: '#00ff88',
                    cyan: '#00d4ff',
                }
            },
            fontFamily: {
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
            }
        },
    },
    plugins: [],
}