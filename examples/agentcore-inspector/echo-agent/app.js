import express from "express";

// AgentCore Runtime always routes to port 8080 inside the microVM.
const PORT = 8080;

const app = express();
app.use(express.json());

// Health check. AgentCore polls this until it returns 200, then marks the
// runtime READY. Keep it cheap and dependency-free.
app.get("/ping", (_req, res) => {
  res.json({ status: "Healthy" });
});

// Agent entry point. AgentCore forwards the InvokeAgentRuntime payload here as
// the raw request body. This echo agent just reflects the prompt back.
app.post("/invocations", (req, res) => {
  const prompt = req.body?.prompt ?? "";
  res.json({
    output: `echo: ${prompt}`,
    receivedKeys: Object.keys(req.body ?? {}),
  });
});

app.listen(PORT, () => {
  console.log(`echo-agent listening on :${PORT}`);
});
