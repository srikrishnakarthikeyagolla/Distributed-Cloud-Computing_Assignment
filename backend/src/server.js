import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { initializeUserStore } from "./models/User.js";
import { initializeMessageStore } from "./models/ChatMessage.js";
import authRouter from "./routes/auth.js";
import locationRouter from "./routes/location.js";
import neighborhoodRouter from "./routes/neighborhood.js";

const app = express();
const port = Number(process.env.PORT) || 5000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", message: "Backend is connected." });
});

app.use("/api/auth", authRouter);
app.use("/api/location", locationRouter);
app.use("/api/neighborhood", neighborhoodRouter);

app.use((error, _request, response, _next) => {
  console.error("API error:", error);
  if (response.headersSent) return;
  response.status(error.status || 500).json({
    error: error.status ? error.message : "Something went wrong. Please try again.",
  });
});

async function startServer() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }

  await initializeUserStore();
  await initializeMessageStore();
  console.log("Using local JSON stores at backend/data/.");

  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exitCode = 1;
});
