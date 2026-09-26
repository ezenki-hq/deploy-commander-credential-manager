import { createRoot } from "react-dom/client";
import App from "./App";
import { createCommanderClient } from "./commander/client";
import "./index.css";

const client = createCommanderClient();
const root = createRoot(document.getElementById("root")!);

root.render(<App caller={client.caller} />);
window.addEventListener("pagehide", () => client.dispose(), { once: true });
