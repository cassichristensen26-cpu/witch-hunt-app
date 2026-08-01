import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import Team from './pages/Team'
import ModLogin from './pages/ModLogin'
import ModSetup from './pages/ModSetup'
import ModGame from './pages/ModGame'
import ModTeam from './pages/ModTeam'
import ModRules from './pages/ModRules'
import Snitch from './pages/Snitch'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/team" element={<Team />} />
        <Route path="/mod" element={<ModLogin />} />
        <Route path="/mod/setup" element={<ModSetup />} />
        <Route path="/mod/game" element={<ModGame />} />
        <Route path="/mod/team/:teamId" element={<ModTeam />} />
        <Route path="/mod/rules" element={<ModRules />} />
        <Route path="/snitch/:key" element={<Snitch />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
