import { useEffect, useState } from "react";

function App() {
  const [apiStatus, setApiStatus] = useState("Checking backend...");

  useEffect(() => {
    let active = true;

    fetch("/api/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (active) setApiStatus(data.message);
      })
      .catch(() => {
        if (active) setApiStatus("Backend unavailable. Start the backend server.");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <p className="eyebrow">MERN starter</p>
        <h1 id="welcome-title">Your project is ready to grow.</h1>
        <p className="description">
          This React app is connected to an Express API, with MongoDB
          configuration ready for your next step.
        </p>
        <div className="status" role="status">
          <span className="status-dot" />
          {apiStatus}
        </div>
      </section>
    </main>
  );
}

export default App;

