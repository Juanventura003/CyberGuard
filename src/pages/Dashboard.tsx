import LoggedInDashboard from "../components/dashboard/LoggedInDashboard";
import GuestDashboard from "../components/dashboard/GuestDashboard";


function Dashboard() {
  // Temporary
  const isLoggedIn = false;


  return isLoggedIn ? <LoggedInDashboard /> : <GuestDashboard />;
}


export default Dashboard;