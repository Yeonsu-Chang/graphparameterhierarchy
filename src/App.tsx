import { Routes, Route, Link } from "react-router-dom";
import GraphHierarchy from '@/pages/GraphHierarchy'

function Home() {
  return (
    <div style={{ padding: 20 }}>
      <h1>Welcome</h1>
      <Link to="/graph" className="text-blue-600 hover:underline">
        Open Graph
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/graph" element={<GraphHierarchy />} />
    </Routes>
  );
}
