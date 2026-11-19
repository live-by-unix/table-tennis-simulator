import { render, refreshUser } from "./pages";
import { net } from "./net";

const app = document.getElementById("app")!;

async function boot(): Promise<void> {
  const user = await refreshUser();
  if (user) net.connect();
  await render(app);
  window.addEventListener("hashchange", () => void render(app));
}

void boot();
