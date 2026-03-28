import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ExplorePage from './ExplorePage.jsx'
import CladeExplorerPage from './CladeExplorerPage.jsx'
import QuizPage from './QuizPage.jsx'
import ListPage from './ListPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/explore/:ottId" element={<ExplorePage />} />
        <Route path="/clades" element={<CladeExplorerPage />} />
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/lists" element={<ListPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
