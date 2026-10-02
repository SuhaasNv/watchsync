import { createRoot } from "react-dom/client";

function Popup() {
  return <h1>WatchSync</h1>;
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<Popup />);
