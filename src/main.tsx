import React from "react";
import { createRoot } from "react-dom/client";
import VaultRoot from "./VaultRoot";
import Floating from "./Floating";
import "./style.css";
const floating =
  new URLSearchParams(location.search).get("surface") === "floating";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {floating ? <Floating /> : <VaultRoot />}
  </React.StrictMode>,
);
