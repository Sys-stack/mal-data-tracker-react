import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Browse from "./pages/Browse.jsx";
import Predictor from "./pages/Predictor.jsx";
import Teams from "./pages/Teams.jsx";
import Planner from "./pages/Planner.jsx";
import Simulator from "./pages/Simulator.jsx";
import AnimeDetail from "./pages/AnimeDetail.jsx";

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/anime/:id" element={<AnimeDetail />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/predictor" element={<Predictor />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/planner/:teamId" element={<Planner />} />
          <Route path="/planner/:teamId/simulate" element={<Simulator />} />
        </Routes>
      </main>
    </div>
  );
}
