import { createRoot } from "react-dom/client";
import "../../ui/theme.css";
import { App } from "./App";

document.documentElement.classList.add("curbox-popup");
createRoot(document.getElementById("root")!).render(<App />);
