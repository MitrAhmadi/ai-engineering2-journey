import { routeAgentRequest } from "agents";
import { DesignAgent } from "./agent";

// The entire Worker. `routeAgentRequest` recognises the /agents/:agent/:name
// URLs the client SDK uses, finds (or creates) the Durable Object for that
// name, and hands the request to it. Anything else is a 404 — in dev, Vite
// serves the React app and only proxies the agent routes here.
export { DesignAgent };

interface Env {
  DesignAgent: DurableObjectNamespace;
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
