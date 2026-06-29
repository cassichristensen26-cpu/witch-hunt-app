import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const showBody = () => { document.body.style.visibility = 'visible' }
document.fonts.ready.then(showBody).catch(showBody)
setTimeout(showBody, 1500)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
