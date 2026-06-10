import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// Apply the saved theme before first paint to avoid a flash. The server (user
// preferences) is the source of truth; we mirror it to localStorage so reloads
// and the pre-login screens are themed too. Default (no attribute) is dark,
// matching :root in index.css.
const savedTheme = localStorage.getItem('theme')
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', savedTheme)
}

const root = document.getElementById('root')!
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
