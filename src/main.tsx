import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { TelemetryProvider } from './telemetry'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TelemetryProvider>
      <App />
    </TelemetryProvider>
  </React.StrictMode>,
)
