import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Welcome from './pages/Welcome'
import Capture from './pages/Capture'
import Analyzing from './pages/Analyzing'
import Templates from './pages/Templates'
import Workspace from './pages/Workspace'
import Summary from './pages/Summary'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/analyzing" element={<Analyzing />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/summary" element={<Summary />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
