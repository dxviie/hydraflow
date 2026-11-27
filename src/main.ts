import { mount } from "svelte";

import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("hydraflow has nowhere to mount: #app is missing");

export default mount(App, { target });
