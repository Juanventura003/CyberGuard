import LoggedInDashboard from "../components/dashboard/LoggedInDashboard";
import GuestDashboard from "../components/dashboard/GuestDashboard";
import { useAuth } from "../context/AuthContext";

function Dashboard() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="dashboard">
        <p>Loading...</p>
      </div>
    );
  }

  return session ? <LoggedInDashboard /> : <GuestDashboard />;
}

export default Dashboard;